//! Moteur de stock : toute variation de quantité passe par `apply_movement`,
//! qui enregistre systématiquement un mouvement (avant / après) dans `stock_movements`.

use crate::db::{self, round3};
use crate::error::{AppError, AppResult};
use crate::notify;
use crate::state::Session;
use crate::{audit, premium};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::json;

pub const MOVEMENT_TYPES: &[&str] =
    &["PURCHASE", "SALE", "RETURN", "ADJUSTMENT", "DAMAGED", "TRANSFER", "PRODUCTION", "INITIAL", "CANCELLED_SALE"];

#[derive(Debug, Clone, Default)]
pub struct Movement<'a> {
    pub product_id: i64,
    pub warehouse_id: i64,
    pub kind: &'a str,
    pub delta: f64,
    pub unit_cost: Option<f64>,
    pub reference: Option<&'a str>,
    pub reference_type: Option<&'a str>,
    pub reference_id: Option<i64>,
    pub reason: Option<&'a str>,
    pub user_id: Option<i64>,
    pub allow_negative: bool,
    pub created_at: Option<&'a str>,
}

pub fn warehouse_qty(conn: &Connection, product_id: i64, warehouse_id: i64) -> AppResult<f64> {
    Ok(conn
        .query_row(
            "SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?",
            params![product_id, warehouse_id],
            |r| r.get(0),
        )
        .optional()?
        .unwrap_or(0.0))
}

pub fn default_warehouse(conn: &Connection) -> AppResult<i64> {
    Ok(conn
        .query_row("SELECT id FROM warehouses WHERE is_default = 1 AND archived = 0 ORDER BY id LIMIT 1", [], |r| r.get(0))
        .optional()?
        .unwrap_or(1))
}

pub fn ensure_warehouse(conn: &Connection, warehouse_id: i64) -> AppResult<()> {
    let ok: Option<i64> = conn
        .query_row("SELECT id FROM warehouses WHERE id = ? AND archived = 0", [warehouse_id], |r| r.get(0))
        .optional()?;
    ok.map(|_| ()).ok_or_else(|| AppError::validation("Entrepôt introuvable ou archivé."))
}

