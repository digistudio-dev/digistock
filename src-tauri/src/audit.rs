use crate::db;
use crate::error::AppResult;
use crate::state::Session;
use rusqlite::{params, Connection};
use serde_json::Value;

/// Enregistre une action importante dans le journal d'activité.
/// Ne jamais y placer de mot de passe ou de code d'activation.
pub fn log(
    conn: &Connection,
    session: Option<&Session>,
    action: &str,
    entity: Option<&str>,
    entity_id: Option<i64>,
    description: &str,
    metadata: Option<Value>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, description, metadata, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            session.map(|s| s.user_id),
            session.map(|s| s.name.clone()),
            action,
            entity,
            entity_id,
            description,
            metadata.map(|m| m.to_string()),
            db::now()
        ],
    )?;
    Ok(())
}
