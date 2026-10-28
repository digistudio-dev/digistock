//! Point d'entrée unique des droits Premium.
//!
//! Toutes les vérifications de l'application passent par ici (`is_active`, `has_feature`, `require`) et reposent sur
//! l'état de licence **vérifié** (`license.rs` : certificat signé par le serveur). Aucun indicateur modifiable n'existe.
//!
//! Compatibilité : les clients déjà activés avec l'ancien mécanisme (cinq codes fixes, état signé localement et lié à la
//! machine) conservent Premium tant que cet état reste valide ; ils ne sont pas invalidés par la mise à jour. Les anciens
//! codes ne s'activent plus localement : ils sont traités côté serveur comme des licences à vie à un appareil.

use crate::error::{AppError, AppResult};
use crate::license::{self, Claims, LicenseState};
use hmac::{Hmac, Mac};
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

/// Droit « premium » porté par tous les certificats actuels.
pub const FEATURE_PREMIUM: &str = "premium";

// --- état hérité (anciennes activations) : vérification seulement ---
const LEGACY_SIGNING_KEY: &[u8] = b"DigiStudio::DigiStock::premium-state::v1::7f3c9a";
const LEGACY_SLOTS: i64 = 5;

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn legacy_machine_hash() -> String {
    let id = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let mut h = Sha256::new();
    h.update(b"digistock-machine:");
    h.update(id.as_bytes());
    hex::encode(h.finalize())
}

