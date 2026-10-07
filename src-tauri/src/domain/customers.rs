//! Crédit client : encaissement des paiements et ajustements de solde.

use crate::audit;
use crate::db::{self, round2};
use crate::error::{AppError, AppResult};
use crate::state::Session;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct PaymentResult {
    pub id: i64,
    pub number: String,
    pub balance_after: f64,
}

pub fn add_payment(conn: &mut Connection, s: &Session, customer_id: i64, amount: f64, method: &str, note: Option<String>) -> AppResult<PaymentResult> {
    let amount = round2(amount);
    if !(amount > 0.0) {
        return Err(AppError::validation("Le montant doit être supérieur à zéro."));
    }
    if !["cash", "card", "transfer", "other"].contains(&method) {
        return Err(AppError::validation("Mode de paiement invalide."));
    }
    let tx = conn.transaction()?;
    let (name, balance): (String, f64) = tx
        .query_row("SELECT name, balance FROM customers WHERE id = ?", [customer_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::validation("Client introuvable."))?;
    if amount > round2(balance) + 0.001 {
        return Err(AppError::validation(format!("Le paiement dépasse le solde dû ({:.2} DH).", balance)));
    }
    let number = db::next_number(&tx, "PAY")?;
    let now = db::now();
    let after: f64 = tx.query_row(
        "UPDATE customers SET balance = round(balance - ?1, 2), updated_at = ?2 WHERE id = ?3 RETURNING balance",
        params![amount, now, customer_id],
        |r| r.get(0),
    )?;
    tx.execute(
        "INSERT INTO customer_credit_transactions (customer_id, type, amount, balance_after, number, method, note, user_id, created_at)
         VALUES (?1, 'PAYMENT', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![customer_id, -amount, after, number, method, db::opt_str(&note), s.user_id, now],
    )?;
    let id = tx.last_insert_rowid();
    audit::log(&tx, Some(s), "customer.payment", Some("customer"), Some(customer_id), &format!("{} a encaissé {:.2} DH de {name} ({number}).", s.name, amount), None)?;
    tx.commit()?;
    Ok(PaymentResult { id, number, balance_after: after })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::domain::stock::tests::{admin, seed_user};

    #[test]
    fn payment_reduces_balance_and_cannot_exceed_it() {
        let mut c = test_conn();
        seed_user(&c);
        c.execute("INSERT INTO customers (id, name, balance) VALUES (1, 'Mohammed', 1280)", []).unwrap();
        let r = add_payment(&mut c, &admin(), 1, 200.0, "cash", None).unwrap();
        assert_eq!(r.balance_after, 1080.0);
        assert!(r.number.starts_with("PAY-"));
        assert!(add_payment(&mut c, &admin(), 1, 5000.0, "cash", None).is_err());
        assert!(add_payment(&mut c, &admin(), 1, -5.0, "cash", None).is_err());
    }
}
