//! Licences DigiStock Premium : certificats signés (Ed25519) émis par le serveur de licences DigiStudio.
//!
//! * L'activation exige une connexion Internet **une seule fois** : le serveur renvoie un certificat signé,
//!   lié à cette installation et à cet appareil. Seule la clé publique de vérification est embarquée ici.
//! * Ensuite, l'application vérifie le certificat **hors ligne** : signature, produit, installation, appareil,
//!   expiration (licence annuelle) et cohérence de l'horloge. Aucun booléen « premium » modifiable n'existe.
//! * Limites assumées : un poste hors ligne ne peut pas voir une révocation avant sa prochaine connexion ; une
//!   protection d'horloge locale réduit mais n'élimine pas la triche (voir `evaluate`).

use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use hmac::{Hmac, Mac};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const PRODUCT: &str = "digistock";
pub const SUPABASE_URL: &str = "https://wxvrfhlfbkrgudmhmesq.supabase.co";
/// Clé publique (« publishable ») du projet : conçue pour être publique, elle n'ouvre aucune donnée.
const PUBLISHABLE_KEY: &str = "sb_publishable_q_kJhAOjAtZP7O9sBIWMxw_CYQK8juh";
/// Clés publiques de vérification (kid, Ed25519 brut en base64url). Ajouter la nouvelle clé AVANT de retirer l'ancienne lors d'une rotation.
pub const TRUSTED_KEYS: &[(&str, &str)] = &[("dsl-2026-1", "zyPKXyB693oUkV8Dofn2t2hufxGm_uDHEHg9xXa0SzM")];
/// Tolérance sur l'horloge locale avant de la considérer comme remontée dans le temps.
const CLOCK_TOLERANCE_SECS: i64 = 24 * 3600;
const REQUEST_TIMEOUT_SECS: u64 = 15;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Claims {
    pub v: u8,
    pub jti: String,
    pub lic: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub prd: String,
    pub plan: String,
    pub typ: String,
    #[serde(default)]
    pub feat: Vec<String>,
    pub inst: String,
    pub dev: String,
    pub iat: i64,
    #[serde(default)]
    pub exp: Option<i64>,
    #[serde(default)]
    pub lexp: Option<i64>,
    #[serde(default = "default_vev")]
    pub vev: i64,
    #[serde(default)]
    pub mxo: Option<i64>,
    #[serde(default)]
    pub act: i64,
}
fn default_vev() -> i64 {
    30
}

#[derive(Debug, PartialEq)]
pub enum VerifyError {
    Format,
    UnknownKey,
    Signature,
}

fn b64u(s: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(s.trim_end_matches('=')).ok()
}

/// Vérifie la signature et décode les revendications. N'apprécie ni la date ni la liaison à l'appareil (voir `evaluate`).
pub fn verify_token(token: &str, keys: &[(&str, &str)]) -> Result<Claims, VerifyError> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 || token.len() > 4096 {
        return Err(VerifyError::Format);
    }
    #[derive(Deserialize)]
    struct Header {
        alg: String,
        typ: String,
        kid: String,
    }
    let header: Header = serde_json::from_slice(&b64u(parts[0]).ok_or(VerifyError::Format)?).map_err(|_| VerifyError::Format)?;
    if header.alg != "EdDSA" || header.typ != "dsl+jwt" {
        return Err(VerifyError::Format); // l'algorithme n'est jamais choisi par le jeton
    }
    let (_, pub_b64) = keys.iter().find(|(kid, _)| *kid == header.kid).ok_or(VerifyError::UnknownKey)?;
    let pub_bytes: [u8; 32] = b64u(pub_b64).and_then(|b| b.try_into().ok()).ok_or(VerifyError::UnknownKey)?;
    let key = VerifyingKey::from_bytes(&pub_bytes).map_err(|_| VerifyError::UnknownKey)?;
    let sig_bytes: [u8; 64] = b64u(parts[2]).and_then(|b| b.try_into().ok()).ok_or(VerifyError::Format)?;
    key.verify(format!("{}.{}", parts[0], parts[1]).as_bytes(), &Signature::from_bytes(&sig_bytes)).map_err(|_| VerifyError::Signature)?;
    let claims: Claims = serde_json::from_slice(&b64u(parts[1]).ok_or(VerifyError::Format)?).map_err(|_| VerifyError::Format)?;
    if claims.v != 1 {
        return Err(VerifyError::Format);
    }
    Ok(claims)
}

