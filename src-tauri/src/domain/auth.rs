//! Authentification locale (Argon2id), utilisateurs, rôles et configuration initiale.

use crate::audit;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::premium;
use crate::state::{load_session, Session};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::{json, Map, Value};

pub fn hash_password(password: &str) -> AppResult<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|_| AppError::Internal("Impossible de sécuriser le mot de passe.".into()))
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| Argon2::default().verify_password(password.as_bytes(), &parsed).is_ok())
        .unwrap_or(false)
}

pub fn validate_password(password: &str) -> AppResult<()> {
    if password.chars().count() < 6 {
        return Err(AppError::validation("Le mot de passe doit contenir au moins 6 caractères."));
    }
    if password.chars().count() > 128 {
        return Err(AppError::validation("Le mot de passe est trop long."));
    }
    Ok(())
}

fn validate_username(username: &str) -> AppResult<String> {
    let u = username.trim().to_string();
    if u.len() < 3 || u.len() > 80 || u.chars().any(|c| c.is_whitespace()) {
        return Err(AppError::validation("L'identifiant doit contenir au moins 3 caractères, sans espace."));
    }
    Ok(u)
}

pub fn is_setup_done(conn: &Connection) -> AppResult<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
    let c: i64 = conn.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get(0))?;
    Ok(n > 0 && c > 0)
}

#[derive(Debug, Deserialize)]
pub struct AdminInput {
    pub name: String,
    pub username: String,
    pub email: Option<String>,
    pub password: String,
}

#[derive(Debug, Deserialize)]
pub struct SetupInput {
    pub company: Map<String, Value>,
    pub business_type: String,
    pub receipt_format: String,
    pub admin: AdminInput,
}

pub const COMPANY_FIELDS: &[&str] =
    &["name", "phone", "whatsapp", "email", "address", "city", "ice", "if_number", "rc", "logo", "currency", "default_tax_rate"];

pub fn save_company(conn: &Connection, values: &Map<String, Value>) -> AppResult<()> {
    let name = values.get("name").and_then(|v| v.as_str()).map(|s| s.trim()).unwrap_or("");
    if name.is_empty() {
        return Err(AppError::validation("Le nom de l'entreprise est obligatoire."));
    }
    let exists: bool = conn.query_row("SELECT COUNT(*) FROM companies", [], |r| r.get::<_, i64>(0))? > 0;
    if !exists {
        conn.execute("INSERT INTO companies (id, name) VALUES (1, ?)", [name])?;
    }
    for f in COMPANY_FIELDS {
        if let Some(v) = values.get(*f) {
            let v = match v {
                Value::String(s) if s.trim().is_empty() => Value::Null,
                Value::String(s) => Value::String(s.trim().to_string()),
                other => other.clone(),
            };
            if *f == "currency" && v.is_null() {
                continue;
            }
            conn.execute(&format!("UPDATE companies SET {f} = ?, updated_at = ? WHERE id = 1"), params![db::json_to_sql(&v), db::now()])?;
        }
    }
    if let Some(bt) = values.get("business_type").and_then(|v| v.as_str()) {
        conn.execute("UPDATE companies SET business_type = ? WHERE id = 1", [bt])?;
    }
    Ok(())
}

pub fn setup(conn: &mut Connection, input: &SetupInput) -> AppResult<Session> {
    if is_setup_done(conn)? {
        return Err(AppError::validation("DigiStock est déjà configuré."));
    }
    if input.admin.name.trim().is_empty() {
        return Err(AppError::validation("Le nom de l'administrateur est obligatoire."));
    }
    let username = validate_username(&input.admin.username)?;
    validate_password(&input.admin.password)?;
    if !["ticket_58", "ticket_80", "a4"].contains(&input.receipt_format.as_str()) {
        return Err(AppError::validation("Format de ticket invalide."));
    }
    let hash = hash_password(&input.admin.password)?;
    let tx = conn.transaction()?;
    let mut company = input.company.clone();
    company.insert("business_type".into(), Value::String(input.business_type.clone()));
    save_company(&tx, &company)?;
    db::set_setting(&tx, "receipt.format", &json!(input.receipt_format))?;
    tx.execute(
        "INSERT INTO users (name, username, email, password_hash) VALUES (?1, ?2, ?3, ?4)",
        params![input.admin.name.trim(), username, db::opt_str(&input.admin.email), hash],
    )?;
    let uid = tx.last_insert_rowid();
    tx.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, 1)", [uid])?;
    let session = load_session(&tx, uid)?;
    audit::log(&tx, Some(&session), "setup.complete", Some("company"), Some(1), &format!("{} a configuré DigiStock.", session.name), None)?;
    tx.commit()?;
    Ok(session)
}

