//! Gestion du service WhatsApp (sidecar Node.js + whatsapp-web.js).
//!
//! Communication strictement locale via stdin/stdout (JSON par ligne) :
//! aucun port réseau n'est ouvert. Le navigateur utilisé est Microsoft Edge
//! ou Google Chrome déjà installé sur le poste.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct WaStatus {
    /// disconnected | starting | qr | connecting | connected | error
    pub state: String,
    pub qr: Option<String>,
    pub number: Option<String>,
    pub name: Option<String>,
    pub error: Option<String>,
}

impl Default for WaStatus {
    fn default() -> Self {
        Self { state: "disconnected".into(), qr: None, number: None, name: None, error: None }
    }
}

#[derive(Default)]
pub struct WhatsApp {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    status: Arc<Mutex<WaStatus>>,
    pending: Arc<Mutex<HashMap<u64, Sender<Result<Value, String>>>>>,
    next_id: AtomicU64,
}

fn browser_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![];
    for var in ["ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            let b = PathBuf::from(base);
            candidates.push(b.join("Microsoft/Edge/Application/msedge.exe"));
            candidates.push(b.join("Google/Chrome/Application/chrome.exe"));
        }
    }
    candidates.into_iter().find(|p| p.exists())
}

/// Retire le préfixe de chemin étendu Windows que Node.js ne sait pas résoudre.
fn plain(p: &std::path::Path) -> PathBuf {
    let s = p.to_string_lossy();
    PathBuf::from(s.strip_prefix(r"\\?\").unwrap_or(&s).to_string())
}

fn node_path() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(if cfg!(windows) { "node.exe" } else { "node" });
            if bundled.exists() {
                return plain(&bundled);
            }
        }
    }
    PathBuf::from("node")
}

fn script_path(app: &AppHandle) -> AppResult<PathBuf> {
    let mut candidates = vec![];
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join("whatsapp").join("index.cjs"));
        candidates.push(res.join("resources").join("whatsapp").join("index.cjs"));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("whatsapp").join("index.cjs"));
    candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| plain(&p))
        .ok_or_else(|| AppError::Internal("Service WhatsApp introuvable. Réinstallez DigiStock.".into()))
}

