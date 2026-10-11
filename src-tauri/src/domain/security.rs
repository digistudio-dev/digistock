//! Code PIN à 4 chiffres et questions de sécurité (réinitialisation du mot de passe hors ligne).
//!
//! * Le PIN est un raccourci de connexion : 5 erreurs le bloquent jusqu'à une connexion par mot de passe.
//! * Les 3 réponses sont normalisées (minuscules, espaces) puis hachées avec Argon2id.
//! * La réinitialisation exige les 3 bonnes réponses ; 5 échecs bloquent la procédure 15 minutes.

use super::auth::{self, hash_password, validate_password, verify_password};
use crate::audit;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::Session;
use chrono::{Duration, Local, NaiveDateTime};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const MAX_PIN_ATTEMPTS: i64 = 5;
pub const MAX_RECOVERY_ATTEMPTS: i64 = 5;
const RECOVERY_LOCK_MINUTES: i64 = 15;

#[derive(Debug, Clone, Deserialize)]
pub struct QuestionInput {
    pub question: String,
    pub answer: String,
}

pub fn validate_pin(pin: &str) -> AppResult<()> {
    if pin.len() != 4 || !pin.chars().all(|c| c.is_ascii_digit()) {
        return Err(AppError::validation("Le code PIN doit comporter exactement 4 chiffres."));
    }
    Ok(())
}

