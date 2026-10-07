//! Sauvegardes : copie cohérente via `VACUUM INTO`, restauration sécurisée, sauvegardes automatiques (Premium).

use crate::db;
use crate::error::{AppError, AppResult};
use crate::premium;
use crate::state::AppState;
use chrono::{Local, NaiveDateTime};
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct BackupInfo {
    pub file_name: String,
    pub path: String,
    pub size: u64,
    pub created_at: String,
    pub kind: String,
}

fn kind_of(name: &str) -> &'static str {
    if name.starts_with("digistock-backup-auto-") {
        "automatic"
    } else if name.starts_with("digistock-avant-restauration-") {
        "pre_restore"
    } else {
        "manual"
    }
}

pub fn file_name(kind: &str) -> String {
    let stamp = Local::now().format("%Y-%m-%d-%H%M").to_string();
    match kind {
        "automatic" => format!("digistock-backup-auto-{stamp}.db"),
        "pre_restore" => format!("digistock-avant-restauration-{stamp}.db"),
        _ => format!("digistock-backup-{stamp}.db"),
    }
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let mut p = dir.join(name);
    let mut i = 2;
    while p.exists() {
        let stem = name.trim_end_matches(".db");
        p = dir.join(format!("{stem}-{i}.db"));
        i += 1;
    }
    p
}

pub fn vacuum_into(conn: &Connection, target: &Path) -> AppResult<()> {
    if target.exists() {
        fs::remove_file(target)?;
    }
    conn.execute("VACUUM INTO ?", [target.to_string_lossy().to_string()])?;
    Ok(())
}

pub fn create(conn: &Connection, dir: &Path, kind: &str) -> AppResult<BackupInfo> {
    fs::create_dir_all(dir)?;
    let name = file_name(kind);
    let path = unique_path(dir, &name);
    vacuum_into(conn, &path)?;
    let size = fs::metadata(&path)?.len();
    let fname = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let now = db::now();
    conn.execute(
        "INSERT INTO backups (file_name, path, size, kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![fname, path.to_string_lossy(), size as i64, kind, now],
    )?;
    db::set_setting(conn, "backup.last_at", &json!(now))?;
    if kind == "automatic" {
        db::set_setting(conn, "backup.last_auto_at", &json!(now))?;
    }
    log::info!("Sauvegarde créée : {fname}");
    Ok(BackupInfo { file_name: fname, path: path.to_string_lossy().to_string(), size, created_at: now, kind: kind.into() })
}

pub fn list(dir: &Path) -> AppResult<Vec<BackupInfo>> {
    let mut out = Vec::new();
    if !dir.exists() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().to_string();
        if !name.ends_with(".db") {
            continue;
        }
        let meta = entry.metadata()?;
        let modified: chrono::DateTime<Local> = meta.modified().map(Into::into).unwrap_or_else(|_| Local::now());
        out.push(BackupInfo {
            kind: kind_of(&name).into(),
            file_name: name,
            path: entry.path().to_string_lossy().to_string(),
            size: meta.len(),
            created_at: modified.format("%Y-%m-%d %H:%M:%S").to_string(),
        });
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

/// Vérifie qu'un fichier est bien une base DigiStock intègre.
pub fn validate_file(path: &Path) -> AppResult<()> {
    let invalid = || AppError::validation("Ce fichier n'est pas une sauvegarde DigiStock valide.");
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| invalid())?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| invalid())?;
    if check != "ok" {
        return Err(AppError::validation("La sauvegarde est endommagée et ne peut pas être restaurée."));
    }
    for t in ["schema_migrations", "companies", "products", "sales", "users"] {
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", [t], |r| r.get(0))
            .map_err(|_| invalid())?;
        if n == 0 {
            return Err(invalid());
        }
    }
    let max: i64 = conn.query_row("SELECT COALESCE(MAX(version),0) FROM schema_migrations", [], |r| r.get(0)).map_err(|_| invalid())?;
    let supported = db::MIGRATIONS.iter().map(|m| m.0).max().unwrap_or(0);
    if max > supported {
        return Err(AppError::validation("Cette sauvegarde provient d'une version plus récente de DigiStock. Mettez à jour l'application."));
    }
    Ok(())
}