pub fn login(conn: &Connection, username: &str, password: &str) -> AppResult<Session> {
    let row: Option<(i64, String, i64)> = conn
        .query_row("SELECT id, password_hash, is_active FROM users WHERE username = ? COLLATE NOCASE", [username.trim()], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let invalid = || AppError::validation("Identifiant ou mot de passe incorrect.");
    let (id, hash, active) = row.ok_or_else(invalid)?;
    if !verify_password(password, &hash) {
        return Err(invalid());
    }
    if active != 1 {
        return Err(AppError::validation("Ce compte est désactivé. Contactez l'administrateur."));
    }
    let session = load_session(conn, id)?;
    if !premium::is_active(conn) && session.role_id != Some(1) {
        return Err(AppError::validation("Les comptes multiples nécessitent DigiStock Premium. Connectez-vous avec le compte administrateur."));
    }
    conn.execute("UPDATE users SET last_login_at = ? WHERE id = ?", params![db::now(), id])?;
    audit::log(conn, Some(&session), "auth.login", Some("user"), Some(id), &format!("{} s'est connecté.", session.name), None)?;
    Ok(session)
}

pub fn check_password(conn: &Connection, user_id: i64, password: &str) -> AppResult<bool> {
    let hash: String = conn.query_row("SELECT password_hash FROM users WHERE id = ?", [user_id], |r| r.get(0))?;
    Ok(verify_password(password, &hash))
}

pub fn change_password(conn: &Connection, s: &Session, current: &str, new: &str) -> AppResult<()> {
    if !check_password(conn, s.user_id, current)? {
        return Err(AppError::validation("Le mot de passe actuel est incorrect."));
    }
    validate_password(new)?;
    conn.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?", params![hash_password(new)?, db::now(), s.user_id])?;
    audit::log(conn, Some(s), "auth.change_password", Some("user"), Some(s.user_id), &format!("{} a changé son mot de passe.", s.name), None)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct UserInput {
    pub id: Option<i64>,
    pub name: String,
    pub username: String,
    pub email: Option<String>,
    pub password: Option<String>,
    pub role_id: i64,
    pub is_active: bool,
}

pub fn save_user(conn: &mut Connection, s: &Session, u: &UserInput) -> AppResult<i64> {
    premium::require(conn)?;
    if u.name.trim().is_empty() {
        return Err(AppError::validation("Le nom est obligatoire."));
    }
    let username = validate_username(&u.username)?;
    let tx = conn.transaction()?;
    let role_exists: Option<i64> = tx.query_row("SELECT id FROM roles WHERE id = ?", [u.role_id], |r| r.get(0)).optional()?;
    if role_exists.is_none() {
        return Err(AppError::validation("Rôle introuvable."));
    }
    let id = match u.id {
        Some(id) => {
            if id == s.user_id && (!u.is_active || u.role_id != 1) && s.role_id == Some(1) {
                let admins: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM users us JOIN user_roles ur ON ur.user_id = us.id WHERE ur.role_id = 1 AND us.is_active = 1 AND us.id <> ?",
                    [id],
                    |r| r.get(0),
                )?;
                if admins == 0 {
                    return Err(AppError::validation("Il doit rester au moins un administrateur actif."));
                }
            }
            tx.execute(
                "UPDATE users SET name = ?, username = ?, email = ?, is_active = ?, updated_at = ? WHERE id = ?",
                params![u.name.trim(), username, db::opt_str(&u.email), u.is_active as i64, db::now(), id],
            )?;
            if let Some(p) = u.password.as_ref().filter(|p| !p.is_empty()) {
                validate_password(p)?;
                tx.execute("UPDATE users SET password_hash = ? WHERE id = ?", params![hash_password(p)?, id])?;
            }
            tx.execute("DELETE FROM user_roles WHERE user_id = ?", [id])?;
            id
        }
        None => {
            let p = u.password.as_deref().unwrap_or("");
            validate_password(p)?;
            tx.execute(
                "INSERT INTO users (name, username, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?)",
                params![u.name.trim(), username, db::opt_str(&u.email), hash_password(p)?, u.is_active as i64],
            )?;
            tx.last_insert_rowid()
        }
    };
    tx.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)", params![id, u.role_id])?;
    let verb = if u.id.is_some() { "modifié" } else { "créé" };
    audit::log(&tx, Some(s), "user.save", Some("user"), Some(id), &format!("{} a {verb} l'utilisateur {}.", s.name, u.name.trim()), None)?;
    tx.commit()?;
    Ok(id)
}