impl WhatsApp {
    pub fn status(&self) -> WaStatus {
        self.status.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    fn set_status(status: &Arc<Mutex<WaStatus>>, app: &AppHandle, f: impl FnOnce(&mut WaStatus)) {
        let snapshot = {
            let mut s = status.lock().unwrap_or_else(|e| e.into_inner());
            f(&mut s);
            s.clone()
        };
        let _ = app.emit("wa://status", snapshot);
    }

    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            Some(child) => matches!(child.try_wait(), Ok(None)),
            None => false,
        }
    }

    pub fn start(&self, app: &AppHandle, session_dir: PathBuf) -> AppResult<WaStatus> {
        if self.is_running() {
            return Ok(self.status());
        }
        let browser = browser_path().ok_or_else(|| {
            AppError::validation("Microsoft Edge ou Google Chrome est requis pour WhatsApp. Installez l'un des deux navigateurs.")
        })?;
        let script = script_path(app)?;
        std::fs::create_dir_all(&session_dir)?;
        let mut cmd = Command::new(node_path());
        cmd.arg(&script)
            .env("WA_SESSION_DIR", plain(&session_dir))
            .env("WA_BROWSER", &browser)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        let mut child = cmd.spawn().map_err(|e| AppError::Internal(format!("Impossible de démarrer le service WhatsApp : {e}")))?;
        let stdout = child.stdout.take().ok_or_else(|| AppError::Internal("stdout indisponible".into()))?;
        let stderr = child.stderr.take();
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = child.stdin.take();
        *self.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
        Self::set_status(&self.status, app, |s| *s = WaStatus { state: "starting".into(), ..Default::default() });

        let status = self.status.clone();
        let pending = self.pending.clone();
        let app2 = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                let Ok(msg) = serde_json::from_str::<Value>(&line) else {
                    log::debug!("[whatsapp] {line}");
                    continue;
                };
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if let Some(tx) = pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id) {
                        let res = if msg.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
                            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
                        } else {
                            Err(msg.get("error").and_then(|v| v.as_str()).unwrap_or("Erreur WhatsApp").to_string())
                        };
                        let _ = tx.send(res);
                    }
                    continue;
                }
                let event = msg.get("event").and_then(|v| v.as_str()).unwrap_or("");
                match event {
                    "qr" => Self::set_status(&status, &app2, |s| {
                        s.state = "qr".into();
                        s.qr = msg.get("qr").and_then(|v| v.as_str()).map(String::from);
                    }),
                    "authenticated" | "loading" => Self::set_status(&status, &app2, |s| {
                        s.state = "connecting".into();
                        s.qr = None;
                    }),
                    "ready" => {
                        Self::set_status(&status, &app2, |s| {
                            s.state = "connected".into();
                            s.qr = None;
                            s.error = None;
                            s.number = msg.get("number").and_then(|v| v.as_str()).map(String::from);
                            s.name = msg.get("name").and_then(|v| v.as_str()).map(String::from);
                        });
                        let _ = app2.emit("wa://ready", ());
                        if let Some(state) = app2.try_state::<crate::state::AppState>() {
                            let _ = crate::notify::push(&state.conn(), "whatsapp", "success", "WhatsApp connecté", "Les envois WhatsApp sont disponibles.", None, None);
                        }
                        log::info!("WhatsApp connecté");
                    }
                    "auth_failure" | "error" => Self::set_status(&status, &app2, |s| {
                        s.state = "error".into();
                        s.qr = None;
                        s.error = msg.get("message").and_then(|v| v.as_str()).map(String::from);
                    }),
                    "disconnected" => Self::set_status(&status, &app2, |s| *s = WaStatus { state: "disconnected".into(), ..Default::default() }),
                    "log" => log::info!("[whatsapp] {}", msg.get("message").and_then(|v| v.as_str()).unwrap_or("")),
                    _ => {}
                }
            }
            // Fin du processus : on libère les requêtes en attente.
            for (_, tx) in pending.lock().unwrap_or_else(|e| e.into_inner()).drain() {
                let _ = tx.send(Err("Le service WhatsApp s'est arrêté.".into()));
            }
            Self::set_status(&status, &app2, |s| {
                if matches!(s.state.as_str(), "starting" | "qr" | "connecting") {
                    *s = WaStatus { state: "error".into(), error: Some("Le service WhatsApp s'est arrêté de façon inattendue. Consultez le journal technique.".into()), ..Default::default() };
                } else if s.state != "error" {
                    *s = WaStatus { state: "disconnected".into(), ..Default::default() };
                }
            });
        });
        if let Some(err) = stderr {
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    log::warn!("[whatsapp:stderr] {line}");
                }
            });
        }
        Ok(self.status())
    }

    pub fn request(&self, cmd: &str, args: Value, timeout: Duration) -> AppResult<Value> {
        if !self.is_running() {
            return Err(AppError::validation("WhatsApp n'est pas connecté."));
        }
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = channel();
        self.pending.lock().unwrap_or_else(|e| e.into_inner()).insert(id, tx);
        let line = json!({ "id": id, "cmd": cmd, "args": args }).to_string();
        {
            let mut guard = self.stdin.lock().unwrap_or_else(|e| e.into_inner());
            let stdin = guard.as_mut().ok_or_else(|| AppError::validation("WhatsApp n'est pas connecté."))?;
            writeln!(stdin, "{line}").and_then(|_| stdin.flush()).map_err(|_| AppError::validation("Le service WhatsApp ne répond pas."))?;
        }
        match rx.recv_timeout(timeout) {
            Ok(Ok(v)) => Ok(v),
            Ok(Err(e)) => Err(AppError::Validation(e)),
            Err(_) => {
                self.pending.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
                Err(AppError::validation("WhatsApp n'a pas répondu à temps. Réessayez."))
            }
        }
    }

    pub fn stop(&self) {
        if self.is_running() {
            let _ = self.request("shutdown", Value::Null, Duration::from_secs(5));
        }
        if let Some(mut child) = self.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
            std::thread::sleep(Duration::from_millis(300));
            let _ = child.kill();
            let _ = child.wait();
        }
        *self.stdin.lock().unwrap_or_else(|e| e.into_inner()) = None;
        let mut s = self.status.lock().unwrap_or_else(|e| e.into_inner());
        *s = WaStatus { state: "disconnected".into(), ..Default::default() };
    }
}

/// Normalise un numéro marocain au format international sans « + » (ex. 212612345678).
pub fn normalize_phone(raw: &str) -> Option<String> {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    let n = if let Some(rest) = digits.strip_prefix("00") {
        rest.to_string()
    } else if digits.starts_with('0') && digits.len() == 10 {
        format!("212{}", &digits[1..])
    } else if digits.len() == 9 && (digits.starts_with('6') || digits.starts_with('7') || digits.starts_with('5')) {
        format!("212{digits}")
    } else {
        digits
    };
    (n.len() >= 10 && n.len() <= 15).then_some(n)
}

#[cfg(test)]
mod tests {
    use super::normalize_phone;

    #[test]
    fn moroccan_numbers() {
        assert_eq!(normalize_phone("06 12 34 56 78").as_deref(), Some("212612345678"));
        assert_eq!(normalize_phone("+212 6 12 34 56 78").as_deref(), Some("212612345678"));
        assert_eq!(normalize_phone("00212712345678").as_deref(), Some("212712345678"));
        assert_eq!(normalize_phone("612345678").as_deref(), Some("212612345678"));
        assert_eq!(normalize_phone("123"), None);
    }
}
