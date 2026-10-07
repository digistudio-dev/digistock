//! Achats et commandes fournisseurs.
//! * `ordered`  : bon de commande, aucun impact sur le stock.
//! * `received` : réception → entrée en stock + dette fournisseur.

use super::stock::{self, Movement};
use crate::audit;
use crate::db::{self, round2};
use crate::error::{AppError, AppResult};
use crate::state::Session;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Debug, Clone, Deserialize)]
pub struct PurchaseItemInput {
    pub product_id: i64,
    pub quantity: f64,
    pub unit_cost: f64,
    #[serde(default)]
    pub tax_rate: f64,
    pub batch_number: Option<String>,
    pub expiration_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PurchaseInput {
    pub id: Option<i64>,
    pub supplier_id: i64,
    pub warehouse_id: Option<i64>,
    pub reference: Option<String>,
    pub purchase_date: String,
    /// "ordered" | "received"
    pub status: String,
    pub items: Vec<PurchaseItemInput>,
    #[serde(default)]
    pub paid_amount: f64,
    pub payment_method: Option<String>,
    #[serde(default)]
    pub update_purchase_price: bool,
    pub note: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PurchaseResult {
    pub id: i64,
    pub number: String,
    pub total: f64,
}

/// (sous-total HT, TVA, total TTC)
pub fn compute_totals(items: &[(f64, f64, f64)]) -> (f64, f64, f64) {
    let mut sub = 0.0;
    let mut tax = 0.0;
    for &(q, cost, rate) in items {
        let ht = round2(q * cost);
        sub += ht;
        tax += round2(ht * rate / 100.0);
    }
    (round2(sub), round2(tax), round2(sub + tax))
}

fn validate(input: &PurchaseInput) -> AppResult<()> {
    if input.items.is_empty() {
        return Err(AppError::validation("Ajoutez au moins un produit."));
    }
    if !["ordered", "received"].contains(&input.status.as_str()) {
        return Err(AppError::validation("Statut d'achat invalide."));
    }
    for it in &input.items {
        if !(it.quantity > 0.0) || !it.quantity.is_finite() {
            return Err(AppError::validation("Chaque quantité doit être supérieure à zéro."));
        }
        if !(it.unit_cost >= 0.0) || !(it.tax_rate >= 0.0) {
            return Err(AppError::validation("Prix d'achat ou TVA invalide."));
        }
    }
    if input.paid_amount < 0.0 {
        return Err(AppError::validation("Le montant payé ne peut pas être négatif."));
    }
    Ok(())
}

pub fn save(conn: &mut Connection, s: &Session, input: &PurchaseInput) -> AppResult<PurchaseResult> {
    validate(input)?;
    let tx = conn.transaction()?;
    let supplier: Option<String> =
        tx.query_row("SELECT name FROM suppliers WHERE id = ? AND archived = 0", [input.supplier_id], |r| r.get(0)).optional()?;
    if supplier.is_none() {
        return Err(AppError::validation("Fournisseur introuvable."));
    }
    let wh = match input.warehouse_id {
        Some(w) => w,
        None => stock::default_warehouse(&tx)?,
    };
    stock::ensure_warehouse(&tx, wh)?;
    let (sub, tax, total) = compute_totals(&input.items.iter().map(|i| (i.quantity, i.unit_cost, i.tax_rate)).collect::<Vec<_>>());
    let paid = round2(input.paid_amount.min(total));
    let now = db::now();

    let (id, number) = match input.id {
        Some(id) => {
            let (number, status): (String, String) = tx
                .query_row("SELECT number, status FROM purchases WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?)))
                .optional()?
                .ok_or_else(|| AppError::NotFound("Achat introuvable.".into()))?;
            if status != "ordered" {
                return Err(AppError::validation("Seules les commandes non réceptionnées peuvent être modifiées."));
            }
            tx.execute(
                "UPDATE purchases SET supplier_id=?1, warehouse_id=?2, reference=?3, purchase_date=?4, subtotal=?5, tax_total=?6,
                        total=?7, note=?8, updated_at=?9 WHERE id=?10",
                params![input.supplier_id, wh, db::opt_str(&input.reference), input.purchase_date, sub, tax, total, db::opt_str(&input.note), now, id],
            )?;
            tx.execute("DELETE FROM purchase_items WHERE purchase_id = ?", [id])?;
            (id, number)
        }
        None => {
            let number = db::next_number(&tx, "ACH")?;
            tx.execute(
                "INSERT INTO purchases (number, supplier_id, warehouse_id, reference, purchase_date, status, subtotal, tax_total, total,
                                        paid_amount, note, user_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, 'ordered', ?6, ?7, ?8, 0, ?9, ?10, ?11, ?11)",
                params![number, input.supplier_id, wh, db::opt_str(&input.reference), input.purchase_date, sub, tax, total, db::opt_str(&input.note), s.user_id, now],
            )?;
            (tx.last_insert_rowid(), number)
        }
    };

    for it in &input.items {
        let name: String = tx
            .query_row("SELECT name FROM products WHERE id = ?", [it.product_id], |r| r.get(0))
            .optional()?
            .ok_or_else(|| AppError::validation("Un produit de l'achat est introuvable."))?;
        let line_total = round2(round2(it.quantity * it.unit_cost) * (1.0 + it.tax_rate / 100.0));
        tx.execute(
            "INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, tax_rate, total, batch_number, expiration_date)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, it.product_id, name, it.quantity, it.unit_cost, it.tax_rate, line_total, db::opt_str(&it.batch_number), db::opt_str(&it.expiration_date)],
        )?;
    }

    if input.status == "received" {
        receive_in_tx(&tx, s, id, input.update_purchase_price)?;
    } else {
        audit::log(&tx, Some(s), "purchase.order", Some("purchase"), Some(id), &format!("{} a enregistré la commande {number}.", s.name), Some(json!({ "total": total })))?;
    }
    if paid > 0.0 {
        let method = input.payment_method.clone().unwrap_or_else(|| "cash".into());
        pay_supplier_in_tx(&tx, s, input.supplier_id, paid, &method, Some(id), Some(number.clone()), None)?;
    }
    tx.commit()?;
    Ok(PurchaseResult { id, number, total })
}

pub fn receive(conn: &mut Connection, s: &Session, id: i64, update_price: bool) -> AppResult<()> {
    let tx = conn.transaction()?;
    receive_in_tx(&tx, s, id, update_price)?;
    tx.commit()?;
    Ok(())
}

fn receive_in_tx(tx: &Connection, s: &Session, id: i64, update_price: bool) -> AppResult<()> {
    let (number, status, wh, supplier_id, total): (String, String, i64, i64, f64) = tx
        .query_row("SELECT number, status, warehouse_id, supplier_id, total FROM purchases WHERE id = ?", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .optional()?
        .ok_or_else(|| AppError::NotFound("Achat introuvable.".into()))?;
    if status != "ordered" {
        return Err(AppError::validation("Cet achat a déjà été réceptionné ou annulé."));
    }
    let items: Vec<(i64, f64, f64, Option<String>, Option<String>)> = {
        let mut stmt = tx.prepare("SELECT product_id, quantity, unit_cost, batch_number, expiration_date FROM purchase_items WHERE purchase_id = ?")?;
        let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    let now = db::now();
    for (pid, q, cost, batch, exp) in items {
        stock::apply_movement(
            tx,
            &Movement {
                product_id: pid,
                warehouse_id: wh,
                kind: "PURCHASE",
                delta: q,
                unit_cost: Some(cost),
                reference: Some(&number),
                reference_type: Some("purchase"),
                reference_id: Some(id),
                user_id: Some(s.user_id),
                ..Default::default()
            },
        )?;
        if batch.is_some() || exp.is_some() {
            stock::add_batch(tx, pid, wh, batch.as_deref(), exp.as_deref(), q, Some(id))?;
            if let Some(e) = &exp {
                tx.execute(
                    "UPDATE products SET expiration_date = ?1 WHERE id = ?2 AND (expiration_date IS NULL OR expiration_date > ?1 OR expiration_date < date('now','localtime'))",
                    params![e, pid],
                )?;
            }
        }
        if update_price {
            tx.execute("UPDATE products SET purchase_price = ?, updated_at = ? WHERE id = ?", params![cost, now, pid])?;
        }
        tx.execute("UPDATE products SET supplier_id = COALESCE(supplier_id, ?) WHERE id = ?", params![supplier_id, pid])?;
    }
    tx.execute("UPDATE purchases SET status = 'received', received_at = ?, updated_at = ? WHERE id = ?", params![now, now, id])?;
    tx.execute("UPDATE suppliers SET balance = round(balance + ?, 2), updated_at = ? WHERE id = ?", params![total, now, supplier_id])?;
    audit::log(tx, Some(s), "purchase.receive", Some("purchase"), Some(id), &format!("{} a réceptionné l'achat {number} ({:.2} DH).", s.name, total), Some(json!({ "total": total })))?;
    Ok(())
}

/// Annule une commande, ou extourne un achat réceptionné (si le stock le permet).
pub fn cancel(conn: &mut Connection, s: &Session, id: i64, reason: &str) -> AppResult<()> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::validation("Le motif d'annulation est obligatoire."));
    }
    let tx = conn.transaction()?;
    let (number, status, wh, supplier_id, total): (String, String, i64, i64, f64) = tx
        .query_row("SELECT number, status, warehouse_id, supplier_id, total FROM purchases WHERE id = ?", [id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))
        })
        .optional()?
        .ok_or_else(|| AppError::NotFound("Achat introuvable.".into()))?;
    let now = db::now();
    match status.as_str() {
        "cancelled" => return Err(AppError::validation("Cet achat est déjà annulé.")),
        "received" => {
            let items: Vec<(i64, f64, f64)> = {
                let mut stmt = tx.prepare("SELECT product_id, quantity, unit_cost FROM purchase_items WHERE purchase_id = ?")?;
                let rows = stmt.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
                rows.collect::<Result<_, _>>()?
            };
            let why = format!("Annulation achat : {reason}");
            for (pid, q, cost) in items {
                stock::apply_movement(
                    &tx,
                    &Movement {
                        product_id: pid,
                        warehouse_id: wh,
                        kind: "RETURN",
                        delta: -q,
                        unit_cost: Some(cost),
                        reference: Some(&number),
                        reference_type: Some("purchase"),
                        reference_id: Some(id),
                        reason: Some(&why),
                        user_id: Some(s.user_id),
                        ..Default::default()
                    },
                )?;
            }
            tx.execute("UPDATE product_batches SET quantity = 0 WHERE purchase_id = ?", [id])?;
            tx.execute("UPDATE suppliers SET balance = round(balance - ?, 2), updated_at = ? WHERE id = ?", params![total, now, supplier_id])?;
        }
        _ => {}
    }
    tx.execute(
        "UPDATE purchases SET status = 'cancelled', cancelled_at = ?, cancel_reason = ?, updated_at = ? WHERE id = ?",
        params![now, reason, now, id],
    )?;
    audit::log(&tx, Some(s), "purchase.cancel", Some("purchase"), Some(id), &format!("{} a annulé l'achat {number}. Motif : {reason}", s.name), None)?;
    tx.commit()?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn pay_supplier_in_tx(
    tx: &Connection,
    s: &Session,
    supplier_id: i64,
    amount: f64,
    method: &str,
    purchase_id: Option<i64>,
    reference: Option<String>,
    note: Option<String>,
) -> AppResult<(i64, String)> {
    let amount = round2(amount);
    if !(amount > 0.0) {
        return Err(AppError::validation("Le montant doit être supérieur à zéro."));
    }
    let name: String = tx
        .query_row("SELECT name FROM suppliers WHERE id = ?", [supplier_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::validation("Fournisseur introuvable."))?;
    let number = db::next_number(tx, "REG")?;
    let now = db::now();
    tx.execute(
        "INSERT INTO supplier_payments (number, supplier_id, purchase_id, amount, method, reference, note, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![number, supplier_id, purchase_id, amount, method, db::opt_str(&reference), db::opt_str(&note), s.user_id, now],
    )?;
    let id = tx.last_insert_rowid();
    if let Some(pid) = purchase_id {
        tx.execute("UPDATE purchases SET paid_amount = round(paid_amount + ?, 2), updated_at = ? WHERE id = ?", params![amount, now, pid])?;
    }
    tx.execute("UPDATE suppliers SET balance = round(balance - ?, 2), updated_at = ? WHERE id = ?", params![amount, now, supplier_id])?;
    audit::log(tx, Some(s), "supplier.payment", Some("supplier"), Some(supplier_id), &format!("{} a réglé {:.2} DH au fournisseur {name}.", s.name, amount), None)?;
    Ok((id, number))
}

pub fn pay_supplier(
    conn: &mut Connection,
    s: &Session,
    supplier_id: i64,
    amount: f64,
    method: &str,
    purchase_id: Option<i64>,
    reference: Option<String>,
    note: Option<String>,
) -> AppResult<(i64, String)> {
    let tx = conn.transaction()?;
    let r = pay_supplier_in_tx(&tx, s, supplier_id, amount, method, purchase_id, reference, note)?;
    tx.commit()?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::domain::stock::tests::{admin, product, qty, seed_user};

    fn input(pid: i64, status: &str) -> PurchaseInput {
        PurchaseInput {
            id: None,
            supplier_id: 1,
            warehouse_id: None,
            reference: Some("F-1".into()),
            purchase_date: "2026-10-05".into(),
            status: status.into(),
            items: vec![PurchaseItemInput { product_id: pid, quantity: 50.0, unit_cost: 4.0, tax_rate: 20.0, batch_number: None, expiration_date: None }],
            paid_amount: 100.0,
            payment_method: Some("cash".into()),
            update_purchase_price: true,
            note: None,
        }
    }

    #[test]
    fn purchase_totals() {
        assert_eq!(compute_totals(&[(10.0, 5.0, 20.0), (2.0, 2.5, 0.0)]), (55.0, 10.0, 65.0));
    }

    #[test]
    fn received_purchase_increases_stock_and_debt() {
        let mut c = test_conn();
        seed_user(&c);
        c.execute("INSERT INTO suppliers (id, name) VALUES (1, 'ABC Distribution')", []).unwrap();
        let p = product(&c, "Coca", 7.0, 3.0, 0.0);
        let r = save(&mut c, &admin(), &input(p, "received")).unwrap();
        assert_eq!(r.total, 240.0);
        assert_eq!(qty(&c, p), 50.0);
        let price: f64 = c.query_row("SELECT purchase_price FROM products WHERE id = ?", [p], |r| r.get(0)).unwrap();
        assert_eq!(price, 4.0);
        let bal: f64 = c.query_row("SELECT balance FROM suppliers WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(bal, 140.0);
        cancel(&mut c, &admin(), r.id, "Erreur").unwrap();
        assert_eq!(qty(&c, p), 0.0);
    }

    #[test]
    fn order_does_not_touch_stock_until_received() {
        let mut c = test_conn();
        seed_user(&c);
        c.execute("INSERT INTO suppliers (id, name) VALUES (1, 'ABC')", []).unwrap();
        let p = product(&c, "Eau", 3.0, 1.0, 0.0);
        let mut i = input(p, "ordered");
        i.paid_amount = 0.0;
        let r = save(&mut c, &admin(), &i).unwrap();
        assert_eq!(qty(&c, p), 0.0);
        receive(&mut c, &admin(), r.id, false).unwrap();
        assert_eq!(qty(&c, p), 50.0);
        assert!(receive(&mut c, &admin(), r.id, false).is_err());
    }
}
