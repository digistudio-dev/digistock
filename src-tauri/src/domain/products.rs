//! Produits : création (avec stock initial tracé), modification, duplication.
//! La quantité n'est jamais modifiable directement : elle passe par les mouvements de stock.

use super::stock::{self, Movement};
use crate::audit;
use crate::db;
use crate::error::{AppError, AppResult};
use crate::state::Session;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;
use serde_json::json;

pub const UNITS: &[&str] = &["piece", "kg", "g", "l", "ml", "m", "carton", "pack", "box", "pallet"];

#[derive(Debug, Clone, Deserialize, Default)]
pub struct ProductInput {
    pub id: Option<i64>,
    pub name: String,
    pub sku: Option<String>,
    pub barcode: Option<String>,
    pub description: Option<String>,
    pub category_id: Option<i64>,
    pub brand: Option<String>,
    pub image: Option<String>,
    pub purchase_price: f64,
    pub selling_price: f64,
    pub tax_rate: f64,
    pub minimum_stock: f64,
    pub maximum_stock: Option<f64>,
    pub unit: String,
    pub supplier_id: Option<i64>,
    pub warehouse_id: Option<i64>,
    pub location: Option<String>,
    pub batch_number: Option<String>,
    pub expiration_date: Option<String>,
    pub product_type: Option<String>,
    /// Stock initial (création uniquement) — enregistré comme mouvement INITIAL.
    pub initial_quantity: Option<f64>,
}

fn validate(p: &ProductInput) -> AppResult<()> {
    if p.name.trim().is_empty() {
        return Err(AppError::validation("Le nom du produit est obligatoire."));
    }
    if p.name.trim().chars().count() > 200 {
        return Err(AppError::validation("Le nom du produit est trop long."));
    }
    if !(p.purchase_price >= 0.0) || !(p.selling_price >= 0.0) {
        return Err(AppError::validation("Les prix doivent être positifs."));
    }
    if !(0.0..=100.0).contains(&p.tax_rate) {
        return Err(AppError::validation("Le taux de TVA doit être compris entre 0 et 100 %."));
    }
    if !(p.minimum_stock >= 0.0) {
        return Err(AppError::validation("Le stock minimum doit être positif."));
    }
    if !UNITS.contains(&p.unit.as_str()) {
        return Err(AppError::validation("Unité invalide."));
    }
    if let Some(b) = db::opt_str(&p.barcode) {
        if b.len() > 64 || !b.chars().all(|c| c.is_ascii_graphic()) {
            return Err(AppError::validation("Code-barres invalide."));
        }
    }
    if let Some(q) = p.initial_quantity {
        if !(q >= 0.0) {
            return Err(AppError::validation("Le stock initial doit être positif."));
        }
    }
    Ok(())
}