// ------------------------------------------------------------------------------------------------ évaluation (pure, testable)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LicenseState {
    /// Certificat valable : Premium débloqué.
    Licensed,
    /// Licence annuelle échue.
    Expired,
    /// L'horloge du poste est en retard sur une date déjà constatée.
    ClockRollback,
    /// Hors ligne depuis plus longtemps que la politique de la licence ne l'autorise.
    OfflineExpired,
    /// Le serveur a refusé la licence (révoquée, suspendue, appareil libéré…).
    Denied,
    /// Certificat altéré, d'un autre produit, d'une autre installation ou d'un autre appareil.
    Invalid,
    /// Aucune licence.
    Unlicensed,
}

#[derive(Debug, Clone)]
pub struct Evaluation {
    pub state: LicenseState,
    pub claims: Option<Claims>,
    /// Une revalidation en ligne est souhaitable (n'interrompt jamais l'accès).
    pub needs_validation: bool,
}
impl Evaluation {
    pub fn active(&self) -> bool {
        self.state == LicenseState::Licensed
    }
}

pub struct EvalContext<'a> {
    pub installation: &'a str,
    pub device: &'a str,
    pub now: i64,
    /// Plus haute date fiable déjà observée (horloge locale, serveur, émission des certificats).
    pub high_water: i64,
    pub denied_code: Option<&'a str>,
    pub keys: &'a [(&'a str, &'a str)],
}

/// Règles :
/// 1. signature, produit, installation et appareil doivent correspondre ;
/// 2. horloge : si `now` est plus de 24 h en arrière de la plus haute date déjà constatée, ou en arrière de l'émission du certificat, l'accès est suspendu jusqu'à une revalidation en ligne ;
/// 3. licence annuelle : accès coupé après `exp` (échéance signée + grâce), même hors ligne ;
/// 4. licence à vie : jamais coupée par l'écoulement du temps seul, sauf `mxo` (limite hors ligne) si la licence en prévoit une ;
/// 5. `vev` : au-delà, une revalidation est *conseillée* mais ne bloque pas.
pub fn evaluate(token: Option<&str>, ctx: &EvalContext) -> Evaluation {
    let Some(token) = token else {
        return Evaluation { state: LicenseState::Unlicensed, claims: None, needs_validation: false };
    };
    let claims = match verify_token(token, ctx.keys) {
        Ok(c) => c,
        Err(_) => return Evaluation { state: LicenseState::Invalid, claims: None, needs_validation: false },
    };
    let bad = claims.prd != PRODUCT || claims.inst != ctx.installation || claims.dev != ctx.device;
    let mk = |state, nv| Evaluation { state, claims: Some(claims.clone()), needs_validation: nv };
    if bad {
        return mk(LicenseState::Invalid, false);
    }
    let stale = ctx.now > claims.iat + claims.vev * 86_400;
    if let Some(code) = ctx.denied_code {
        let _ = code;
        return mk(LicenseState::Denied, true);
    }
    if ctx.now + CLOCK_TOLERANCE_SECS < ctx.high_water || ctx.now + CLOCK_TOLERANCE_SECS < claims.iat {
        return mk(LicenseState::ClockRollback, true);
    }
    if claims.typ == "annual" {
        match claims.exp {
            Some(exp) if ctx.now > exp => return mk(LicenseState::Expired, true),
            None => return mk(LicenseState::Invalid, false), // une licence annuelle sans échéance n'existe pas
            _ => {}
        }
    }
    if let Some(mxo) = claims.mxo {
        if ctx.now > claims.iat + mxo * 86_400 {
            return mk(LicenseState::OfflineExpired, true);
        }
    }
    mk(LicenseState::Licensed, stale)
}