/// Applique un mouvement de stock. Doit être appelée dans une transaction.
/// Retourne (quantité avant, quantité après) pour l'entrepôt concerné.
pub fn apply_movement(conn: &Connection, m: &Movement) -> AppResult<(f64, f64)> {
    if !MOVEMENT_TYPES.contains(&m.kind) {
        return Err(AppError::validation("Type de mouvement invalide."));
    }
    if !m.delta.is_finite() || m.delta == 0.0 {
        return Err(AppError::validation("La quantité du mouvement doit être différente de zéro."));
    }
    let (name, kind): (String, String) = conn
        .query_row("SELECT name, product_type FROM products WHERE id = ?", [m.product_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?
        .ok_or_else(|| AppError::NotFound("Produit introuvable.".into()))?;
    if kind == "service" {
        return Ok((0.0, 0.0));
    }
    conn.execute(
        "INSERT OR IGNORE INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, ?, 0)",
        params![m.product_id, m.warehouse_id],
    )?;
    let before = warehouse_qty(conn, m.product_id, m.warehouse_id)?;
    let after = round3(before + m.delta);
    if after < 0.0 && !m.allow_negative {
        return Err(AppError::validation(format!(
            "Stock insuffisant pour « {name} » (disponible : {}).",
            notify::fmt_qty(before.max(0.0))
        )));
    }
    let now = m.created_at.map(|s| s.to_string()).unwrap_or_else(db::now);
    conn.execute(
        "UPDATE warehouse_stock SET quantity = ?, updated_at = ? WHERE product_id = ? AND warehouse_id = ?",
        params![after, now, m.product_id, m.warehouse_id],
    )?;
    conn.execute(
        "UPDATE products SET quantity = (SELECT COALESCE(SUM(quantity), 0) FROM warehouse_stock WHERE product_id = ?1), updated_at = ?2 WHERE id = ?1",
        params![m.product_id, now],
    )?;
    conn.execute(
        "INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, quantity_before, quantity_after, unit_cost,
                                      reference, reference_type, reference_id, reason, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            m.product_id,
            m.warehouse_id,
            m.kind,
            round3(m.delta),
            before,
            after,
            m.unit_cost,
            m.reference,
            m.reference_type,
            m.reference_id,
            m.reason,
            m.user_id,
            now
        ],
    )?;
    if m.delta < 0.0 {
        consume_batches(conn, m.product_id, m.warehouse_id, -m.delta)?;
    }
    notify::check_stock(conn, m.product_id)?;
    Ok((before, after))
}

/// Sortie de stock : consomme les lots en priorité par date d'expiration (FEFO).
fn consume_batches(conn: &Connection, product_id: i64, warehouse_id: i64, mut qty: f64) -> AppResult<()> {
    let mut stmt = conn.prepare(
        "SELECT id, quantity FROM product_batches WHERE product_id = ? AND warehouse_id = ? AND quantity > 0
         ORDER BY expiration_date IS NULL, expiration_date, id",
    )?;
    let batches: Vec<(i64, f64)> =
        stmt.query_map(params![product_id, warehouse_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (id, available) in batches {
        if qty <= 0.0 {
            break;
        }
        let take = available.min(qty);
        conn.execute("UPDATE product_batches SET quantity = ? WHERE id = ?", params![round3(available - take), id])?;
        qty = round3(qty - take);
    }
    Ok(())
}

pub fn add_batch(
    conn: &Connection,
    product_id: i64,
    warehouse_id: i64,
    batch_number: Option<&str>,
    expiration_date: Option<&str>,
    quantity: f64,
    purchase_id: Option<i64>,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO product_batches (product_id, warehouse_id, batch_number, purchase_date, expiration_date, initial_quantity, quantity, purchase_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
        params![product_id, warehouse_id, batch_number, db::today(), expiration_date, quantity, purchase_id],
    )?;
    conn.execute("UPDATE products SET track_batches = 1 WHERE id = ?", [product_id])?;
    Ok(())
}

// ------------------------------------------------------------------ Ajustement manuel

#[derive(Debug, Deserialize)]
pub struct AdjustInput {
    pub product_id: i64,
    pub warehouse_id: Option<i64>,
    /// "add" | "remove" | "set"
    pub mode: String,
    pub quantity: f64,
    /// ADJUSTMENT | DAMAGED | RETURN
    pub kind: String,
    pub reason: String,
}

pub fn adjust(conn: &mut Connection, s: &Session, input: &AdjustInput) -> AppResult<(f64, f64)> {
    let reason = input.reason.trim();
    if reason.is_empty() {
        return Err(AppError::validation("Le motif de l'ajustement est obligatoire."));
    }
    if !["ADJUSTMENT", "DAMAGED", "RETURN"].contains(&input.kind.as_str()) {
        return Err(AppError::validation("Type d'ajustement invalide."));
    }
    if !input.quantity.is_finite() || input.quantity < 0.0 {
        return Err(AppError::validation("La quantité doit être positive."));
    }
    let tx = conn.transaction()?;
    let wh = match input.warehouse_id {
        Some(w) => w,
        None => default_warehouse(&tx)?,
    };
    ensure_warehouse(&tx, wh)?;
    let current = warehouse_qty(&tx, input.product_id, wh)?;
    let delta = match input.mode.as_str() {
        "add" => input.quantity,
        "remove" => -input.quantity,
        "set" => round3(input.quantity - current),
        _ => return Err(AppError::validation("Mode d'ajustement invalide.")),
    };
    if delta == 0.0 {
        return Err(AppError::validation("Aucune variation de stock à enregistrer."));
    }
    let kind = if input.kind == "DAMAGED" && delta > 0.0 { "ADJUSTMENT" } else { input.kind.as_str() };
    let res = apply_movement(
        &tx,
        &Movement {
            product_id: input.product_id,
            warehouse_id: wh,
            kind,
            delta,
            reason: Some(reason),
            reference_type: Some("adjustment"),
            user_id: Some(s.user_id),
            ..Default::default()
        },
    )?;
    let name: String = tx.query_row("SELECT name FROM products WHERE id = ?", [input.product_id], |r| r.get(0))?;
    audit::log(
        &tx,
        Some(s),
        "stock.adjust",
        Some("product"),
        Some(input.product_id),
        &format!("{} a modifié le stock de {} : {} → {}.", s.name, name, notify::fmt_qty(res.0), notify::fmt_qty(res.1)),
        Some(json!({ "before": res.0, "after": res.1, "type": kind, "reason": reason, "warehouse_id": wh })),
    )?;
    tx.commit()?;
    Ok(res)
}

// ------------------------------------------------------------------ Transferts (Premium)

#[derive(Debug, Deserialize)]
pub struct TransferItem {
    pub product_id: i64,
    pub quantity: f64,
}

#[derive(Debug, Deserialize)]
pub struct TransferInput {
    pub source_warehouse_id: i64,
    pub destination_warehouse_id: i64,
    pub reference: Option<String>,
    pub notes: Option<String>,
    pub items: Vec<TransferItem>,
}

pub fn transfer(conn: &mut Connection, s: &Session, input: &TransferInput) -> AppResult<(i64, String)> {
    premium::require(conn)?;
    if input.source_warehouse_id == input.destination_warehouse_id {
        return Err(AppError::validation("Les entrepôts source et destination doivent être différents."));
    }
    if input.items.is_empty() {
        return Err(AppError::validation("Ajoutez au moins un produit au transfert."));
    }
    let tx = conn.transaction()?;
    ensure_warehouse(&tx, input.source_warehouse_id)?;
    ensure_warehouse(&tx, input.destination_warehouse_id)?;
    let number = db::next_number(&tx, "TRF")?;
    tx.execute(
        "INSERT INTO stock_transfers (number, source_warehouse_id, destination_warehouse_id, reference, notes, user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            number,
            input.source_warehouse_id,
            input.destination_warehouse_id,
            db::opt_str(&input.reference),
            db::opt_str(&input.notes),
            s.user_id,
            db::now()
        ],
    )?;
    let id = tx.last_insert_rowid();
    for it in &input.items {
        if !(it.quantity > 0.0) {
            return Err(AppError::validation("Chaque quantité transférée doit être supérieure à zéro."));
        }
        tx.execute(
            "INSERT INTO stock_transfer_items (transfer_id, product_id, quantity) VALUES (?, ?, ?)",
            params![id, it.product_id, it.quantity],
        )?;
        for (wh, delta) in [(input.source_warehouse_id, -it.quantity), (input.destination_warehouse_id, it.quantity)] {
            apply_movement(
                &tx,
                &Movement {
                    product_id: it.product_id,
                    warehouse_id: wh,
                    kind: "TRANSFER",
                    delta,
                    reference: Some(&number),
                    reference_type: Some("transfer"),
                    reference_id: Some(id),
                    user_id: Some(s.user_id),
                    ..Default::default()
                },
            )?;
        }
    }
    audit::log(&tx, Some(s), "stock.transfer", Some("transfer"), Some(id), &format!("{} a créé le transfert {number}.", s.name), None)?;
    tx.commit()?;
    Ok((id, number))
}

// ------------------------------------------------------------------ Inventaires

pub fn inventory_start(conn: &mut Connection, s: &Session, warehouse_id: Option<i64>, notes: Option<String>) -> AppResult<(i64, String)> {
    let tx = conn.transaction()?;
    let wh = match warehouse_id {
        Some(w) => w,
        None => default_warehouse(&tx)?,
    };
    ensure_warehouse(&tx, wh)?;
    let number = db::next_number(&tx, "INV")?;
    tx.execute(
        "INSERT INTO inventory_sessions (number, warehouse_id, notes, user_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![number, wh, db::opt_str(&notes), s.user_id, db::now()],
    )?;
    let id = tx.last_insert_rowid();
    audit::log(&tx, Some(s), "inventory.start", Some("inventory"), Some(id), &format!("{} a démarré l'inventaire {number}.", s.name), None)?;
    tx.commit()?;
    Ok((id, number))
}

fn open_session_warehouse(conn: &Connection, session_id: i64) -> AppResult<i64> {
    let row: Option<(String, i64)> = conn
        .query_row("SELECT status, warehouse_id FROM inventory_sessions WHERE id = ?", [session_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .optional()?;
    match row {
        Some((st, wh)) if st == "open" => Ok(wh),
        Some(_) => Err(AppError::validation("Cet inventaire est déjà clôturé.")),
        None => Err(AppError::NotFound("Inventaire introuvable.".into())),
    }
}

pub fn inventory_set_count(conn: &Connection, session_id: i64, product_id: i64, counted: f64) -> AppResult<()> {
    if !counted.is_finite() || counted < 0.0 {
        return Err(AppError::validation("La quantité comptée doit être positive."));
    }
    let wh = open_session_warehouse(conn, session_id)?;
    let expected = warehouse_qty(conn, product_id, wh)?;
    conn.execute(
        "INSERT INTO inventory_items (session_id, product_id, expected_quantity, counted_quantity, difference, counted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(session_id, product_id) DO UPDATE SET counted_quantity = excluded.counted_quantity,
           expected_quantity = excluded.expected_quantity, difference = excluded.difference, counted_at = excluded.counted_at",
        params![session_id, product_id, expected, round3(counted), round3(counted - expected), db::now()],
    )?;
    Ok(())
}

pub fn inventory_remove_item(conn: &Connection, session_id: i64, product_id: i64) -> AppResult<()> {
    open_session_warehouse(conn, session_id)?;
    conn.execute("DELETE FROM inventory_items WHERE session_id = ? AND product_id = ?", params![session_id, product_id])?;
    Ok(())
}

/// Valide l'inventaire : génère un ajustement pour chaque écart constaté.
pub fn inventory_validate(conn: &mut Connection, s: &Session, session_id: i64) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let wh = open_session_warehouse(&tx, session_id)?;
    let number: String = tx.query_row("SELECT number FROM inventory_sessions WHERE id = ?", [session_id], |r| r.get(0))?;
    let items: Vec<(i64, i64, f64)> = {
        let mut stmt = tx.prepare("SELECT id, product_id, counted_quantity FROM inventory_items WHERE session_id = ?")?;
        let rows = stmt.query_map([session_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    if items.is_empty() {
        return Err(AppError::validation("Aucun produit compté dans cet inventaire."));
    }
    let reason = format!("Inventaire {number}");
    let mut adjusted = 0;
    for (item_id, product_id, counted) in items {
        let current = warehouse_qty(&tx, product_id, wh)?;
        let diff = round3(counted - current);
        tx.execute(
            "UPDATE inventory_items SET expected_quantity = ?, difference = ? WHERE id = ?",
            params![current, diff, item_id],
        )?;
        if diff != 0.0 {
            apply_movement(
                &tx,
                &Movement {
                    product_id,
                    warehouse_id: wh,
                    kind: "ADJUSTMENT",
                    delta: diff,
                    reference: Some(&number),
                    reference_type: Some("inventory"),
                    reference_id: Some(session_id),
                    reason: Some(&reason),
                    user_id: Some(s.user_id),
                    allow_negative: true,
                    ..Default::default()
                },
            )?;
            adjusted += 1;
        }
    }
    tx.execute(
        "UPDATE inventory_sessions SET status = 'validated', validated_at = ?, validated_by = ? WHERE id = ?",
        params![db::now(), s.user_id, session_id],
    )?;
    audit::log(
        &tx,
        Some(s),
        "inventory.validate",
        Some("inventory"),
        Some(session_id),
        &format!("{} a validé l'inventaire {number} ({adjusted} ajustement(s)).", s.name),
        None,
    )?;
    tx.commit()?;
    Ok(adjusted)
}

pub fn inventory_cancel(conn: &Connection, s: &Session, session_id: i64) -> AppResult<()> {
    open_session_warehouse(conn, session_id)?;
    conn.execute("UPDATE inventory_sessions SET status = 'cancelled' WHERE id = ?", [session_id])?;
    audit::log(conn, Some(s), "inventory.cancel", Some("inventory"), Some(session_id), &format!("{} a annulé un inventaire.", s.name), None)?;
    Ok(())
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::db::test_conn;

    pub fn admin() -> Session {
        Session {
            user_id: 1,
            name: "Admin".into(),
            username: "admin".into(),
            role_id: Some(1),
            role_name: Some("Administrateur".into()),
            permissions: vec![],
        }
    }

    pub fn seed_user(conn: &Connection) {
        conn.execute("INSERT INTO users (id, name, username, password_hash) VALUES (1, 'Admin', 'admin', 'x')", []).unwrap();
    }

    pub fn product(conn: &Connection, name: &str, price: f64, cost: f64, qty: f64) -> i64 {
        conn.execute(
            "INSERT INTO products (name, selling_price, purchase_price, tax_rate, minimum_stock) VALUES (?, ?, ?, 0, 2)",
            params![name, price, cost],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        if qty != 0.0 {
            apply_movement(conn, &Movement { product_id: id, warehouse_id: 1, kind: "INITIAL", delta: qty, ..Default::default() }).unwrap();
        }
        id
    }

    pub fn qty(conn: &Connection, id: i64) -> f64 {
        conn.query_row("SELECT quantity FROM products WHERE id = ?", [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn movement_records_before_after() {
        let c = test_conn();
        let p = product(&c, "Coca", 10.0, 6.0, 10.0);
        let (b, a) = apply_movement(&c, &Movement { product_id: p, warehouse_id: 1, kind: "SALE", delta: -3.0, ..Default::default() }).unwrap();
        assert_eq!((b, a), (10.0, 7.0));
        assert_eq!(qty(&c, p), 7.0);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM stock_movements WHERE product_id = ?", [p], |r| r.get(0)).unwrap();
        assert_eq!(n, 2);
    }

    #[test]
    fn stock_cannot_go_negative() {
        let c = test_conn();
        let p = product(&c, "Coca", 10.0, 6.0, 2.0);
        let err = apply_movement(&c, &Movement { product_id: p, warehouse_id: 1, kind: "SALE", delta: -3.0, ..Default::default() });
        assert!(err.is_err());
        assert_eq!(qty(&c, p), 2.0);
    }

    #[test]
    fn adjustment_requires_reason_and_sets_quantity() {
        let mut c = test_conn();
        seed_user(&c);
        let p = product(&c, "Lait", 8.0, 5.0, 12.0);
        let s = admin();
        let bad = AdjustInput { product_id: p, warehouse_id: None, mode: "set".into(), quantity: 14.0, kind: "ADJUSTMENT".into(), reason: " ".into() };
        assert!(adjust(&mut c, &s, &bad).is_err());
        let ok = AdjustInput { reason: "Recomptage".into(), ..bad };
        assert_eq!(adjust(&mut c, &s, &ok).unwrap(), (12.0, 14.0));
        assert_eq!(qty(&c, p), 14.0);
    }

    #[test]
    fn inventory_generates_adjustments() {
        let mut c = test_conn();
        seed_user(&c);
        let s = admin();
        let p1 = product(&c, "A", 1.0, 1.0, 10.0);
        let p2 = product(&c, "B", 1.0, 1.0, 5.0);
        let (id, _) = inventory_start(&mut c, &s, None, None).unwrap();
        inventory_set_count(&c, id, p1, 8.0).unwrap();
        inventory_set_count(&c, id, p2, 5.0).unwrap();
        assert_eq!(inventory_validate(&mut c, &s, id).unwrap(), 1);
        assert_eq!(qty(&c, p1), 8.0);
        assert_eq!(qty(&c, p2), 5.0);
        assert!(inventory_set_count(&c, id, p1, 1.0).is_err());
    }

    #[test]
    fn fefo_batches_are_consumed() {
        let c = test_conn();
        let p = product(&c, "Yaourt", 3.0, 2.0, 0.0);
        apply_movement(&c, &Movement { product_id: p, warehouse_id: 1, kind: "PURCHASE", delta: 10.0, ..Default::default() }).unwrap();
        add_batch(&c, p, 1, Some("L2"), Some("2026-12-01"), 6.0, None).unwrap();
        add_batch(&c, p, 1, Some("L1"), Some("2026-11-01"), 4.0, None).unwrap();
        apply_movement(&c, &Movement { product_id: p, warehouse_id: 1, kind: "SALE", delta: -5.0, ..Default::default() }).unwrap();
        let l1: f64 = c.query_row("SELECT quantity FROM product_batches WHERE batch_number='L1'", [], |r| r.get(0)).unwrap();
        let l2: f64 = c.query_row("SELECT quantity FROM product_batches WHERE batch_number='L2'", [], |r| r.get(0)).unwrap();
        assert_eq!((l1, l2), (0.0, 5.0));
    }
}