#[derive(Debug, Deserialize)]
pub struct RoleInput {
    pub id: Option<i64>,
    pub name: String,
    pub permissions: Vec<String>,
}

pub fn save_role(conn: &mut Connection, s: &Session, r: &RoleInput) -> AppResult<i64> {
    premium::require(conn)?;
    if r.name.trim().is_empty() {
        return Err(AppError::validation("Le nom du rôle est obligatoire."));
    }
    if r.id == Some(1) {
        return Err(AppError::validation("Le rôle Administrateur ne peut pas être modifié."));
    }
    let tx = conn.transaction()?;
    let id = match r.id {
        Some(id) => {
            tx.execute("UPDATE roles SET name = ? WHERE id = ?", params![r.name.trim(), id])?;
            tx.execute("DELETE FROM role_permissions WHERE role_id = ?", [id])?;
            id
        }
        None => {
            tx.execute("INSERT INTO roles (name, is_system) VALUES (?, 0)", [r.name.trim()])?;
            tx.last_insert_rowid()
        }
    };
    for p in &r.permissions {
        let n = tx.execute("INSERT OR IGNORE INTO role_permissions (role_id, permission_code) SELECT ?, code FROM permissions WHERE code = ?", params![id, p])?;
        if n == 0 {
            let exists: Option<String> = tx.query_row("SELECT code FROM permissions WHERE code = ?", [p], |r| r.get(0)).optional()?;
            if exists.is_none() {
                return Err(AppError::validation("Permission inconnue."));
            }
        }
    }
    audit::log(&tx, Some(s), "role.save", Some("role"), Some(id), &format!("{} a enregistré le rôle {}.", s.name, r.name.trim()), Some(json!({ "permissions": r.permissions })))?;
    tx.commit()?;
    Ok(id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn setup_input() -> SetupInput {
        SetupInput {
            company: json!({ "name": "Demo Store", "city": "Casablanca" }).as_object().unwrap().clone(),
            business_type: "commerce".into(),
            receipt_format: "ticket_80".into(),
            admin: AdminInput { name: "Omar".into(), username: "omar".into(), email: None, password: "secret123".into() },
        }
    }

    #[test]
    fn password_hash_roundtrip() {
        let h = hash_password("motdepasse").unwrap();
        assert!(h.starts_with("$argon2"));
        assert!(!h.contains("motdepasse"));
        assert!(verify_password("motdepasse", &h));
        assert!(!verify_password("autre", &h));
    }

    #[test]
    fn setup_then_login() {
        let mut c = test_conn();
        let s = setup(&mut c, &setup_input()).unwrap();
        assert_eq!(s.role_id, Some(1));
        assert!(s.can("manage_settings"));
        assert!(setup(&mut c, &setup_input()).is_err());
        assert!(login(&c, "OMAR", "secret123").is_ok());
        assert!(login(&c, "omar", "wrong").is_err());
        assert!(login(&c, "nobody", "secret123").is_err());
    }

    #[test]
    fn cashier_permissions() {
        let c = test_conn();
        c.execute("INSERT INTO users (id, name, username, password_hash) VALUES (2, 'Sara', 'sara', 'x')", []).unwrap();
        c.execute("INSERT INTO user_roles (user_id, role_id) VALUES (2, 3)", []).unwrap();
        let s = load_session(&c, 2).unwrap();
        assert!(s.can("create_sales"));
        assert!(s.can("manage_customers"));
        assert!(!s.can("view_purchase_price"));
        assert!(!s.can("view_profit"));
        assert!(!s.can("view_reports"));
        assert!(!s.can("manage_settings"));
    }

    #[test]
    fn weak_password_rejected() {
        let mut c = test_conn();
        let mut i = setup_input();
        i.admin.password = "123".into();
        assert!(setup(&mut c, &i).is_err());
    }
}
