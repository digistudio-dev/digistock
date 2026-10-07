use crate::error::{AppError, AppResult};
use chrono::{Datelike, Local};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{Map, Value};
use std::path::Path;

/// Migrations embarquées. Ne jamais modifier une migration publiée :
/// ajouter un nouveau fichier `NNNN_nom.sql` et l'enregistrer ici.
pub const MIGRATIONS: &[(i64, &str, &str)] = &[(1, "init", include_str!("../migrations/0001_init.sql"))];

pub fn open(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    configure(&conn)?;
    Ok(conn)
}

pub fn open_in_memory() -> AppResult<Connection> {
    let conn = Connection::open_in_memory()?;
    configure(&conn)?;
    Ok(conn)
}

fn configure(conn: &Connection) -> AppResult<()> {
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA temp_store = MEMORY;",
    )?;
    Ok(())
}

pub fn migrate(conn: &mut Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT NOT NULL,
            applied_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );",
    )?;
    for (version, name, sql) in MIGRATIONS {
        let applied: bool = conn
            .query_row("SELECT 1 FROM schema_migrations WHERE version = ?", [version], |_| Ok(true))
            .optional()?
            .unwrap_or(false);
        if applied {
            continue;
        }
        log::info!("Application de la migration {version} ({name})");
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute("INSERT INTO schema_migrations (version, name) VALUES (?, ?)", params![version, name])?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub fn round2(v: f64) -> f64 {
    let r = (v * 100.0).round() / 100.0;
    if r == 0.0 { 0.0 } else { r }
}

pub fn round3(v: f64) -> f64 {
    let r = (v * 1000.0).round() / 1000.0;
    if r == 0.0 { 0.0 } else { r }
}

/// Numérotation sûre des documents : `PREFIX-ANNEE-000001`.
/// Doit être appelée dans une transaction pour garantir l'unicité.
pub fn next_number(tx: &Connection, prefix: &str) -> AppResult<String> {
    let year = Local::now().year();
    let value: i64 = tx.query_row(
        "INSERT INTO document_sequences (prefix, year, value) VALUES (?1, ?2, 1)
         ON CONFLICT(prefix, year) DO UPDATE SET value = value + 1
         RETURNING value",
        params![prefix, year],
        |r| r.get(0),
    )?;
    Ok(format!("{prefix}-{year}-{value:06}"))
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<Value>> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?", [key], |r| r.get(0))
        .optional()?;
    Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn setting_bool(conn: &Connection, key: &str, default: bool) -> bool {
    get_setting(conn, key).ok().flatten().and_then(|v| v.as_bool()).unwrap_or(default)
}

pub fn setting_f64(conn: &Connection, key: &str, default: f64) -> f64 {
    get_setting(conn, key).ok().flatten().and_then(|v| v.as_f64()).unwrap_or(default)
}

pub fn setting_str(conn: &Connection, key: &str, default: &str) -> String {
    get_setting(conn, key)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| default.to_string())
}

pub fn set_setting(conn: &Connection, key: &str, value: &Value) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value.to_string(), now()],
    )?;
    Ok(())
}

pub fn json_to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn value_ref_to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::from(i),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

/// Exécute une requête et retourne les lignes en objets JSON.
pub fn query_json(conn: &Connection, sql: &str, args: &[Value]) -> AppResult<Vec<Map<String, Value>>> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let params: Vec<SqlValue> = args.iter().map(json_to_sql).collect();
    let mut rows = stmt.query(rusqlite::params_from_iter(params.iter()))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), value_ref_to_json(row.get_ref(i)?));
        }
        out.push(obj);
    }
    Ok(out)
}

/// Vérifie qu'une requête est en lecture seule (aucune écriture possible).
pub fn ensure_readonly(conn: &Connection, sql: &str) -> AppResult<()> {
    let lowered = sql.to_lowercase();
    for forbidden in ["password_hash", "signature", "machine_hash", "pragma", "attach", "load_extension"] {
        if lowered.contains(forbidden) {
            return Err(AppError::Forbidden);
        }
    }
    let stmt = conn.prepare(sql)?;
    if !stmt.readonly() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

pub fn opt_str(v: &Option<String>) -> Option<String> {
    v.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

#[cfg(test)]
pub fn test_conn() -> Connection {
    let mut c = open_in_memory().unwrap();
    migrate(&mut c).unwrap();
    c
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let mut c = test_conn();
        migrate(&mut c).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM schema_migrations", [], |r| r.get(0)).unwrap();
        assert_eq!(n, MIGRATIONS.len() as i64);
    }

    #[test]
    fn numbering_increments() {
        let mut c = test_conn();
        let tx = c.transaction().unwrap();
        let a = next_number(&tx, "V").unwrap();
        let b = next_number(&tx, "V").unwrap();
        let p = next_number(&tx, "ACH").unwrap();
        tx.commit().unwrap();
        let year = Local::now().year();
        assert_eq!(a, format!("V-{year}-000001"));
        assert_eq!(b, format!("V-{year}-000002"));
        assert_eq!(p, format!("ACH-{year}-000001"));
    }

    #[test]
    fn readonly_guard() {
        let c = test_conn();
        assert!(ensure_readonly(&c, "SELECT * FROM products").is_ok());
        assert!(ensure_readonly(&c, "DELETE FROM products").is_err());
        assert!(ensure_readonly(&c, "SELECT password_hash FROM users").is_err());
        assert!(ensure_readonly(&c, "UPDATE products SET quantity = 5").is_err());
    }

    #[test]
    fn rounding() {
        assert_eq!(round2(0.1 + 0.2), 0.3);
        assert_eq!(round2(-0.001), 0.0);
        assert_eq!(round3(1.00049), 1.0);
    }
}