pub fn save(conn: &mut Connection, s: &Session, p: &ProductInput) -> AppResult<i64> {
    validate(p)?;
    let tx = conn.transaction()?;
    let now = db::now();
    let kind = p.product_type.clone().unwrap_or_else(|| "standard".into());
    let id = match p.id {
        Some(id) => {
            let old: Option<(String, f64, f64)> = tx
                .query_row("SELECT name, purchase_price, selling_price FROM products WHERE id = ?", [id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .optional()?;
            let (old_name, old_cost, old_price) = old.ok_or_else(|| AppError::NotFound("Produit introuvable.".into()))?;
            tx.execute(
                "UPDATE products SET name=?1, sku=?2, barcode=?3, description=?4, category_id=?5, brand=?6, image=?7,
                    purchase_price=?8, selling_price=?9, tax_rate=?10, minimum_stock=?11, maximum_stock=?12, unit=?13,
                    supplier_id=?14, warehouse_id=?15, location=?16, batch_number=?17, expiration_date=?18, product_type=?19, updated_at=?20
                 WHERE id=?21",
                params![
                    p.name.trim(),
                    db::opt_str(&p.sku),
                    db::opt_str(&p.barcode),
                    db::opt_str(&p.description),
                    p.category_id,
                    db::opt_str(&p.brand),
                    db::opt_str(&p.image),
                    p.purchase_price,
                    p.selling_price,
                    p.tax_rate,
                    p.minimum_stock,
                    p.maximum_stock,
                    p.unit,
                    p.supplier_id,
                    p.warehouse_id,
                    db::opt_str(&p.location),
                    db::opt_str(&p.batch_number),
                    db::opt_str(&p.expiration_date),
                    kind,
                    now,
                    id
                ],
            )?;
            let mut changes = vec![];
            if (old_price - p.selling_price).abs() > 0.001 {
                changes.push(format!("prix de vente {old_price:.2} → {:.2} DH", p.selling_price));
            }
            if (old_cost - p.purchase_price).abs() > 0.001 {
                changes.push(format!("prix d'achat {old_cost:.2} → {:.2} DH", p.purchase_price));
            }
            let detail = if changes.is_empty() { String::new() } else { format!(" ({})", changes.join(", ")) };
            audit::log(&tx, Some(s), "product.update", Some("product"), Some(id), &format!("{} a modifié le produit {old_name}{detail}.", s.name), None)?;
            crate::notify::check_stock(&tx, id)?;
            id
        }
        None => {
            tx.execute(
                "INSERT INTO products (name, sku, barcode, description, category_id, brand, image, purchase_price, selling_price,
                    tax_rate, minimum_stock, maximum_stock, unit, supplier_id, warehouse_id, location, batch_number, expiration_date,
                    product_type, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?20)",
                params![
                    p.name.trim(),
                    db::opt_str(&p.sku),
                    db::opt_str(&p.barcode),
                    db::opt_str(&p.description),
                    p.category_id,
                    db::opt_str(&p.brand),
                    db::opt_str(&p.image),
                    p.purchase_price,
                    p.selling_price,
                    p.tax_rate,
                    p.minimum_stock,
                    p.maximum_stock,
                    p.unit,
                    p.supplier_id,
                    p.warehouse_id,
                    db::opt_str(&p.location),
                    db::opt_str(&p.batch_number),
                    db::opt_str(&p.expiration_date),
                    kind,
                    now
                ],
            )?;
            let id = tx.last_insert_rowid();
            let wh = match p.warehouse_id {
                Some(w) => w,
                None => stock::default_warehouse(&tx)?,
            };
            let q = p.initial_quantity.unwrap_or(0.0);
            if q > 0.0 {
                stock::apply_movement(
                    &tx,
                    &Movement {
                        product_id: id,
                        warehouse_id: wh,
                        kind: "INITIAL",
                        delta: q,
                        unit_cost: Some(p.purchase_price),
                        reason: Some("Stock initial"),
                        user_id: Some(s.user_id),
                        ..Default::default()
                    },
                )?;
                if db::opt_str(&p.batch_number).is_some() || db::opt_str(&p.expiration_date).is_some() {
                    stock::add_batch(&tx, id, wh, db::opt_str(&p.batch_number).as_deref(), db::opt_str(&p.expiration_date).as_deref(), q, None)?;
                }
            }
            audit::log(&tx, Some(s), "product.create", Some("product"), Some(id), &format!("{} a créé le produit {}.", s.name, p.name.trim()), Some(json!({ "initial_quantity": q })))?;
            id
        }
    };
    tx.commit()?;
    Ok(id)
}

pub fn duplicate(conn: &mut Connection, s: &Session, id: i64) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let name: String = tx
        .query_row("SELECT name FROM products WHERE id = ?", [id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| AppError::NotFound("Produit introuvable.".into()))?;
    let now = db::now();
    tx.execute(
        "INSERT INTO products (name, description, category_id, brand, image, purchase_price, selling_price, tax_rate,
            minimum_stock, maximum_stock, unit, supplier_id, warehouse_id, location, product_type, created_at, updated_at)
         SELECT name || ' (copie)', description, category_id, brand, image, purchase_price, selling_price, tax_rate,
            minimum_stock, maximum_stock, unit, supplier_id, warehouse_id, location, product_type, ?1, ?1
         FROM products WHERE id = ?2",
        params![now, id],
    )?;
    let new_id = tx.last_insert_rowid();
    audit::log(&tx, Some(s), "product.duplicate", Some("product"), Some(new_id), &format!("{} a dupliqué le produit {name}.", s.name), None)?;
    tx.commit()?;
    Ok(new_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::domain::stock::tests::{admin, qty, seed_user};

    fn base() -> ProductInput {
        ProductInput { name: "Coca Cola 1L".into(), selling_price: 7.0, purchase_price: 5.0, tax_rate: 20.0, unit: "piece".into(), barcode: Some("6111234567890".into()), ..Default::default() }
    }

    #[test]
    fn create_with_initial_stock_records_movement() {
        let mut c = test_conn();
        seed_user(&c);
        let id = save(&mut c, &admin(), &ProductInput { initial_quantity: Some(24.0), ..base() }).unwrap();
        assert_eq!(qty(&c, id), 24.0);
        let t: String = c.query_row("SELECT type FROM stock_movements WHERE product_id = ?", [id], |r| r.get(0)).unwrap();
        assert_eq!(t, "INITIAL");
    }

    #[test]
    fn duplicate_barcode_is_rejected() {
        let mut c = test_conn();
        seed_user(&c);
        save(&mut c, &admin(), &base()).unwrap();
        let err = save(&mut c, &admin(), &base()).unwrap_err();
        assert!(err.user_message().contains("code-barres"));
    }

    #[test]
    fn update_never_changes_quantity() {
        let mut c = test_conn();
        seed_user(&c);
        let id = save(&mut c, &admin(), &ProductInput { initial_quantity: Some(5.0), ..base() }).unwrap();
        save(&mut c, &admin(), &ProductInput { id: Some(id), selling_price: 8.0, initial_quantity: Some(100.0), ..base() }).unwrap();
        assert_eq!(qty(&c, id), 5.0);
    }

    #[test]
    fn validation_rejects_bad_input() {
        let mut c = test_conn();
        seed_user(&c);
        assert!(save(&mut c, &admin(), &ProductInput { name: "  ".into(), ..base() }).is_err());
        assert!(save(&mut c, &admin(), &ProductInput { selling_price: -1.0, ..base() }).is_err());
        assert!(save(&mut c, &admin(), &ProductInput { unit: "xx".into(), ..base() }).is_err());
    }
}