// ------------------------------------------------------------------------------------------------ identité de l'appareil
pub fn device_hash() -> String {
    let id = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let mut h = Sha256::new();
    h.update(b"digistock-device:v2:");
    h.update(id.as_bytes());
    hex::encode(h.finalize())
}

pub fn device_label() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Ordinateur".into()).chars().take(60).collect()
}

fn state_key() -> Vec<u8> {
    let id = machine_uid::get().unwrap_or_else(|_| "unknown-machine".into());
    let mut h = Sha256::new();
    h.update(b"digistock-license-state:v1:");
    h.update(id.as_bytes());
    h.finalize().to_vec()
}

fn mac_of(installation: &str, high_water: i64, last_ok: i64, denied: &str, key: &[u8]) -> String {
    let mut m = Hmac::<Sha256>::new_from_slice(key).expect("clé HMAC");
    m.update(format!("{installation}|{high_water}|{last_ok}|{denied}").as_bytes());
    hex::encode(m.finalize().into_bytes())
}

pub fn now_unix() -> i64 {
    chrono::Utc::now().timestamp()
}
pub fn iso(ts: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts, 0).map(|d| d.to_rfc3339())
}

// ------------------------------------------------------------------------------------------------ état local persistant
#[derive(Debug, Clone, Default)]
pub struct Stored {
    pub installation: String,
    pub certificate: Option<String>,
    pub high_water: i64,
    pub last_online_ok: i64,
    pub denied_code: Option<String>,
    /// Vrai si l'enregistrement a été retouché hors de l'application (MAC invalide). Non persisté.
    pub tampered: bool,
}

/// Identifiant d'installation : généré aléatoirement au premier besoin, stable ensuite (y compris après mise à jour).
pub fn load(conn: &Connection) -> AppResult<Stored> {
    let row: Option<(String, Option<String>, i64, i64, Option<String>, String)> = conn
        .query_row(
            "SELECT installation_id, certificate, high_water, COALESCE(last_online_ok,0), denied_code, state_mac FROM license_state WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
        )
        .optional()?;
    match row {
        None => {
            let id = format!("ds-{}", uuid::Uuid::new_v4());
            let s = Stored { installation: id, ..Default::default() };
            save(conn, &s)?;
            Ok(s)
        }
        Some((installation, certificate, hw, ok, denied, mac)) => {
            let expected = mac_of(&installation, hw, ok, denied.as_deref().unwrap_or(""), &state_key());
            // Un enregistrement dont le MAC ne correspond pas a été modifié à la main : Premium est suspendu jusqu'à une
            // revalidation en ligne réussie (qui reconstruit un état sain). Jamais plus de droits qu'avant.
            if !constant_eq(mac.as_bytes(), expected.as_bytes()) {
                return Ok(Stored { installation, certificate, high_water: now_unix(), last_online_ok: 0, denied_code: Some("tampered".into()), tampered: true });
            }
            Ok(Stored { installation, certificate, high_water: hw, last_online_ok: ok, denied_code: denied, tampered: false })
        }
    }
}

fn constant_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn save(conn: &Connection, s: &Stored) -> AppResult<()> {
    let mac = mac_of(&s.installation, s.high_water, s.last_online_ok, s.denied_code.as_deref().unwrap_or(""), &state_key());
    conn.execute(
        "INSERT INTO license_state (id, installation_id, certificate, high_water, last_online_ok, denied_code, state_mac)
         VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET installation_id = excluded.installation_id, certificate = excluded.certificate, high_water = excluded.high_water,
           last_online_ok = excluded.last_online_ok, denied_code = excluded.denied_code, state_mac = excluded.state_mac",
        params![s.installation, s.certificate, s.high_water, s.last_online_ok, s.denied_code, mac],
    )?;
    Ok(())
}

/// Évalue la licence maintenant et avance la « plus haute date fiable » (jamais en arrière).
pub fn current(conn: &Connection) -> Evaluation {
    current_with(conn, TRUSTED_KEYS, &device_hash(), now_unix())
}

