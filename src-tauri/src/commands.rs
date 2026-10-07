//! Commandes Tauri exposées au frontend. Chaque commande vérifie la session et les permissions
//! avant de déléguer à la couche métier (`domain`). Aucune opération de fichier arbitraire n'est exposée.

use crate::backup::{self, BackupInfo};
use crate::db;
use crate::domain::{auth, customers, entities, products, purchases, sales, stock};
use crate::error::{AppError, AppResult};
use crate::premium::{self, PremiumStatus};
use crate::state::{load_session, AppState, Session};
use crate::whatsapp::{self, WaStatus, WhatsApp};
use crate::{audit, notify};
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

type R<T> = AppResult<T>;

// ------------------------------------------------------------------ Application

#[derive(Serialize)]
pub struct Bootstrap {
    setup_done: bool,
    premium: PremiumStatus,
    version: String,
    debug: bool,
    company: Option<Map<String, Value>>,
    images_dir: String,
    backups_dir: String,
    session: Option<Session>,
}

#[tauri::command]
pub async fn app_bootstrap(app: AppHandle, state: State<'_, AppState>) -> R<Bootstrap> {
    let conn = state.conn();
    let company = db::query_json(&conn, "SELECT name, logo, city FROM companies WHERE id = 1", &[])?.into_iter().next();
    Ok(Bootstrap {
        setup_done: auth::is_setup_done(&conn)?,
        premium: premium::status(&conn),
        version: app.package_info().version.to_string(),
        debug: cfg!(debug_assertions),
        company,
        images_dir: state.images_dir().to_string_lossy().to_string(),
        backups_dir: state.backups_dir().to_string_lossy().to_string(),
        session: state.session().ok(),
    })
}

#[tauri::command]
pub async fn setup_complete(state: State<'_, AppState>, input: auth::SetupInput) -> R<Session> {
    let session = auth::setup(&mut state.conn(), &input)?;
    state.set_session(Some(session.clone()));
    Ok(session)
}

#[tauri::command]
pub async fn dev_seed_demo(state: State<'_, AppState>) -> R<Session> {
    #[cfg(debug_assertions)]
    {
        let session = crate::seed::seed_demo(&mut state.conn())?;
        state.set_session(Some(session.clone()));
        Ok(session)
    }
    #[cfg(not(debug_assertions))]
    {
        let _ = state;
        Err(AppError::Forbidden)
    }
}

// ------------------------------------------------------------------ Authentification

