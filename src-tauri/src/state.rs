use crate::error::{AppError, AppResult};
use crate::premium;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize)]
pub struct Session {
    pub user_id: i64,
    pub name: String,
    pub username: String,
    pub role_id: Option<i64>,
    pub role_name: Option<String>,
    pub permissions: Vec<String>,
}

impl Session {
    pub fn can(&self, perm: &str) -> bool {
        self.permissions.iter().any(|p| p == perm)
    }
}

pub struct AppState {
    pub db: Mutex<Connection>,
    pub db_path: PathBuf,
    pub data_dir: PathBuf,
    pub session: Mutex<Option<Session>>,
    pub failed_logins: Mutex<u32>,
}

impl AppState {
    pub fn new(db: Connection, db_path: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            db: Mutex::new(db),
            db_path,
            data_dir,
            session: Mutex::new(None),
            failed_logins: Mutex::new(0),
        }
    }

    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.db.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn session(&self) -> AppResult<Session> {
        self.session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or(AppError::Unauthenticated)
    }

    pub fn set_session(&self, s: Option<Session>) {
        *self.session.lock().unwrap_or_else(|e| e.into_inner()) = s;
    }

    /// Retourne la session courante si l'utilisateur dispose de la permission.
    pub fn require(&self, perm: &str) -> AppResult<Session> {
        let s = self.session()?;
        if s.can(perm) {
            Ok(s)
        } else {
            Err(AppError::Forbidden)
        }
    }

    pub fn images_dir(&self) -> PathBuf {
        self.data_dir.join("images")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
}

/// Construit la session d'un utilisateur (rôle + permissions effectives).
pub fn load_session(conn: &Connection, user_id: i64) -> AppResult<Session> {
    let (name, username): (String, String) =
        conn.query_row("SELECT name, username FROM users WHERE id = ?", [user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let role: Option<(i64, String)> = conn
        .query_row(
            "SELECT r.id, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? LIMIT 1",
            [user_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let mut permissions: Vec<String> = Vec::new();
    if let Some((role_id, _)) = &role {
        let mut stmt = conn.prepare("SELECT permission_code FROM role_permissions WHERE role_id = ?")?;
        let rows = stmt.query_map([role_id], |r| r.get::<_, String>(0))?;
        for p in rows {
            permissions.push(p?);
        }
    }
    // En version gratuite, l'unique compte administrateur dispose de toutes les permissions.
    if !premium::is_active(conn) && role.as_ref().map(|r| r.0) == Some(1) {
        let mut stmt = conn.prepare("SELECT code FROM permissions")?;
        permissions = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<_, _>>()?;
    }
    Ok(Session {
        user_id,
        name,
        username,
        role_id: role.as_ref().map(|r| r.0),
        role_name: role.map(|r| r.1),
        permissions,
    })
}