pub fn current_with(conn: &Connection, keys: &[(&str, &str)], device: &str, now: i64) -> Evaluation {
    let mut stored = match load(conn) {
        Ok(s) => s,
        Err(_) => return Evaluation { state: LicenseState::Unlicensed, claims: None, needs_validation: false },
    };
    let ev = evaluate(
        stored.certificate.as_deref(),
        &EvalContext { installation: &stored.installation, device, now, high_water: stored.high_water, denied_code: stored.denied_code.as_deref(), keys },
    );
    if !stored.tampered && ev.state != LicenseState::ClockRollback && now > stored.high_water + 60 {
        stored.high_water = now;
        let _ = save(conn, &stored);
    }
    ev
}

/// Enregistre un certificat reçu du serveur après l'avoir revérifié localement.
pub fn accept_certificate(conn: &Connection, token: &str, server_time: i64) -> AppResult<Claims> {
    let mut stored = load(conn)?;
    let claims = verify_token(token, TRUSTED_KEYS).map_err(|_| AppError::validation("Certificat de licence refusé : signature invalide."))?;
    if claims.prd != PRODUCT || claims.inst != stored.installation || claims.dev != device_hash() {
        return Err(AppError::validation("Certificat de licence refusé : il ne correspond pas à cet appareil."));
    }
    let now = now_unix();
    stored.certificate = Some(token.to_string());
    stored.high_water = if stored.tampered { now } else { stored.high_water }.max(now).max(server_time).max(claims.iat);
    stored.last_online_ok = server_time.max(now);
    stored.denied_code = None;
    save(conn, &stored)?;
    Ok(claims)
}

pub fn record_denied(conn: &Connection, code: &str) -> AppResult<()> {
    let mut stored = load(conn)?;
    if stored.tampered {
        return Ok(());
    }
    stored.denied_code = Some(code.to_string());
    save(conn, &stored)
}

pub fn clear_certificate(conn: &Connection) -> AppResult<()> {
    let mut stored = load(conn)?;
    stored.certificate = None;
    stored.denied_code = None;
    save(conn, &stored)
}

// ------------------------------------------------------------------------------------------------ réseau
#[derive(Debug)]
pub enum NetError {
    /// Pas de connexion / serveur injoignable.
    Offline,
    /// Refus métier du serveur (code stable : invalid_key, revoked, suspended, expired, device_limit, not_activated…).
    Refused(String),
    /// Réponse inattendue ou erreur serveur.
    Server,
}

pub struct Granted {
    pub certificate: String,
    pub server_time: i64,
}

fn post(function: &str, body: serde_json::Value) -> Result<serde_json::Value, NetError> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECS)).build();
    match agent
        .post(&format!("{SUPABASE_URL}/functions/v1/{function}"))
        .set("apikey", PUBLISHABLE_KEY)
        .set("Content-Type", "application/json")
        .send_json(body)
    {
        Ok(r) => r.into_json::<serde_json::Value>().map_err(|_| NetError::Server),
        Err(ureq::Error::Status(code, r)) => {
            let v: serde_json::Value = r.into_json().unwrap_or(serde_json::Value::Null);
            let c = v["error"]["code"].as_str().map(str::to_string);
            match (code, c) {
                (_, Some(c)) if code < 500 => Err(NetError::Refused(c)),
                _ => Err(NetError::Server),
            }
        }
        Err(ureq::Error::Transport(_)) => Err(NetError::Offline),
    }
}

fn granted(v: serde_json::Value) -> Result<Granted, NetError> {
    let certificate = v["certificate"].as_str().ok_or(NetError::Server)?.to_string();
    let server_time = v["server_time"].as_str().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()).map(|d| d.timestamp()).unwrap_or_else(now_unix);
    Ok(Granted { certificate, server_time })
}

pub fn http_activate(key: &str, installation: &str, device: &str, version: &str) -> Result<Granted, NetError> {
    granted(post(
        "activate-license",
        serde_json::json!({ "product": PRODUCT, "key": key, "installation_id": installation, "device_hash": device, "device_label": device_label(), "app_version": version }),
    )?)
}
pub fn http_validate(certificate: &str, installation: &str, version: &str) -> Result<Granted, NetError> {
    granted(post("validate-license", serde_json::json!({ "certificate": certificate, "installation_id": installation, "app_version": version }))?)
}
pub fn http_deactivate(certificate: &str, installation: &str, version: &str) -> Result<(), NetError> {
    post("deactivate-license", serde_json::json!({ "certificate": certificate, "installation_id": installation, "app_version": version })).map(|_| ())
}