/// Restaure une sauvegarde. Une copie de la base actuelle est créée au préalable.
pub fn restore(state: &AppState, source: &Path) -> AppResult<BackupInfo> {
    validate_file(source)?;
    let mut guard = state.db.lock().unwrap_or_else(|e| e.into_inner());
    let safety = create(&guard, &state.backups_dir(), "pre_restore")?;
    let tmp = state.db_path.with_extension("restore-tmp");
    fs::copy(source, &tmp)?;
    // Fermeture de la connexion courante avant remplacement du fichier.
    *guard = db::open_in_memory()?;
    let result = (|| -> AppResult<Connection> {
        for ext in ["db-wal", "db-shm"] {
            let p = state.db_path.with_extension(ext);
            if p.exists() {
                fs::remove_file(p)?;
            }
        }
        fs::rename(&tmp, &state.db_path)?;
        let mut conn = db::open(&state.db_path)?;
        db::migrate(&mut conn)?;
        Ok(conn)
    })();
    match result {
        Ok(conn) => {
            *guard = conn;
            state.set_session(None);
            log::info!("Base restaurée depuis {}", source.display());
            Ok(safety)
        }
        Err(e) => {
            log::error!("Échec de restauration : {e}");
            let _ = fs::copy(&safety.path, &state.db_path);
            *guard = db::open(&state.db_path)?;
            Err(AppError::validation("La restauration a échoué. La base actuelle a été conservée."))
        }
    }
}

fn prune(dir: &Path, keep: usize) -> AppResult<()> {
    let autos: Vec<BackupInfo> = list(dir)?.into_iter().filter(|b| b.kind == "automatic").collect();
    for b in autos.into_iter().skip(keep) {
        let _ = fs::remove_file(&b.path);
    }
    Ok(())
}

/// Vérifie si une sauvegarde automatique est due et l'effectue. Retourne le fichier créé.
pub fn auto_tick(state: &AppState) -> AppResult<Option<BackupInfo>> {
    let conn = state.conn();
    if !premium::is_active(&conn) || !db::setting_bool(&conn, "backup.auto_enabled", false) {
        return Ok(None);
    }
    let freq = db::setting_str(&conn, "backup.frequency", "daily");
    let hours = if freq == "weekly" { 24 * 7 } else { 24 };
    let last = db::setting_str(&conn, "backup.last_auto_at", "");
    let due = match NaiveDateTime::parse_from_str(&last, "%Y-%m-%d %H:%M:%S") {
        Ok(t) => Local::now().naive_local().signed_duration_since(t).num_hours() >= hours,
        Err(_) => true,
    };
    if !due {
        return Ok(None);
    }
    let info = create(&conn, &state.backups_dir(), "automatic")?;
    let keep = db::setting_f64(&conn, "backup.keep", 7.0).max(1.0) as usize;
    prune(&state.backups_dir(), keep)?;
    crate::notify::push(&conn, "backup", "success", "Sauvegarde terminée", &format!("Sauvegarde automatique : {}", info.file_name), None, None)?;
    Ok(Some(info))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_is_valid_and_restorable_file() {
        let dir = std::env::temp_dir().join(format!("digistock-test-{}", uuid::Uuid::new_v4()));
        let c = crate::db::test_conn();
        c.execute("INSERT INTO companies (id, name) VALUES (1, 'Demo')", []).unwrap();
        let info = create(&c, &dir, "manual").unwrap();
        assert!(info.file_name.starts_with("digistock-backup-"));
        assert!(validate_file(Path::new(&info.path)).is_ok());
        let bogus = dir.join("bogus.db");
        fs::write(&bogus, b"not a database").unwrap();
        assert!(validate_file(&bogus).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