/// Normalise une réponse : sans espaces superflus, insensible à la casse.
pub fn normalize_answer(answer: &str) -> String {
    answer.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

pub fn validate_questions(items: &[QuestionInput]) -> AppResult<()> {
    if items.len() != 3 {
        return Err(AppError::validation("Trois questions de sécurité sont nécessaires."));
    }
    for (i, q) in items.iter().enumerate() {
        if q.question.trim().chars().count() < 5 {
            return Err(AppError::validation(format!("La question {} est trop courte.", i + 1)));
        }
        if normalize_answer(&q.answer).chars().count() < 2 {
            return Err(AppError::validation(format!("La réponse {} est trop courte.", i + 1)));
        }
        if items.iter().skip(i + 1).any(|o| o.question.trim().eq_ignore_ascii_case(q.question.trim())) {
            return Err(AppError::validation("Choisissez trois questions différentes."));
        }
    }
    Ok(())
}

pub fn store_pin(conn: &Connection, user_id: i64, pin: Option<&str>) -> AppResult<()> {
    let hash = match pin {
        Some(p) => {
            validate_pin(p)?;
            Some(hash_password(p)?)
        }
        None => None,
    };
    conn.execute("UPDATE users SET pin_hash = ?, pin_failed = 0, updated_at = ? WHERE id = ?", params![hash, db::now(), user_id])?;
    Ok(())
}

pub fn store_questions(conn: &Connection, user_id: i64, items: &[QuestionInput]) -> AppResult<()> {
    validate_questions(items)?;
    conn.execute("DELETE FROM user_security_questions WHERE user_id = ?", [user_id])?;
    for (i, q) in items.iter().enumerate() {
        conn.execute(
            "INSERT INTO user_security_questions (user_id, position, question, answer_hash) VALUES (?1, ?2, ?3, ?4)",
            params![user_id, (i + 1) as i64, q.question.trim(), hash_password(&normalize_answer(&q.answer))?],
        )?;
    }
    conn.execute("UPDATE users SET recovery_failed = 0, recovery_locked_until = NULL WHERE id = ?", [user_id])?;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct SecurityStatus {
    pub has_pin: bool,
    pub pin_locked: bool,
    pub questions: Vec<String>,
}

pub fn questions_of(conn: &Connection, user_id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare("SELECT question FROM user_security_questions WHERE user_id = ? ORDER BY position")?;
    let rows = stmt.query_map([user_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<Result<_, _>>()?)
}

pub fn status(conn: &Connection, user_id: i64) -> AppResult<SecurityStatus> {
    let (has_pin, failed): (bool, i64) =
        conn.query_row("SELECT pin_hash IS NOT NULL, pin_failed FROM users WHERE id = ?", [user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    Ok(SecurityStatus { has_pin, pin_locked: failed >= MAX_PIN_ATTEMPTS, questions: questions_of(conn, user_id)? })
}

/// Vérifie le PIN d'un utilisateur. Compte les erreurs et bloque le PIN après 5 échecs.
pub fn verify_pin(conn: &Connection, user_id: i64, pin: &str) -> AppResult<()> {
    let (hash, failed): (Option<String>, i64) =
        conn.query_row("SELECT pin_hash, pin_failed FROM users WHERE id = ?", [user_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let hash = hash.ok_or_else(|| AppError::validation("Aucun code PIN n'est défini pour ce compte. Utilisez votre mot de passe."))?;
    if failed >= MAX_PIN_ATTEMPTS {
        return Err(AppError::validation("Code PIN bloqué après trop d'essais. Connectez-vous avec votre mot de passe."));
    }
    if pin.len() == 4 && verify_password(pin, &hash) {
        conn.execute("UPDATE users SET pin_failed = 0 WHERE id = ?", [user_id])?;
        return Ok(());
    }
    conn.execute("UPDATE users SET pin_failed = pin_failed + 1 WHERE id = ?", [user_id])?;
    let left = MAX_PIN_ATTEMPTS - failed - 1;
    Err(AppError::validation(if left <= 0 {
        "Code PIN incorrect. Le PIN est maintenant bloqué : connectez-vous avec votre mot de passe.".to_string()
    } else {
        format!("Code PIN incorrect. {left} essai(s) restant(s).")
    }))
}

pub fn login_with_pin(conn: &Connection, username: &str, pin: &str) -> AppResult<Session> {
    let row: Option<(i64, i64)> = conn
        .query_row("SELECT id, is_active FROM users WHERE username = ? COLLATE NOCASE", [username.trim()], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    let (id, active) = row.ok_or_else(|| AppError::validation("Identifiant ou code PIN incorrect."))?;
    verify_pin(conn, id, pin)?;
    auth::finish_login(conn, id, active)
}

pub fn set_pin(conn: &Connection, s: &Session, current_password: &str, pin: Option<&str>) -> AppResult<()> {
    if !auth::check_password(conn, s.user_id, current_password)? {
        return Err(AppError::validation("Le mot de passe actuel est incorrect."));
    }
    store_pin(conn, s.user_id, pin)?;
    let what = if pin.is_some() { "défini son code PIN" } else { "supprimé son code PIN" };
    audit::log(conn, Some(s), "auth.pin", Some("user"), Some(s.user_id), &format!("{} a {what}.", s.name), None)
}

pub fn set_questions(conn: &mut Connection, s: &Session, current_password: &str, items: &[QuestionInput]) -> AppResult<()> {
    if !auth::check_password(conn, s.user_id, current_password)? {
        return Err(AppError::validation("Le mot de passe actuel est incorrect."));
    }
    let tx = conn.transaction()?;
    store_questions(&tx, s.user_id, items)?;
    audit::log(&tx, Some(s), "auth.questions", Some("user"), Some(s.user_id), &format!("{} a mis à jour ses questions de sécurité.", s.name), None)?;
    tx.commit()?;
    Ok(())
}

fn find_user(conn: &Connection, username: &str) -> AppResult<(i64, String, i64, Option<String>)> {
    conn.query_row(
        "SELECT id, name, recovery_failed, recovery_locked_until FROM users WHERE username = ? COLLATE NOCASE AND is_active = 1",
        [username.trim()],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()?
    .ok_or_else(|| AppError::validation("Aucun compte actif ne correspond à cet identifiant."))
}

fn locked_minutes(until: &Option<String>) -> Option<i64> {
    let t = NaiveDateTime::parse_from_str(until.as_deref()?, "%Y-%m-%d %H:%M:%S").ok()?;
    let left = t.signed_duration_since(Local::now().naive_local()).num_seconds();
    (left > 0).then_some((left + 59) / 60)
}

/// Questions à poser pour réinitialiser le mot de passe d'un identifiant.
pub fn recovery_questions(conn: &Connection, username: &str) -> AppResult<Vec<String>> {
    let (id, _, _, until) = find_user(conn, username)?;
    if let Some(m) = locked_minutes(&until) {
        return Err(AppError::validation(format!("Trop de tentatives. Réessayez dans {m} minute(s).")));
    }
    let q = questions_of(conn, id)?;
    if q.len() != 3 {
        return Err(AppError::validation(
            "Aucune question de sécurité n'est configurée pour ce compte. Demandez à un administrateur de réinitialiser votre mot de passe.",
        ));
    }
    Ok(q)
}

/// Réinitialise le mot de passe si les 3 réponses sont correctes.
pub fn recovery_reset(conn: &mut Connection, username: &str, answers: &[String], new_password: &str) -> AppResult<()> {
    let (id, name, failed, until) = find_user(conn, username)?;
    if let Some(m) = locked_minutes(&until) {
        return Err(AppError::validation(format!("Trop de tentatives. Réessayez dans {m} minute(s).")));
    }
    validate_password(new_password)?;
    let hashes: Vec<String> = {
        let mut stmt = conn.prepare("SELECT answer_hash FROM user_security_questions WHERE user_id = ? ORDER BY position")?;
        let rows = stmt.query_map([id], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<_, _>>()?
    };
    if hashes.len() != 3 || answers.len() != 3 {
        return Err(AppError::validation("Questions de sécurité non configurées."));
    }
    // Toutes les réponses sont vérifiées, sans indiquer laquelle est fausse.
    let ok = hashes.iter().zip(answers).fold(true, |acc, (h, a)| verify_password(&normalize_answer(a), h) && acc);
    if !ok {
        // Après un blocage expiré, le compteur repart de zéro.
        let failed = if until.is_some() { 1 } else { failed + 1 };
        if failed >= MAX_RECOVERY_ATTEMPTS {
            let lock = (Local::now() + Duration::minutes(RECOVERY_LOCK_MINUTES)).format("%Y-%m-%d %H:%M:%S").to_string();
            conn.execute("UPDATE users SET recovery_failed = 0, recovery_locked_until = ? WHERE id = ?", params![lock, id])?;
            audit::log(conn, None, "auth.recovery_locked", Some("user"), Some(id), &format!("Réinitialisation bloquée pour {name} après trop d'échecs."), None)?;
            return Err(AppError::validation(format!("Réponses incorrectes. Procédure bloquée pendant {RECOVERY_LOCK_MINUTES} minutes.")));
        }
        conn.execute("UPDATE users SET recovery_failed = ?, recovery_locked_until = NULL WHERE id = ?", params![failed, id])?;
        return Err(AppError::validation(format!(
            "Une ou plusieurs réponses sont incorrectes. {} essai(s) restant(s).",
            MAX_RECOVERY_ATTEMPTS - failed
        )));
    }
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE users SET password_hash = ?, pin_failed = 0, recovery_failed = 0, recovery_locked_until = NULL, updated_at = ? WHERE id = ?",
        params![hash_password(new_password)?, db::now(), id],
    )?;
    audit::log(&tx, None, "auth.recovery", Some("user"), Some(id), &format!("{name} a réinitialisé son mot de passe avec ses questions de sécurité."), None)?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;

    fn user(c: &Connection) -> i64 {
        c.execute("INSERT INTO users (name, username, password_hash) VALUES ('Omar', 'omar', ?)", [hash_password("secret123").unwrap()]).unwrap();
        let id = c.last_insert_rowid();
        c.execute("INSERT INTO user_roles (user_id, role_id) VALUES (?, 1)", [id]).unwrap();
        id
    }

    fn qa() -> Vec<QuestionInput> {
        vec![
            QuestionInput { question: "Ville de naissance ?".into(), answer: "  Fès ".into() },
            QuestionInput { question: "Prénom de votre mère ?".into(), answer: "Fatima   Zahra".into() },
            QuestionInput { question: "Premier métier ?".into(), answer: "Épicier".into() },
        ]
    }

    #[test]
    fn pin_format() {
        assert!(validate_pin("1234").is_ok());
        for bad in ["123", "12345", "12a4", "", "١٢٣٤"] {
            assert!(validate_pin(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn pin_login_and_lockout() {
        let c = test_conn();
        let id = user(&c);
        assert!(login_with_pin(&c, "omar", "1234").is_err()); // pas de PIN défini
        store_pin(&c, id, Some("4821")).unwrap();
        let stored: String = c.query_row("SELECT pin_hash FROM users WHERE id = ?", [id], |r| r.get(0)).unwrap();
        assert!(stored.starts_with("$argon2") && !stored.contains("4821"));
        assert!(login_with_pin(&c, "OMAR", "4821").is_ok());
        for _ in 0..5 {
            assert!(login_with_pin(&c, "omar", "0000").is_err());
        }
        // Bloqué : même le bon PIN est refusé…
        assert!(login_with_pin(&c, "omar", "4821").is_err());
        assert!(status(&c, id).unwrap().pin_locked);
        // …jusqu'à une connexion par mot de passe.
        assert!(auth::login(&c, "omar", "secret123").is_ok());
        assert!(login_with_pin(&c, "omar", "4821").is_ok());
    }

    #[test]
    fn questions_validation() {
        let mut q = qa();
        assert!(validate_questions(&q).is_ok());
        q[1].question = q[0].question.clone();
        assert!(validate_questions(&q).is_err());
        assert!(validate_questions(&qa()[..2]).is_err());
        let mut q = qa();
        q[2].answer = " ".into();
        assert!(validate_questions(&q).is_err());
    }

    #[test]
    fn recovery_resets_password_with_three_right_answers() {
        let mut c = test_conn();
        let id = user(&c);
        assert!(recovery_questions(&c, "omar").is_err()); // non configurées
        store_questions(&c, id, &qa()).unwrap();
        assert_eq!(recovery_questions(&c, "omar").unwrap().len(), 3);
        let wrong = vec!["fès".to_string(), "fatima zahra".to_string(), "boulanger".to_string()];
        assert!(recovery_reset(&mut c, "omar", &wrong, "nouveau123").is_err());
        assert!(auth::login(&c, "omar", "secret123").is_ok()); // inchangé
        // Casse et espaces ignorés
        let right = vec!["FÈS".to_string(), " fatima zahra ".to_string(), "épicier".to_string()];
        assert!(recovery_reset(&mut c, "omar", &right, "123").is_err()); // mot de passe trop court
        recovery_reset(&mut c, "omar", &right, "nouveau123").unwrap();
        assert!(auth::login(&c, "omar", "secret123").is_err());
        assert!(auth::login(&c, "omar", "nouveau123").is_ok());
    }

    #[test]
    fn recovery_locks_after_five_failures() {
        let mut c = test_conn();
        let id = user(&c);
        store_questions(&c, id, &qa()).unwrap();
        let wrong = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        for _ in 0..5 {
            assert!(recovery_reset(&mut c, "omar", &wrong, "nouveau123").is_err());
        }
        let right = vec!["fès".to_string(), "fatima zahra".to_string(), "épicier".to_string()];
        let err = recovery_reset(&mut c, "omar", &right, "nouveau123").unwrap_err();
        assert!(err.user_message().contains("Trop de tentatives"));
        assert!(recovery_questions(&c, "omar").is_err());
    }

    #[test]
    fn hashes_are_not_readable_from_the_frontend() {
        let c = test_conn();
        let id = user(&c);
        store_pin(&c, id, Some("4821")).unwrap();
        store_questions(&c, id, &qa()).unwrap();
        let q = |sql: &str| crate::db::query_json_guarded(&c, sql, &[]);
        // Nommer une colonne sensible est refusé…
        assert!(q("SELECT pin_hash FROM users").is_err());
        assert!(q("SELECT answer_hash FROM user_security_questions").is_err());
        // …et les formes détournées renvoient NULL à la place des empreintes.
        let row = &q("SELECT * FROM users").unwrap()[0];
        assert!(row["password_hash"].is_null() && row["pin_hash"].is_null());
        assert_eq!(row["username"], "omar");
        assert!(q("SELECT * FROM user_security_questions").unwrap().iter().all(|r| r["answer_hash"].is_null()));
        let union = q("SELECT 1 AS a, 2 AS b, 3 AS c, 4 AS d, 5 AS e, 6 AS f, 7 AS g, 8 AS h, 9 AS i, 10 AS j, 11 AS k, 12 AS l, 13 AS m UNION ALL SELECT * FROM users").unwrap();
        assert!(union.iter().all(|r| r.values().all(|v| !v.as_str().unwrap_or("").starts_with("$argon2"))));
        // L'autoriseur est retiré ensuite : le backend lit toujours les empreintes.
        let h: String = c.query_row("SELECT password_hash FROM users WHERE id = ?", [id], |r| r.get(0)).unwrap();
        assert!(h.starts_with("$argon2"));
    }
}