#[tauri::command]
pub async fn auth_login(state: State<'_, AppState>, username: String, password: String) -> R<Session> {
    let failures = *state.failed_logins.lock().unwrap_or_else(|e| e.into_inner());
    if failures >= 5 {
        std::thread::sleep(Duration::from_millis(1500));
    }
    let res = auth::login(&state.conn(), &username, &password);
    match res {
        Ok(s) => {
            *state.failed_logins.lock().unwrap_or_else(|e| e.into_inner()) = 0;
            state.set_session(Some(s.clone()));
            Ok(s)
        }
        Err(e) => {
            *state.failed_logins.lock().unwrap_or_else(|e| e.into_inner()) += 1;
            std::thread::sleep(Duration::from_millis(350));
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn auth_logout(state: State<'_, AppState>) -> R<()> {
    if let Ok(s) = state.session() {
        audit::log(&state.conn(), Some(&s), "auth.logout", Some("user"), Some(s.user_id), &format!("{} s'est déconnecté.", s.name), None)?;
    }
    state.set_session(None);
    Ok(())
}

#[tauri::command]
pub async fn auth_unlock(state: State<'_, AppState>, password: String) -> R<bool> {
    let s = state.session()?;
    let ok = auth::check_password(&state.conn(), s.user_id, &password)?;
    if !ok {
        std::thread::sleep(Duration::from_millis(350));
    }
    Ok(ok)
}

#[tauri::command]
pub async fn auth_change_password(state: State<'_, AppState>, current: String, new_password: String) -> R<()> {
    let s = state.session()?;
    auth::change_password(&state.conn(), &s, &current, &new_password)
}

#[tauri::command]
pub async fn users_save(state: State<'_, AppState>, input: auth::UserInput) -> R<i64> {
    let s = state.require("manage_users")?;
    auth::save_user(&mut state.conn(), &s, &input)
}

#[tauri::command]
pub async fn roles_save(state: State<'_, AppState>, input: auth::RoleInput) -> R<i64> {
    let s = state.require("manage_users")?;
    auth::save_role(&mut state.conn(), &s, &input)
}

// ------------------------------------------------------------------ Données

#[tauri::command]
pub async fn db_select(state: State<'_, AppState>, sql: String, params: Option<Vec<Value>>) -> R<Vec<Map<String, Value>>> {
    state.session()?;
    let conn = state.conn();
    db::ensure_readonly(&conn, &sql)?;
    db::query_json(&conn, &sql, &params.unwrap_or_default())
}

#[tauri::command]
pub async fn entity_save(state: State<'_, AppState>, table: String, id: Option<i64>, values: Map<String, Value>) -> R<i64> {
    let s = state.session()?;
    entities::save(&state.conn(), &s, &table, id, &values)
}

#[tauri::command]
pub async fn entity_archive(state: State<'_, AppState>, table: String, id: i64, archived: bool) -> R<()> {
    let s = state.session()?;
    entities::set_archived(&state.conn(), &s, &table, id, archived)
}

#[tauri::command]
pub async fn company_save(state: State<'_, AppState>, values: Map<String, Value>) -> R<()> {
    let s = state.require("manage_settings")?;
    let conn = state.conn();
    auth::save_company(&conn, &values)?;
    audit::log(&conn, Some(&s), "settings.company", Some("company"), Some(1), &format!("{} a modifié les informations de l'entreprise.", s.name), None)
}

const SETTING_PREFIXES: &[&str] = &["receipt.", "sales.", "stock.", "reorder.", "backup.", "invoice.", "whatsapp.", "general."];

#[tauri::command]
pub async fn settings_set(state: State<'_, AppState>, values: Map<String, Value>) -> R<()> {
    let s = state.require("manage_settings")?;
    let conn = state.conn();
    for (k, v) in &values {
        if !SETTING_PREFIXES.iter().any(|p| k.starts_with(p)) || k.len() > 64 || k.ends_with("last_at") || k.ends_with("last_auto_at") {
            return Err(AppError::Forbidden);
        }
        if k.starts_with("backup.auto") && v.as_bool() == Some(true) {
            premium::require(&conn)?;
        }
        db::set_setting(&conn, k, v)?;
    }
    let keys: Vec<&String> = values.keys().collect();
    audit::log(&conn, Some(&s), "settings.update", Some("settings"), None, &format!("{} a modifié les paramètres.", s.name), Some(json!({ "keys": keys })))
}

// ------------------------------------------------------------------ Produits & stock

#[tauri::command]
pub async fn product_save(state: State<'_, AppState>, input: products::ProductInput) -> R<i64> {
    let s = state.require("manage_products")?;
    products::save(&mut state.conn(), &s, &input)
}

#[tauri::command]
pub async fn product_duplicate(state: State<'_, AppState>, id: i64) -> R<i64> {
    let s = state.require("manage_products")?;
    products::duplicate(&mut state.conn(), &s, id)
}

#[tauri::command]
pub async fn stock_adjust(state: State<'_, AppState>, input: stock::AdjustInput) -> R<(f64, f64)> {
    let s = state.require("manage_stock")?;
    stock::adjust(&mut state.conn(), &s, &input)
}

#[derive(Serialize)]
pub struct Numbered {
    id: i64,
    number: String,
}

#[tauri::command]
pub async fn stock_transfer(state: State<'_, AppState>, input: stock::TransferInput) -> R<Numbered> {
    let s = state.require("manage_stock")?;
    let (id, number) = stock::transfer(&mut state.conn(), &s, &input)?;
    Ok(Numbered { id, number })
}

#[tauri::command]
pub async fn inventory_start(state: State<'_, AppState>, warehouse_id: Option<i64>, notes: Option<String>) -> R<Numbered> {
    let s = state.require("manage_stock")?;
    let (id, number) = stock::inventory_start(&mut state.conn(), &s, warehouse_id, notes)?;
    Ok(Numbered { id, number })
}

#[tauri::command]
pub async fn inventory_set_count(state: State<'_, AppState>, session_id: i64, product_id: i64, counted: f64) -> R<()> {
    state.require("manage_stock")?;
    stock::inventory_set_count(&state.conn(), session_id, product_id, counted)
}

#[tauri::command]
pub async fn inventory_remove_item(state: State<'_, AppState>, session_id: i64, product_id: i64) -> R<()> {
    state.require("manage_stock")?;
    stock::inventory_remove_item(&state.conn(), session_id, product_id)
}

#[tauri::command]
pub async fn inventory_validate(state: State<'_, AppState>, session_id: i64) -> R<usize> {
    let s = state.require("manage_stock")?;
    stock::inventory_validate(&mut state.conn(), &s, session_id)
}

#[tauri::command]
pub async fn inventory_cancel(state: State<'_, AppState>, session_id: i64) -> R<()> {
    let s = state.require("manage_stock")?;
    stock::inventory_cancel(&state.conn(), &s, session_id)
}

// ------------------------------------------------------------------ Ventes

#[tauri::command]
pub async fn sale_create(state: State<'_, AppState>, input: sales::SaleInput) -> R<sales::SaleResult> {
    let s = state.require("create_sales")?;
    sales::create(&mut state.conn(), &s, &input)
}

#[tauri::command]
pub async fn sale_cancel(state: State<'_, AppState>, id: i64, reason: String) -> R<()> {
    let s = state.require("cancel_sales")?;
    sales::cancel(&mut state.conn(), &s, id, &reason)
}

// ------------------------------------------------------------------ Achats & paiements

#[tauri::command]
pub async fn purchase_save(state: State<'_, AppState>, input: purchases::PurchaseInput) -> R<purchases::PurchaseResult> {
    let s = state.require("manage_purchases")?;
    purchases::save(&mut state.conn(), &s, &input)
}

#[tauri::command]
pub async fn purchase_receive(state: State<'_, AppState>, id: i64, update_purchase_price: bool) -> R<()> {
    let s = state.require("manage_purchases")?;
    purchases::receive(&mut state.conn(), &s, id, update_purchase_price)
}

#[tauri::command]
pub async fn purchase_cancel(state: State<'_, AppState>, id: i64, reason: String) -> R<()> {
    let s = state.require("manage_purchases")?;
    purchases::cancel(&mut state.conn(), &s, id, &reason)
}

#[derive(Deserialize)]
pub struct SupplierPaymentInput {
    supplier_id: i64,
    amount: f64,
    method: String,
    purchase_id: Option<i64>,
    reference: Option<String>,
    note: Option<String>,
}

#[tauri::command]
pub async fn supplier_payment(state: State<'_, AppState>, input: SupplierPaymentInput) -> R<Numbered> {
    let s = state.session()?;
    if !s.can("manage_suppliers") && !s.can("manage_purchases") {
        return Err(AppError::Forbidden);
    }
    let (id, number) =
        purchases::pay_supplier(&mut state.conn(), &s, input.supplier_id, input.amount, &input.method, input.purchase_id, input.reference, input.note)?;
    Ok(Numbered { id, number })
}

#[tauri::command]
pub async fn customer_payment(
    state: State<'_, AppState>,
    customer_id: i64,
    amount: f64,
    method: String,
    note: Option<String>,
) -> R<customers::PaymentResult> {
    let s = state.require("manage_customers")?;
    customers::add_payment(&mut state.conn(), &s, customer_id, amount, &method, note)
}

// ------------------------------------------------------------------ Premium

#[derive(Serialize)]
pub struct PremiumChange {
    premium: PremiumStatus,
    session: Session,
}

#[tauri::command]
pub async fn premium_activate(state: State<'_, AppState>, code: String) -> R<PremiumChange> {
    let s = state.require("manage_settings")?;
    let conn = state.conn();
    let status = premium::activate(&conn, &code)?;
    audit::log(&conn, Some(&s), "premium.activate", Some("premium"), None, &format!("{} a activé DigiStock Premium.", s.name), None)?;
    notify::push(&conn, "premium", "success", "Premium activé", "Toutes les fonctionnalités DigiStock Premium sont disponibles.", None, None)?;
    let session = load_session(&conn, s.user_id)?;
    state.set_session(Some(session.clone()));
    Ok(PremiumChange { premium: status, session })
}

#[tauri::command]
pub async fn premium_deactivate(state: State<'_, AppState>, wa: State<'_, WhatsApp>) -> R<PremiumChange> {
    let s = state.require("manage_settings")?;
    if s.role_id != Some(1) {
        return Err(AppError::Forbidden);
    }
    wa.stop();
    let conn = state.conn();
    premium::deactivate(&conn)?;
    audit::log(&conn, Some(&s), "premium.deactivate", Some("premium"), None, &format!("{} a désactivé DigiStock Premium.", s.name), None)?;
    let session = load_session(&conn, s.user_id)?;
    state.set_session(Some(session.clone()));
    Ok(PremiumChange { premium: premium::status(&conn), session })
}

// ------------------------------------------------------------------ Sauvegardes

#[tauri::command]
pub async fn backup_create(app: AppHandle, state: State<'_, AppState>, export: bool) -> R<Option<BackupInfo>> {
    let s = state.require("manage_backups")?;
    let info = if export {
        let name = backup::file_name("manual");
        let Some(path) = app
            .dialog()
            .file()
            .set_title("Exporter une sauvegarde")
            .set_file_name(&name)
            .add_filter("Sauvegarde DigiStock", &["db"])
            .blocking_save_file()
        else {
            return Ok(None);
        };
        let path = path.into_path().map_err(|_| AppError::validation("Emplacement invalide."))?;
        let conn = state.conn();
        backup::vacuum_into(&conn, &path)?;
        db::set_setting(&conn, "backup.last_at", &json!(db::now()))?;
        BackupInfo {
            file_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
            size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
            path: path.to_string_lossy().to_string(),
            created_at: db::now(),
            kind: "manual".into(),
        }
    } else {
        backup::create(&state.conn(), &state.backups_dir(), "manual")?
    };
    let conn = state.conn();
    audit::log(&conn, Some(&s), "backup.create", Some("backup"), None, &format!("{} a créé la sauvegarde {}.", s.name, info.file_name), None)?;
    Ok(Some(info))
}

#[tauri::command]
pub async fn backup_list(state: State<'_, AppState>) -> R<Vec<BackupInfo>> {
    state.require("manage_backups")?;
    backup::list(&state.backups_dir())
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, state: State<'_, AppState>, wa: State<'_, WhatsApp>, file_name: Option<String>) -> R<bool> {
    let s = state.require("manage_backups")?;
    let source = match file_name {
        Some(name) => {
            if name.contains(['/', '\\']) || name.contains("..") || !name.ends_with(".db") {
                return Err(AppError::Forbidden);
            }
            state.backups_dir().join(name)
        }
        None => {
            let Some(p) = app
                .dialog()
                .file()
                .set_title("Restaurer une sauvegarde")
                .add_filter("Sauvegarde DigiStock", &["db"])
                .blocking_pick_file()
            else {
                return Ok(false);
            };
            p.into_path().map_err(|_| AppError::validation("Fichier invalide."))?
        }
    };
    if !source.exists() {
        return Err(AppError::NotFound("Sauvegarde introuvable.".into()));
    }
    wa.stop();
    let name = source.file_name().unwrap_or_default().to_string_lossy().to_string();
    backup::restore(&state, &source)?;
    let conn = state.conn();
    let _ = audit::log(&conn, None, "backup.restore", Some("backup"), None, &format!("{} a restauré la sauvegarde {name}.", s.name), None);
    Ok(true)
}

// ------------------------------------------------------------------ Fichiers

#[tauri::command]
pub async fn file_save(
    app: AppHandle,
    state: State<'_, AppState>,
    default_name: String,
    data_base64: String,
    filter_name: String,
    extensions: Vec<String>,
) -> R<Option<String>> {
    state.session()?;
    let allowed = ["pdf", "csv", "txt", "html", "png"];
    if extensions.iter().any(|e| !allowed.contains(&e.as_str())) {
        return Err(AppError::Forbidden);
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|_| AppError::validation("Données invalides."))?;
    let exts: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
    let Some(path) = app.dialog().file().set_file_name(&default_name).add_filter(&filter_name, &exts).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::validation("Emplacement invalide."))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn image_store(state: State<'_, AppState>, data_base64: String, ext: String) -> R<String> {
    state.session()?;
    let ext = ext.to_lowercase();
    if !["png", "jpg", "jpeg", "webp"].contains(&ext.as_str()) {
        return Err(AppError::validation("Format d'image non supporté."));
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data_base64).map_err(|_| AppError::validation("Image invalide."))?;
    if bytes.len() > 5 * 1024 * 1024 {
        return Err(AppError::validation("Image trop volumineuse (5 Mo maximum)."));
    }
    let dir = state.images_dir();
    std::fs::create_dir_all(&dir)?;
    let name = format!("{}.{ext}", uuid::Uuid::new_v4());
    std::fs::write(dir.join(&name), bytes)?;
    Ok(name)
}

#[tauri::command]
pub async fn logs_export(app: AppHandle, state: State<'_, AppState>) -> R<Option<String>> {
    state.session()?;
    let dir = app.path().app_log_dir().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut content = format!("DigiStock {} — journal technique\nExporté le {}\n\n", app.package_info().version, db::now());
    if dir.exists() {
        let mut files: Vec<_> = std::fs::read_dir(&dir)?.filter_map(|e| e.ok()).map(|e| e.path()).collect();
        files.sort();
        for f in files {
            if let Ok(text) = std::fs::read_to_string(&f) {
                content.push_str(&format!("===== {} =====\n{}\n", f.file_name().unwrap_or_default().to_string_lossy(), text));
            }
        }
    }
    let name = format!("digistock-logs-{}.txt", chrono::Local::now().format("%Y-%m-%d-%H%M"));
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter("Journal", &["txt"]).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|_| AppError::validation("Emplacement invalide."))?;
    std::fs::write(&path, content)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn notifications_scan(state: State<'_, AppState>) -> R<()> {
    state.session()?;
    notify::scan_expirations(&state.conn())
}

#[tauri::command]
pub async fn notifications_mark_read(state: State<'_, AppState>, ids: Option<Vec<i64>>) -> R<()> {
    state.session()?;
    let conn = state.conn();
    match ids {
        Some(ids) => {
            for id in ids {
                conn.execute("UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL", rusqlite::params![db::now(), id])?;
            }
        }
        None => {
            conn.execute("UPDATE notifications SET read_at = ? WHERE read_at IS NULL", [db::now()])?;
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ WhatsApp (Premium)

#[tauri::command]
pub async fn wa_start(app: AppHandle, state: State<'_, AppState>, wa: State<'_, WhatsApp>) -> R<WaStatus> {
    state.session()?;
    premium::require(&state.conn())?;
    wa.start(&app, state.data_dir.join("whatsapp-session"))
}

#[tauri::command]
pub async fn wa_status(wa: State<'_, WhatsApp>) -> R<WaStatus> {
    Ok(wa.status())
}

#[derive(Deserialize)]
pub struct WaAttachment {
    base64: String,
    mimetype: String,
    filename: String,
}

#[derive(Deserialize)]
pub struct WaSendInput {
    phone: String,
    message: String,
    recipient_name: Option<String>,
    kind: String,
    entity: Option<String>,
    entity_id: Option<i64>,
    attachment: Option<WaAttachment>,
}

#[tauri::command]
pub async fn wa_send(app: AppHandle, input: WaSendInput) -> R<()> {
    let state = app.state::<AppState>();
    let s = state.session()?;
    premium::require(&state.conn())?;
    let phone = whatsapp::normalize_phone(&input.phone).ok_or_else(|| AppError::validation("Numéro WhatsApp invalide."))?;
    if input.message.trim().is_empty() {
        return Err(AppError::validation("Le message est vide."));
    }
    let args = json!({
        "phone": phone,
        "message": input.message,
        "attachment": input.attachment.as_ref().map(|a| json!({ "base64": a.base64, "mimetype": a.mimetype, "filename": a.filename })),
    });
    let app2 = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || app2.state::<WhatsApp>().request("send", args, Duration::from_secs(90)))
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let conn = state.conn();
    let (status, error) = match &result {
        Ok(_) => ("sent", None),
        Err(e) => ("failed", Some(e.user_message())),
    };
    conn.execute(
        "INSERT INTO whatsapp_messages (recipient_name, phone, message, kind, entity, entity_id, attachment, status, error, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            input.recipient_name,
            phone,
            input.message,
            input.kind,
            input.entity,
            input.entity_id,
            input.attachment.as_ref().map(|a| a.filename.clone()),
            status,
            error,
            s.user_id,
            db::now()
        ],
    )?;
    if result.is_ok() {
        audit::log(
            &conn,
            Some(&s),
            "whatsapp.send",
            input.entity.as_deref(),
            input.entity_id,
            &format!("{} a envoyé un message WhatsApp à {}.", s.name, input.recipient_name.as_deref().unwrap_or(&phone)),
            None,
        )?;
    }
    result.map(|_| ())
}

#[tauri::command]
pub async fn wa_logout(app: AppHandle) -> R<()> {
    let state = app.state::<AppState>();
    state.session()?;
    let app2 = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let wa = app2.state::<WhatsApp>();
        let r = wa.request("logout", Value::Null, Duration::from_secs(30));
        wa.stop();
        r
    })
    .await;
    let dir = state.data_dir.join("whatsapp-session");
    if dir.exists() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    Ok(())
}

#[tauri::command]
pub async fn wa_stop(app: AppHandle) -> R<()> {
    let app2 = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || app2.state::<WhatsApp>().stop()).await;
    Ok(())
}
