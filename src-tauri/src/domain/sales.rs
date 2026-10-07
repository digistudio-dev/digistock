//! Ventes : calcul des totaux, enregistrement atomique, annulation avec restauration du stock.

use super::stock::{self, Movement};
use crate::db::{self, round2};
use crate::error::{AppError, AppResult};
use crate::state::Session;
use crate::audit;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

pub const PAYMENT_METHODS: &[&str] = &["cash", "card", "transfer", "credit", "other"];

#[derive(Debug, Clone, Deserialize)]
pub struct SaleItemInput {
    pub product_id: i64,
    pub quantity: f64,
    pub unit_price: f64,
    #[serde(default)]
    pub discount: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SaleInput {
    pub customer_id: Option<i64>,
    pub warehouse_id: Option<i64>,
    pub items: Vec<SaleItemInput>,
    #[serde(default)]
    pub discount: f64,
    pub payment_method: String,
    /// Montant remis par le client (espèces) pour calculer la monnaie.
    pub received_amount: Option<f64>,
    /// Acompte versé lors d'une vente à crédit.
    pub paid_now: Option<f64>,
    pub note: Option<String>,
}

/// Ligne calculée (valeurs arrondies au centime).
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LineCalc {
    pub gross: f64,
    pub line_discount: f64,
    pub global_discount: f64,
    pub total: f64,
    pub tax: f64,
    pub net_excl_tax: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Totals {
    pub lines: Vec<LineCalc>,
    pub subtotal: f64,
    pub discount_total: f64,
    pub tax_total: f64,
    pub total: f64,
}

/// Calcule les totaux d'une vente.
/// * `prices_include_tax` : prix saisis TTC (cas le plus courant en magasin).
/// * La remise globale est répartie au prorata des lignes.
pub fn compute_totals(items: &[(f64, f64, f64, f64)], global_discount: f64, prices_include_tax: bool) -> Totals {
    // items : (quantité, prix unitaire, remise ligne, taux TVA)
    let mut nets = Vec::with_capacity(items.len());
    let mut subtotal = 0.0;
    let mut line_discounts = 0.0;
    for &(q, price, disc, _) in items {
        let gross = round2(q * price);
        let d = disc.clamp(0.0, gross);
        subtotal += gross;
        line_discounts += d;
        nets.push((gross, round2(d), round2(gross - d)));
    }
    let lines_net: f64 = nets.iter().map(|n| n.2).sum();
    let global = round2(global_discount.clamp(0.0, lines_net));
    let mut allocated = 0.0;
    let mut lines = Vec::with_capacity(items.len());
    let last_nonzero = nets.iter().rposition(|n| n.2 > 0.0);
    for (i, (&(_, _, _, rate), &(gross, d, net))) in items.iter().zip(nets.iter()).enumerate() {
        let share = if lines_net <= 0.0 || global == 0.0 {
            0.0
        } else if Some(i) == last_nonzero {
            round2(global - allocated)
        } else {
            round2(global * net / lines_net)
        };
        allocated = round2(allocated + share);
        let base = round2(net - share);
        let (total, tax, ht) = if prices_include_tax {
            let tax = round2(base * rate / (100.0 + rate));
            (base, tax, round2(base - tax))
        } else {
            let tax = round2(base * rate / 100.0);
            (round2(base + tax), tax, base)
        };
        lines.push(LineCalc { gross, line_discount: d, global_discount: share, total, tax, net_excl_tax: ht });
    }
    let tax_total = round2(lines.iter().map(|l| l.tax).sum());
    let total = round2(lines.iter().map(|l| l.total).sum());
    Totals { lines, subtotal: round2(subtotal), discount_total: round2(line_discounts + global), tax_total, total }
}

#[derive(Debug, Serialize)]
pub struct SaleResult {
    pub id: i64,
    pub number: String,
    pub total: f64,
    pub change_amount: f64,
    pub credit_amount: f64,
}

pub fn create(conn: &mut Connection, s: &Session, input: &SaleInput) -> AppResult<SaleResult> {
    let tx = conn.transaction()?;
    let res = create_in_tx(&tx, s, input, None)?;
    tx.commit()?;
    Ok(res)
}

pub fn create_in_tx(tx: &Connection, s: &Session, input: &SaleInput, created_at: Option<&str>) -> AppResult<SaleResult> {
    if input.items.is_empty() {
        return Err(AppError::validation("Le panier est vide."));
    }
    if !PAYMENT_METHODS.contains(&input.payment_method.as_str()) {
        return Err(AppError::validation("Mode de paiement invalide."));
    }
    let include_tax = db::setting_bool(tx, "sales.prices_include_tax", true);
    let allow_negative = db::setting_bool(tx, "stock.allow_negative", false);
    let wh = match input.warehouse_id {
        Some(w) => w,
        None => stock::default_warehouse(tx)?,
    };
    stock::ensure_warehouse(tx, wh)?;

    // Chargement des produits : coût d'achat figé au moment de la vente.
    struct P {
        name: String,
        barcode: Option<String>,
        unit: String,
        cost: f64,
        rate: f64,
    }
    let mut products = Vec::with_capacity(input.items.len());
    for it in &input.items {
        if !(it.quantity > 0.0) || !it.quantity.is_finite() {
            return Err(AppError::validation("Chaque quantité doit être supérieure à zéro."));
        }
        if !(it.unit_price >= 0.0) || !(it.discount >= 0.0) {
            return Err(AppError::validation("Prix ou remise invalide."));
        }
        let p: P = tx
            .query_row(
                "SELECT name, barcode, unit, purchase_price, tax_rate, archived FROM products WHERE id = ?",
                [it.product_id],
                |r| {
                    let archived: i64 = r.get(5)?;
                    if archived == 1 {
                        return Err(rusqlite::Error::QueryReturnedNoRows);
                    }
                    Ok(P { name: r.get(0)?, barcode: r.get(1)?, unit: r.get(2)?, cost: r.get(3)?, rate: r.get(4)? })
                },
            )
            .optional()?
            .ok_or_else(|| AppError::validation("Un produit du panier est introuvable ou archivé."))?;
        products.push(p);
    }
    let calc_input: Vec<(f64, f64, f64, f64)> =
        input.items.iter().zip(&products).map(|(i, p)| (i.quantity, i.unit_price, i.discount, p.rate)).collect();
    let totals = compute_totals(&calc_input, input.discount, include_tax);

    // Paiement
    let method = input.payment_method.as_str();
    let mut received = 0.0;
    let mut change = 0.0;
    let (paid, credit) = if method == "credit" {
        let customer_id = input.customer_id.ok_or_else(|| AppError::validation("Sélectionnez un client pour une vente à crédit."))?;
        let paid_now = round2(input.paid_now.unwrap_or(0.0));
        if paid_now < 0.0 || paid_now > totals.total {
            return Err(AppError::validation("L'acompte doit être compris entre 0 et le total de la vente."));
        }
        let credit = round2(totals.total - paid_now);
        let (limit, balance, cname): (f64, f64, String) = tx
            .query_row("SELECT credit_limit, balance, name FROM customers WHERE id = ? AND archived = 0", [customer_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .optional()?
            .ok_or_else(|| AppError::validation("Client introuvable."))?;
        if limit > 0.0 && round2(balance + credit) > limit && db::setting_bool(tx, "sales.block_credit_over_limit", true) {
            return Err(AppError::validation(format!(
                "Plafond de crédit dépassé pour {cname} : encours {:.2} DH, plafond {:.2} DH.",
                balance, limit
            )));
        }
        (paid_now, credit)
    } else {
        if method == "cash" {
            if let Some(r) = input.received_amount {
                if r > 0.0 {
                    if round2(r) < totals.total {
                        return Err(AppError::validation("Le montant reçu est inférieur au total."));
                    }
                    received = round2(r);
                    change = round2(r - totals.total);
                }
            }
        }
        (totals.total, 0.0)
    };
    if received == 0.0 {
        received = paid;
    }

    let number = db::next_number(tx, "V")?;
    let now = created_at.map(|s| s.to_string()).unwrap_or_else(db::now);
    let cost_total = round2(input.items.iter().zip(&products).map(|(i, p)| i.quantity * p.cost).sum());
    let profit = round2(totals.lines.iter().map(|l| l.net_excl_tax).sum::<f64>() - cost_total);
    tx.execute(
        "INSERT INTO sales (number, customer_id, warehouse_id, user_id, status, subtotal, discount_total, tax_total, total,
                            cost_total, profit, paid_amount, received_amount, change_amount, credit_amount, payment_method, note, created_at)
         VALUES (?1, ?2, ?3, ?4, 'completed', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
        params![
            number,
            input.customer_id,
            wh,
            s.user_id,
            totals.subtotal,
            totals.discount_total,
            totals.tax_total,
            totals.total,
            cost_total,
            profit,
            paid,
            received,
            change,
            credit,
            method,
            db::opt_str(&input.note),
            now
        ],
    )?;
    let sale_id = tx.last_insert_rowid();

    for ((it, p), line) in input.items.iter().zip(&products).zip(&totals.lines) {
        let line_profit = round2(line.net_excl_tax - it.quantity * p.cost);
        tx.execute(
            "INSERT INTO sale_items (sale_id, product_id, product_name, barcode, unit, quantity, unit_price, unit_cost,
                                     discount, tax_rate, tax_amount, total, profit)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                sale_id,
                it.product_id,
                p.name,
                p.barcode,
                p.unit,
                it.quantity,
                it.unit_price,
                p.cost,
                round2(line.line_discount + line.global_discount),
                p.rate,
                line.tax,
                line.total,
                line_profit
            ],
        )?;
        stock::apply_movement(
            tx,
            &Movement {
                product_id: it.product_id,
                warehouse_id: wh,
                kind: "SALE",
                delta: -it.quantity,
                unit_cost: Some(p.cost),
                reference: Some(&number),
                reference_type: Some("sale"),
                reference_id: Some(sale_id),
                user_id: Some(s.user_id),
                allow_negative,
                created_at: Some(&now),
                ..Default::default()
            },
        )?;
    }

    if method == "credit" {
        if paid > 0.0 {
            tx.execute("INSERT INTO sale_payments (sale_id, method, amount, created_at) VALUES (?, 'cash', ?, ?)", params![sale_id, paid, now])?;
        }
        tx.execute("INSERT INTO sale_payments (sale_id, method, amount, created_at) VALUES (?, 'credit', ?, ?)", params![sale_id, credit, now])?;
        if credit > 0.0 {
            let cid = input.customer_id.unwrap_or_default();
            let balance: f64 = tx.query_row(
                "UPDATE customers SET balance = round(balance + ?1, 2), updated_at = ?2 WHERE id = ?3 RETURNING balance",
                params![credit, now, cid],
                |r| r.get(0),
            )?;
            tx.execute(
                "INSERT INTO customer_credit_transactions (customer_id, type, amount, balance_after, sale_id, note, user_id, created_at)
                 VALUES (?1, 'SALE', ?2, ?3, ?4, ?5, ?6, ?7)",
                params![cid, credit, balance, sale_id, format!("Vente {number}"), s.user_id, now],
            )?;
        }
    } else {
        tx.execute("INSERT INTO sale_payments (sale_id, method, amount, created_at) VALUES (?, ?, ?, ?)", params![sale_id, method, paid, now])?;
    }

    audit::log(
        tx,
        Some(s),
        "sale.create",
        Some("sale"),
        Some(sale_id),
        &format!("{} a enregistré la vente {number} de {:.2} DH.", s.name, totals.total),
        Some(json!({ "total": totals.total, "items": input.items.len(), "method": method })),
    )?;
    Ok(SaleResult { id: sale_id, number, total: totals.total, change_amount: change, credit_amount: credit })
}

/// Annule une vente : restaure le stock, extourne le crédit client, conserve l'historique.
pub fn cancel(conn: &mut Connection, s: &Session, sale_id: i64, reason: &str) -> AppResult<()> {
    let reason = reason.trim();
    if reason.is_empty() {
        return Err(AppError::validation("Le motif d'annulation est obligatoire."));
    }
    let tx = conn.transaction()?;
    let (number, status, wh, customer_id, credit): (String, String, i64, Option<i64>, f64) = tx
        .query_row(
            "SELECT number, status, warehouse_id, customer_id, credit_amount FROM sales WHERE id = ?",
            [sale_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound("Vente introuvable.".into()))?;
    if status == "cancelled" {
        return Err(AppError::validation("Cette vente est déjà annulée."));
    }
    let items: Vec<(i64, f64, f64)> = {
        let mut stmt = tx.prepare("SELECT product_id, quantity, unit_cost FROM sale_items WHERE sale_id = ?")?;
        let rows = stmt.query_map([sale_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    let now = db::now();
    let why = format!("Annulation : {reason}");
    for (pid, q, cost) in items {
        stock::apply_movement(
            &tx,
            &Movement {
                product_id: pid,
                warehouse_id: wh,
                kind: "CANCELLED_SALE",
                delta: q,
                unit_cost: Some(cost),
                reference: Some(&number),
                reference_type: Some("sale"),
                reference_id: Some(sale_id),
                reason: Some(&why),
                user_id: Some(s.user_id),
                allow_negative: true,
                ..Default::default()
            },
        )?;
    }
    if let (Some(cid), true) = (customer_id, credit > 0.0) {
        let balance: f64 = tx.query_row(
            "UPDATE customers SET balance = round(balance - ?1, 2), updated_at = ?2 WHERE id = ?3 RETURNING balance",
            params![credit, now, cid],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO customer_credit_transactions (customer_id, type, amount, balance_after, sale_id, note, user_id, created_at)
             VALUES (?1, 'SALE_CANCELLED', ?2, ?3, ?4, ?5, ?6, ?7)",
            params![cid, -credit, balance, sale_id, format!("Annulation vente {number}"), s.user_id, now],
        )?;
    }
    tx.execute(
        "UPDATE sales SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ?",
        params![now, s.user_id, reason, sale_id],
    )?;
    audit::log(
        &tx,
        Some(s),
        "sale.cancel",
        Some("sale"),
        Some(sale_id),
        &format!("{} a annulé la vente {number}. Motif : {reason}", s.name),
        None,
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::domain::stock::tests::{admin, product, qty, seed_user};

    fn sale(items: Vec<SaleItemInput>, method: &str) -> SaleInput {
        SaleInput {
            customer_id: None,
            warehouse_id: None,
            items,
            discount: 0.0,
            payment_method: method.into(),
            received_amount: None,
            paid_now: None,
            note: None,
        }
    }

    #[test]
    fn totals_tax_included() {
        let t = compute_totals(&[(2.0, 60.0, 0.0, 20.0)], 0.0, true);
        assert_eq!(t.total, 120.0);
        assert_eq!(t.tax_total, 20.0);
        assert_eq!(t.lines[0].net_excl_tax, 100.0);
    }

    #[test]
    fn totals_tax_excluded() {
        let t = compute_totals(&[(1.0, 100.0, 0.0, 20.0)], 0.0, false);
        assert_eq!(t.total, 120.0);
        assert_eq!(t.tax_total, 20.0);
    }

    #[test]
    fn global_discount_is_allocated_exactly() {
        let t = compute_totals(&[(1.0, 10.0, 0.0, 0.0), (1.0, 20.0, 0.0, 0.0), (1.0, 3.33, 0.0, 0.0)], 10.0, true);
        let alloc: f64 = t.lines.iter().map(|l| l.global_discount).sum();
        assert_eq!(round2(alloc), 10.0);
        assert_eq!(t.total, 23.33);
        assert_eq!(t.discount_total, 10.0);
    }

    #[test]
    fn discount_never_exceeds_total() {
        let t = compute_totals(&[(1.0, 10.0, 50.0, 0.0)], 100.0, true);
        assert_eq!(t.total, 0.0);
    }

    #[test]
    fn sale_decrements_stock_and_stores_profit() {
        let mut c = test_conn();
        seed_user(&c);
        let p = product(&c, "Chaise", 100.0, 60.0, 10.0);
        let r = create(&mut c, &admin(), &sale(vec![SaleItemInput { product_id: p, quantity: 1.0, unit_price: 100.0, discount: 0.0 }], "cash")).unwrap();
        assert_eq!(r.total, 100.0);
        assert_eq!(qty(&c, p), 9.0);
        let (profit, cost): (f64, f64) = c.query_row("SELECT profit, cost_total FROM sales WHERE id = ?", [r.id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((profit, cost), (40.0, 60.0));
        // Le coût historique ne change pas si le prix d'achat évolue
        c.execute("UPDATE products SET purchase_price = 80 WHERE id = ?", [p]).unwrap();
        let unit_cost: f64 = c.query_row("SELECT unit_cost FROM sale_items WHERE sale_id = ?", [r.id], |r| r.get(0)).unwrap();
        assert_eq!(unit_cost, 60.0);
    }

    #[test]
    fn failed_sale_rolls_back_everything() {
        let mut c = test_conn();
        seed_user(&c);
        let a = product(&c, "A", 10.0, 5.0, 10.0);
        let b = product(&c, "B", 10.0, 5.0, 1.0);
        let input = sale(
            vec![
                SaleItemInput { product_id: a, quantity: 2.0, unit_price: 10.0, discount: 0.0 },
                SaleItemInput { product_id: b, quantity: 5.0, unit_price: 10.0, discount: 0.0 },
            ],
            "cash",
        );
        assert!(create(&mut c, &admin(), &input).is_err());
        assert_eq!(qty(&c, a), 10.0);
        assert_eq!(qty(&c, b), 1.0);
        let n: i64 = c.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        // Le numéro n'a pas été consommé
        let seq: Option<i64> = c.query_row("SELECT value FROM document_sequences WHERE prefix='V'", [], |r| r.get(0)).optional().unwrap();
        assert_eq!(seq, None);
    }

    #[test]
    fn credit_sale_and_cancellation() {
        let mut c = test_conn();
        seed_user(&c);
        c.execute("INSERT INTO customers (id, name) VALUES (1, 'Mohammed')", []).unwrap();
        let p = product(&c, "Riz", 50.0, 30.0, 20.0);
        let mut input = sale(vec![SaleItemInput { product_id: p, quantity: 10.0, unit_price: 50.0, discount: 0.0 }], "credit");
        input.customer_id = Some(1);
        input.paid_now = Some(200.0);
        let r = create(&mut c, &admin(), &input).unwrap();
        assert_eq!(r.credit_amount, 300.0);
        let bal: f64 = c.query_row("SELECT balance FROM customers WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(bal, 300.0);
        cancel(&mut c, &admin(), r.id, "Erreur de saisie").unwrap();
        let bal: f64 = c.query_row("SELECT balance FROM customers WHERE id = 1", [], |r| r.get(0)).unwrap();
        assert_eq!(bal, 0.0);
        assert_eq!(qty(&c, p), 20.0);
        assert!(cancel(&mut c, &admin(), r.id, "encore").is_err());
    }

    #[test]
    fn credit_limit_is_enforced() {
        let mut c = test_conn();
        seed_user(&c);
        c.execute("INSERT INTO customers (id, name, credit_limit) VALUES (1, 'Sara', 100)", []).unwrap();
        let p = product(&c, "Huile", 150.0, 100.0, 5.0);
        let mut input = sale(vec![SaleItemInput { product_id: p, quantity: 1.0, unit_price: 150.0, discount: 0.0 }], "credit");
        input.customer_id = Some(1);
        assert!(create(&mut c, &admin(), &input).is_err());
        input.paid_now = Some(60.0);
        assert!(create(&mut c, &admin(), &input).is_ok());
    }

    #[test]
    fn cash_change_is_computed() {
        let mut c = test_conn();
        seed_user(&c);
        let p = product(&c, "Pain", 1.5, 1.0, 10.0);
        let mut input = sale(vec![SaleItemInput { product_id: p, quantity: 3.0, unit_price: 1.5, discount: 0.0 }], "cash");
        input.received_amount = Some(10.0);
        let r = create(&mut c, &admin(), &input).unwrap();
        assert_eq!(r.change_amount, 5.5);
        input.received_amount = Some(2.0);
        assert!(create(&mut c, &admin(), &input).is_err());
    }
}