/// Message français pour un échec réseau (sans détail technique).
pub fn describe(e: &NetError) -> String {
    match e {
        NetError::Offline => "Connexion Internet requise pour cette opération. Vérifiez votre connexion puis réessayez.".into(),
        NetError::Server => "Erreur temporaire du serveur de licences. Réessayez dans quelques minutes.".into(),
        NetError::Refused(code) => match code.as_str() {
            "invalid_key" => "Clé invalide. Vérifiez la clé saisie.",
            "revoked" => "Cette licence a été révoquée. Contactez DigiStudio.",
            "suspended" => "Cette licence est suspendue. Contactez DigiStudio.",
            "expired" => "Cette licence annuelle est expirée. Renouvelez-la pour retrouver Premium.",
            "device_limit" => "Nombre maximal d'appareils atteint pour cette licence. Libérez l'autre appareil ou contactez DigiStudio.",
            "not_activated" => "Cet appareil n'est plus activé pour cette licence. Saisissez à nouveau votre clé.",
            "rate_limited" => "Trop de tentatives. Réessayez dans quelques minutes.",
            "app_version_unsupported" => "Cette licence ne couvre pas cette version de DigiStock.",
            "invalid_request" => "Clé invalide. Vérifiez la clé saisie.",
            _ => "Licence refusée. Contactez DigiStudio.",
        }
        .into(),
    }
}