fn legacy_sign(slot: i64, activated_at: &str, machine: &str) -> String {
    let mut mac = Hmac::<Sha256>::new_from_slice(LEGACY_SIGNING_KEY).expect("clé HMAC");
    mac.update(format!("{slot}|{activated_at}|{machine}").as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Date d'activation de l'ancienne licence si son état signé est intact et lié à cette machine.
fn legacy_activated_at(conn: &Connection) -> Option<String> {
    let row: Option<(i64, String, String, String)> = conn
        .query_row("SELECT slot, activated_at, machine_hash, signature FROM premium_activation WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .optional()
        .ok()
        .flatten();
    let (slot, at, machine, sig) = row?;
    let valid = machine == legacy_machine_hash() && constant_time_eq(legacy_sign(slot, &at, &machine).as_bytes(), sig.as_bytes()) && (1..=LEGACY_SLOTS).contains(&slot);
    valid.then_some(at)
}

// --- statut exposé à l'interface ---
#[derive(Debug, Serialize, Clone)]
pub struct PremiumStatus {
    pub active: bool,
    pub activated_at: Option<String>,
    /// licensed | legacy | expired | clock_rollback | offline_expired | denied | invalid | unlicensed
    pub state: String,
    /// lifetime | annual | legacy
    pub kind: Option<String>,
    pub reference: Option<String>,
    pub plan: Option<String>,
    pub expires_at: Option<String>,
    pub last_validated_at: Option<String>,
    pub needs_validation: bool,
    pub denied_code: Option<String>,
    pub features: Vec<String>,
    pub installation_short: String,
    pub device_label: String,
}

fn status_from(conn: &Connection, ev: license::Evaluation) -> PremiumStatus {
    let stored = license::load(conn).unwrap_or_default();
    let state_name = match ev.state {
        LicenseState::Licensed => "licensed",
        LicenseState::Expired => "expired",
        LicenseState::ClockRollback => "clock_rollback",
        LicenseState::OfflineExpired => "offline_expired",
        LicenseState::Denied => "denied",
        LicenseState::Invalid => "invalid",
        LicenseState::Unlicensed => "unlicensed",
    };
    let mut st = PremiumStatus {
        active: ev.active(),
        activated_at: None,
        state: state_name.into(),
        kind: None,
        reference: None,
        plan: None,
        expires_at: None,
        last_validated_at: if stored.last_online_ok > 0 { license::iso(stored.last_online_ok) } else { None },
        needs_validation: ev.needs_validation,
        denied_code: stored.denied_code.clone().filter(|c| c != "tampered"),
        features: vec![],
        installation_short: stored.installation.chars().skip(3).take(8).collect(),
        device_label: license::device_label(),
    };
    if let Some(c) = &ev.claims {
        let Claims { typ, reference, plan, lexp, feat, act, .. } = c.clone();
        st.kind = Some(typ);
        st.reference = Some(reference);
        st.plan = Some(plan);
        st.expires_at = lexp.and_then(license::iso);
        st.activated_at = license::iso(act);
        if ev.active() {
            st.features = feat;
        }
    }
    // Anciens clients : l'activation héritée reste valable tant qu'aucune licence signée n'est en jeu.
    if !st.active && (ev.state == LicenseState::Unlicensed || ev.state == LicenseState::Invalid) {
        if let Some(at) = legacy_activated_at(conn) {
            st.active = true;
            st.activated_at = Some(at);
            st.state = "legacy".into();
            st.kind = Some("legacy".into());
            st.features = vec![FEATURE_PREMIUM.into()];
            st.needs_validation = false;
            st.denied_code = None;
        }
    }
    st
}

pub fn status(conn: &Connection) -> PremiumStatus {
    status_from(conn, license::current(conn))
}

pub fn has_feature(conn: &Connection, feature: &str) -> bool {
    status(conn).features.iter().any(|f| f == feature)
}

pub fn is_active(conn: &Connection) -> bool {
    has_feature(conn, FEATURE_PREMIUM)
}

pub fn require(conn: &Connection) -> AppResult<()> {
    if is_active(conn) {
        Ok(())
    } else {
        Err(AppError::Premium)
    }
}

/// Retire les licences de cet appareil (les données métier ne sont jamais touchées).
pub fn deactivate_local(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM premium_activation", [])?;
    license::clear_certificate(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use ed25519_dalek::{Signer, SigningKey};

    fn token(key: &SigningKey, inst: &str, dev: &str, typ: &str, iat: i64, exp: Option<i64>) -> String {
        let claims = serde_json::json!({ "v": 1, "jti": "j", "lic": "l", "ref": "LIC-T", "prd": "digistock", "plan": "p", "typ": typ, "feat": ["premium"],
            "inst": inst, "dev": dev, "iat": iat, "exp": exp, "lexp": exp, "vev": 30, "act": iat });
        let h = URL_SAFE_NO_PAD.encode(r#"{"alg":"EdDSA","typ":"dsl+jwt","kid":"t"}"#);
        let b = URL_SAFE_NO_PAD.encode(claims.to_string());
        format!("{h}.{b}.{}", URL_SAFE_NO_PAD.encode(key.sign(format!("{h}.{b}").as_bytes()).to_bytes()))
    }

    #[test]
    fn free_edition_has_no_premium_feature() {
        let conn = crate::db::test_conn();
        let s = status(&conn);
        assert!(!s.active && s.state == "unlicensed" && s.features.is_empty());
        assert!(matches!(require(&conn), Err(AppError::Premium)));
        assert!(!has_feature(&conn, "whatsapp"));
    }

    #[test]
    fn tampered_legacy_state_is_rejected() {
        let conn = crate::db::test_conn();
        conn.execute("INSERT INTO premium_activation (id, slot, activated_at, machine_hash, signature) VALUES (1, 1, '2026-01-01 00:00:00', 'x', 'y')", []).unwrap();
        assert!(!is_active(&conn));
    }

    #[test]
    fn existing_legacy_activation_keeps_working_after_the_update() {
        let conn = crate::db::test_conn();
        let (at, machine) = ("2026-01-01 00:00:00", legacy_machine_hash());
        conn.execute(
            "INSERT INTO premium_activation (id, slot, activated_at, machine_hash, signature) VALUES (1, 3, ?1, ?2, ?3)",
            rusqlite::params![at, machine, legacy_sign(3, at, &machine)],
        )
        .unwrap();
        let s = status(&conn);
        assert!(s.active && s.state == "legacy" && s.kind.as_deref() == Some("legacy"));
        assert!(is_active(&conn));
        conn.execute("UPDATE premium_activation SET slot = 9, signature = ?1", [legacy_sign(9, at, &machine)]).unwrap();
        assert!(!is_active(&conn));
    }

    #[test]
    fn signed_certificate_unlocks_premium_and_expiry_preserves_the_free_edition() {
        let conn = crate::db::test_conn();
        let key = SigningKey::from_bytes(&[9u8; 32]);
        let pubkey = URL_SAFE_NO_PAD.encode(key.verifying_key().to_bytes());
        let keys = [("t", pubkey.as_str())];
        let stored = license::load(&conn).unwrap();
        let (dev, now) = ("dev_test_device_00000000", 1_800_000_000i64);
        let t = token(&key, &stored.installation, dev, "annual", now - 100 * 86400, Some(now + 10 * 86400));
        license::save(&conn, &license::Stored { certificate: Some(t), ..stored.clone() }).unwrap();
        let s = status_from(&conn, license::current_with(&conn, &keys, dev, now));
        assert!(s.active && s.state == "licensed" && s.kind.as_deref() == Some("annual") && s.features == vec!["premium".to_string()]);
        // l'échéance passe : Premium se coupe, les données métier restent
        conn.execute("CREATE TABLE _biz(x)", []).unwrap();
        conn.execute("INSERT INTO _biz VALUES (1)", []).unwrap();
        let s2 = status_from(&conn, license::current_with(&conn, &keys, dev, now + 11 * 86400));
        assert!(!s2.active && s2.state == "expired" && s2.features.is_empty() && s2.expires_at.is_some());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM _biz", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        // l'horloge est ensuite remontée : l'accès reste coupé (date de référence mémorisée)
        assert!(!license::current_with(&conn, &keys, dev, now - 50 * 86400).active());
        // un autre appareil est refusé
        assert!(!license::current_with(&conn, &keys, "dev_autre_000000000000", now).active());
    }
}
