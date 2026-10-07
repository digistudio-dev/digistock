//! Activation DigiStock Premium — entièrement hors ligne.
//!
//! * Le code saisi est normalisé puis haché (SHA-256 + préfixe) et comparé aux 5 empreintes autorisées.
//! * L'état d'activation est signé (HMAC-SHA256) et lié à la machine : modifier la base
//!   ou la copier sur un autre poste invalide l'activation.

use crate::db;
use crate::error::{AppError, AppResult};
use crate::premium_codes::ACTIVATION_HASHES;
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

const PEPPER: &str = "digistock:v1:";
const SIGNING_KEY: &[u8] = b"DigiStudio::DigiStock::premium-state::v1::7f3c9a";

pub fn normalize(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_uppercase()).collect()
}

pub fn hash_code(code: &str) -> String {
    let mut h = Sha256::new();
    h.update(PEPPER.as_bytes());
    h.update(normalize(code).as_bytes());
    hex::encode(h.finalize())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Retourne l'emplacement (1..=5) du code s'il est valide.
pub fn validate_against(code: &str, hashes: &[&str]) -> Option<usize> {
    if normalize(code).len() < 8 {
        return None;
    }
    let candidate = hash_code(code);
    let mut found = None;
    for (i, h) in hashes.iter().enumerate() {
        if !h.is_empty() && constant_time_eq(candidate.as_bytes(), h.to_ascii_lowercase().as_bytes()) {
            found = Some(i + 1);
        }
    }
    found
}

pub fn validate(code: &str) -> Option<usize> {
    validate_against(code, &ACTIVATION_HASHES)
}

fn machine_hash() -> String {
    let id = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let mut h = Sha256::new();
    h.update(b"digistock-machine:");
    h.update(id.as_bytes());
    hex::encode(h.finalize())
}

fn sign(slot: i64, activated_at: &str, machine: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(SIGNING_KEY).expect("clé HMAC");
    mac.update(format!("{slot}|{activated_at}|{machine}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

#[derive(Debug, Serialize, Clone)]
pub struct PremiumStatus {
    pub active: bool,
    pub activated_at: Option<String>,
}

pub fn status(conn: &Connection) -> PremiumStatus {
    let row: Option<(i64, String, String, String)> = conn
        .query_row(
            "SELECT slot, activated_at, machine_hash, signature FROM premium_activation WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .ok()
        .flatten();
    match row {
        Some((slot, at, machine, sig)) => {
            let current = machine_hash();
            let valid = machine == current
                && constant_time_eq(sign(slot, &at, &machine).as_bytes(), sig.as_bytes())
                && slot >= 1
                && (slot as usize) <= ACTIVATION_HASHES.len()
                && !ACTIVATION_HASHES[(slot - 1) as usize].is_empty();
            PremiumStatus { active: valid, activated_at: valid.then_some(at) }
        }
        None => PremiumStatus { active: false, activated_at: None },
    }
}

pub fn is_active(conn: &Connection) -> bool {
    status(conn).active
}

pub fn require(conn: &Connection) -> AppResult<()> {
    if is_active(conn) {
        Ok(())
    } else {
        Err(AppError::Premium)
    }
}

pub fn activate(conn: &Connection, code: &str) -> AppResult<PremiumStatus> {
    let slot = validate(code).ok_or_else(|| AppError::validation("Code d'activation invalide. Vérifiez le code et réessayez."))?;
    let at = db::now();
    let machine = machine_hash();
    let sig = sign(slot as i64, &at, &machine);
    conn.execute(
        "INSERT INTO premium_activation (id, slot, activated_at, machine_hash, signature) VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET slot = excluded.slot, activated_at = excluded.activated_at,
           machine_hash = excluded.machine_hash, signature = excluded.signature",
        params![slot as i64, at, machine, sig],
    )?;
    Ok(status(conn))
}

pub fn deactivate(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM premium_activation", [])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization() {
        assert_eq!(normalize(" dgs-ab12 cd34 "), "DGSAB12CD34");
    }

    #[test]
    fn validates_known_hash_only() {
        let code = "DGS-TEST-AAAA-BBBB-CCCC";
        let h = hash_code(code);
        let hashes = ["", h.as_str(), "", "", ""];
        assert_eq!(validate_against(code, &hashes), Some(2));
        assert_eq!(validate_against("dgs test aaaa bbbb cccc", &hashes), Some(2));
        assert_eq!(validate_against("DGS-TEST-AAAA-BBBB-CCCD", &hashes), None);
        assert_eq!(validate_against("", &hashes), None);
        assert_eq!(validate_against("short", &hashes), None);
    }

    #[test]
    fn empty_slots_never_match() {
        let hashes = ["", "", "", "", ""];
        assert_eq!(validate_against("ANYTHING-12345678", &hashes), None);
    }

    #[test]
    fn tampered_state_is_rejected() {
        let conn = crate::db::test_conn();
        assert!(!is_active(&conn));
        conn.execute(
            "INSERT INTO premium_activation (id, slot, activated_at, machine_hash, signature) VALUES (1, 1, '2026-01-01 00:00:00', 'x', 'y')",
            [],
        )
        .unwrap();
        assert!(!is_active(&conn));
    }
}