// ------------------------------------------------------------------------------------------------ tests
#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const FIXTURE: &str = include_str!("../tests/fixtures/certificates.json");

    struct Fx {
        keys: Vec<(String, String)>,
        installation: String,
        device: String,
        v: serde_json::Value,
    }
    fn fx() -> Fx {
        let v: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();
        Fx {
            keys: vec![(v["kid"].as_str().unwrap().to_string(), v["public"].as_str().unwrap().to_string())],
            installation: v["installation"].as_str().unwrap().to_string(),
            device: v["device"].as_str().unwrap().to_string(),
            v,
        }
    }
    fn keys(f: &Fx) -> Vec<(&str, &str)> {
        f.keys.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect()
    }
    fn ctx<'a>(f: &'a Fx, k: &'a [(&'a str, &'a str)], now: i64) -> EvalContext<'a> {
        EvalContext { installation: &f.installation, device: &f.device, now, high_water: 0, denied_code: None, keys: k }
    }
    const DAY: i64 = 86_400;

    #[test]
    fn verifies_certificates_signed_by_the_typescript_server() {
        let f = fx();
        let k = keys(&f);
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let c = verify_token(f.v["lifetime"].as_str().unwrap(), &k).unwrap();
        assert_eq!((c.prd.as_str(), c.typ.as_str(), c.exp, c.feat.clone()), ("digistock", "lifetime", None, vec!["premium".to_string()]));
        assert_eq!(c.reference, "LIC-2026-000001");
        let a = verify_token(f.v["annual"].as_str().unwrap(), &k).unwrap();
        assert_eq!(a.exp, a.lexp);
        assert_eq!(a.iat, iat);
    }

    #[test]
    fn lifetime_license_stays_valid_offline_for_years() {
        let f = fx();
        let k = keys(&f);
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let t = f.v["lifetime"].as_str();
        for years in [0, 1, 5, 20] {
            let e = evaluate(t, &ctx(&f, &k, iat + years * 365 * DAY));
            assert_eq!(e.state, LicenseState::Licensed, "{years} ans");
        }
        assert!(!evaluate(t, &ctx(&f, &k, iat + 10 * DAY)).needs_validation);
        assert!(evaluate(t, &ctx(&f, &k, iat + 31 * DAY)).needs_validation); // revalidation conseillée, jamais imposée
    }

    #[test]
    fn annual_license_stops_at_the_signed_expiry_even_offline() {
        let f = fx();
        let k = keys(&f);
        let t = f.v["annual"].as_str();
        let exp = verify_token(t.unwrap(), &k).unwrap().exp.unwrap();
        assert_eq!(evaluate(t, &ctx(&f, &k, exp - 1)).state, LicenseState::Licensed);
        assert_eq!(evaluate(t, &ctx(&f, &k, exp)).state, LicenseState::Licensed);
        assert_eq!(evaluate(t, &ctx(&f, &k, exp + 1)).state, LicenseState::Expired);
        assert_eq!(evaluate(t, &ctx(&f, &k, exp + 400 * DAY)).state, LicenseState::Expired);
        // la période de grâce prolonge l'échéance signée, pas davantage
        let g = f.v["annualGrace"].as_str();
        assert_eq!(evaluate(g, &ctx(&f, &k, exp + 4 * DAY)).state, LicenseState::Licensed);
        assert_eq!(evaluate(g, &ctx(&f, &k, exp + 6 * DAY)).state, LicenseState::Expired);
    }

    #[test]
    fn rejects_modified_certificates_wrong_signature_unknown_key_and_wrong_binding() {
        let f = fx();
        let k = keys(&f);
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let t = f.v["lifetime"].as_str().unwrap();
        let parts: Vec<&str> = t.split('.').collect();
        // revendications modifiées (fonctionnalité ajoutée)
        let mut claims: serde_json::Value = serde_json::from_slice(&b64u(parts[1]).unwrap()).unwrap();
        claims["feat"] = serde_json::json!(["premium", "tout"]);
        let forged = format!("{}.{}.{}", parts[0], URL_SAFE_NO_PAD.encode(claims.to_string()), parts[2]);
        assert_eq!(verify_token(&forged, &k), Err(VerifyError::Signature));
        assert_eq!(evaluate(Some(&forged), &ctx(&f, &k, iat)).state, LicenseState::Invalid);
        // signature tronquée / jeton mal formé
        assert!(verify_token(&format!("{}.{}.AAAA", parts[0], parts[1]), &k).is_err());
        assert_eq!(verify_token("abc", &k), Err(VerifyError::Format));
        // autre clé de confiance
        let other = [("fixture-1", "zyPKXyB693oUkV8Dofn2t2hufxGm_uDHEHg9xXa0SzM")];
        assert_eq!(verify_token(t, &other), Err(VerifyError::Signature));
        assert_eq!(verify_token(t, &[("autre", "x")]), Err(VerifyError::UnknownKey));
        // autre installation / autre appareil
        let mut c = ctx(&f, &k, iat);
        c.installation = "ds-autre-installation-000000";
        assert_eq!(evaluate(Some(t), &c).state, LicenseState::Invalid);
        let mut c = ctx(&f, &k, iat);
        c.device = "dev_autre_appareil_000000";
        assert_eq!(evaluate(Some(t), &c).state, LicenseState::Invalid);
        // algorithme imposé par l'en-tête
        let hdr = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","typ":"dsl+jwt","kid":"fixture-1"}"#);
        assert_eq!(verify_token(&format!("{hdr}.{}.{}", parts[1], parts[2]), &k), Err(VerifyError::Format));
    }

    #[test]
    fn signing_key_rotation_keeps_old_certificates_until_the_old_key_is_removed() {
        let f = fx();
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let new_key = SigningKey::from_bytes(&[7u8; 32]);
        let new_pub = URL_SAFE_NO_PAD.encode(new_key.verifying_key().to_bytes());
        let both = [("fixture-1", f.keys[0].1.as_str()), ("k2", new_pub.as_str())];
        let t = f.v["lifetime"].as_str();
        assert_eq!(evaluate(t, &ctx(&f, &both, iat + DAY)).state, LicenseState::Licensed);
        // un certificat signé par la nouvelle clé est accepté
        let claims = verify_token(t.unwrap(), &both).unwrap();
        let header = URL_SAFE_NO_PAD.encode(r#"{"alg":"EdDSA","typ":"dsl+jwt","kid":"k2"}"#);
        let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
        let sig = new_key.sign(format!("{header}.{body}").as_bytes());
        let t2 = format!("{header}.{body}.{}", URL_SAFE_NO_PAD.encode(sig.to_bytes()));
        assert_eq!(evaluate(Some(&t2), &ctx(&f, &both, iat + DAY)).state, LicenseState::Licensed);
        // application qui ne connaît plus l'ancienne clé : l'ancien certificat n'est plus reconnu
        let only_new = [("k2", new_pub.as_str())];
        assert_eq!(evaluate(t, &ctx(&f, &only_new, iat + DAY)).state, LicenseState::Invalid);
    }

    #[test]
    fn clock_rollback_is_detected_and_does_not_extend_an_annual_license() {
        let f = fx();
        let k = keys(&f);
        let t = f.v["annual"].as_str();
        let exp = verify_token(t.unwrap(), &k).unwrap().exp.unwrap();
        // l'utilisateur a utilisé l'application après l'échéance (high_water enregistré), puis remonte l'horloge
        let mut c = ctx(&f, &k, exp - 30 * DAY);
        c.high_water = exp + 5 * DAY;
        assert_eq!(evaluate(t, &c).state, LicenseState::ClockRollback);
        // horloge réglée avant l'émission du certificat
        let iat = f.v["issuedAt"].as_i64().unwrap();
        assert_eq!(evaluate(f.v["lifetime"].as_str(), &ctx(&f, &k, iat - 10 * DAY)).state, LicenseState::ClockRollback);
        // un petit décalage (fuseau, correction NTP) reste toléré
        let mut c = ctx(&f, &k, iat + 100 * DAY);
        c.high_water = iat + 100 * DAY + 3600;
        assert_eq!(evaluate(f.v["lifetime"].as_str(), &c).state, LicenseState::Licensed);
    }

    #[test]
    fn offline_limit_and_server_denial_cut_access() {
        let f = fx();
        let k = keys(&f);
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let m = f.v["maxOffline"].as_str();
        assert_eq!(evaluate(m, &ctx(&f, &k, iat + 44 * DAY)).state, LicenseState::Licensed);
        assert_eq!(evaluate(m, &ctx(&f, &k, iat + 46 * DAY)).state, LicenseState::OfflineExpired);
        let mut c = ctx(&f, &k, iat + DAY);
        c.denied_code = Some("revoked");
        assert_eq!(evaluate(f.v["lifetime"].as_str(), &c).state, LicenseState::Denied);
        assert_eq!(evaluate(None, &ctx(&f, &k, iat)).state, LicenseState::Unlicensed);
    }

    #[test]
    fn local_state_persists_tamper_is_detected_and_clock_only_moves_forward() {
        let conn = crate::db::test_conn();
        let a = load(&conn).unwrap();
        assert!(a.installation.starts_with("ds-"));
        assert_eq!(load(&conn).unwrap().installation, a.installation); // stable
        save(&conn, &Stored { high_water: 1_000, last_online_ok: 900, ..a.clone() }).unwrap();
        assert_eq!(load(&conn).unwrap().high_water, 1_000);
        // retouche manuelle de la base : la date de référence est ramenée à zéro pour « effacer » l'historique
        conn.execute("UPDATE license_state SET high_water = 0 WHERE id = 1", []).unwrap();
        let t = load(&conn).unwrap();
        assert_eq!(t.denied_code.as_deref(), Some("tampered"));
        assert!(t.tampered);
        // l'état altéré ne donne jamais de droits : même un certificat valide est refusé
        let f = fx();
        let k = keys(&f);
        let iat = f.v["issuedAt"].as_i64().unwrap();
        let mut c = ctx(&f, &k, iat + DAY);
        c.denied_code = t.denied_code.as_deref();
        c.high_water = t.high_water;
        assert!(!evaluate(f.v["lifetime"].as_str(), &c).active());
    }

    #[test]
    fn describe_hides_internals() {
        for c in ["invalid_key", "revoked", "suspended", "expired", "device_limit", "rate_limited", "zzz"] {
            let m = describe(&NetError::Refused(c.into()));
            assert!(!m.contains(c) || c == "expired");
        }
        assert!(describe(&NetError::Offline).contains("Internet"));
    }
}
