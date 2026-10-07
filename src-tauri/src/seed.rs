//! Données de démonstration — disponibles UNIQUEMENT en mode développement (build debug).
//! Identifiants de test : admin / admin123 (voir docs/DEVELOPMENT.md).

use crate::db;
use crate::domain::auth::{self, AdminInput, SetupInput};
use crate::domain::customers;
use crate::domain::sales::{self, SaleInput, SaleItemInput};
use crate::domain::stock::{self, Movement};
use crate::error::AppResult;
use crate::state::Session;
use chrono::{Duration, Local};
use rand::{rngs::StdRng, Rng, SeedableRng};
use rusqlite::{params, Connection};
use serde_json::json;

fn ean13(base12: &str) -> String {
    let sum: u32 = base12
        .chars()
        .enumerate()
        .map(|(i, c)| c.to_digit(10).unwrap_or(0) * if i % 2 == 0 { 1 } else { 3 })
        .sum();
    format!("{base12}{}", (10 - sum % 10) % 10)
}

pub fn seed_demo(conn: &mut Connection) -> AppResult<Session> {
    let session = auth::setup(
        conn,
        &SetupInput {
            company: json!({
                "name": "Demo Store", "phone": "05 22 00 00 00", "whatsapp": "06 00 00 00 00",
                "email": "contact@demostore.ma", "address": "12 Boulevard Zerktouni", "city": "Casablanca",
                "ice": "001234567000089", "if_number": "12345678", "rc": "123456", "currency": "MAD"
            })
            .as_object()
            .cloned()
            .unwrap_or_default(),
            business_type: "commerce".into(),
            receipt_format: "ticket_80".into(),
            admin: AdminInput { name: "Administrateur".into(), username: "admin".into(), email: None, password: "admin123".into() },
        },
    )?;
    let mut rng = StdRng::seed_from_u64(2026);
    let start = (Local::now() - Duration::days(95)).format("%Y-%m-%d 08:00:00").to_string();

    let tx = conn.transaction()?;
    let categories = [
        ("Boissons", "#2563eb"),
        ("Épicerie", "#d97706"),
        ("Produits laitiers", "#0891b2"),
        ("Hygiène", "#7c3aed"),
        ("Entretien", "#059669"),
        ("Snacks", "#dc2626"),
        ("Électronique", "#4f46e5"),
    ];
    for (name, color) in categories {
        tx.execute("INSERT INTO categories (name, color, created_at, updated_at) VALUES (?, ?, ?, ?)", params![name, color, start, start])?;
    }
    let suppliers = [
        ("ABC Distribution", "ABC Distribution SARL", "0661234567", 3),
        ("Coca Distribution", "Coca-Cola Maroc", "0662345678", 5),
        ("Centrale Laitière Dist.", "CLD SA", "0663456789", 2),
        ("Hygiène Pro", "Hygiène Pro SARL", "0664567890", 4),
        ("TechImport", "TechImport SARL", "0665678901", 10),
    ];
    for (name, company, phone, lead) in suppliers {
        tx.execute(
            "INSERT INTO suppliers (name, company_name, phone, whatsapp, city, payment_terms, lead_time_days, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3, 'Casablanca', '30 jours', ?4, ?5, ?5)",
            params![name, company, phone, lead, start],
        )?;
    }
    let customers = [
        ("Mohammed Alaoui", "0670112233", 2000.0),
        ("Fatima Zahra Bennani", "0671223344", 1500.0),
        ("Youssef El Idrissi", "0672334455", 0.0),
        ("Khadija Tazi", "0673445566", 3000.0),
        ("Hamza Berrada", "0674556677", 1000.0),
        ("Salma Chraibi", "0675667788", 0.0),
        ("Épicerie Al Amal", "0676778899", 5000.0),
        ("Café Atlas", "0677889900", 4000.0),
    ];
    for (name, phone, limit) in customers {
        tx.execute(
            "INSERT INTO customers (name, phone, whatsapp, city, credit_limit, created_at, updated_at) VALUES (?1, ?2, ?2, 'Casablanca', ?3, ?4, ?4)",
            params![name, phone, limit, start],
        )?;
    }
    // (nom, catégorie, fournisseur, achat, vente, tva, qté, min, unité)
    let products: &[(&str, i64, i64, f64, f64, f64, f64, f64, &str)] = &[
        ("Coca Cola 1L", 1, 2, 7.5, 10.0, 20.0, 48.0, 10.0, "piece"),
        ("Coca Cola 33cl", 1, 2, 4.2, 6.0, 20.0, 120.0, 24.0, "piece"),
        ("Fanta Orange 1L", 1, 2, 7.0, 10.0, 20.0, 30.0, 10.0, "piece"),
        ("Sprite 1L", 1, 2, 7.0, 10.0, 20.0, 6.0, 10.0, "piece"),
        ("Eau Sidi Ali 1,5L", 1, 1, 4.0, 6.0, 20.0, 200.0, 48.0, "piece"),
        ("Eau Oulmès 1L", 1, 1, 5.5, 8.0, 20.0, 60.0, 24.0, "piece"),
        ("Jus Valencia 1L", 1, 1, 9.0, 13.0, 20.0, 3.0, 12.0, "piece"),
        ("Thé Sultan 200g", 2, 1, 16.0, 22.0, 20.0, 40.0, 10.0, "piece"),
        ("Sucre Cosumar 2kg", 2, 1, 15.5, 19.0, 0.0, 35.0, 10.0, "piece"),
        ("Huile Lesieur 1L", 2, 1, 17.0, 21.0, 20.0, 25.0, 12.0, "piece"),
        ("Farine Mouna 5kg", 2, 1, 32.0, 40.0, 0.0, 18.0, 6.0, "piece"),
        ("Riz Taous 1kg", 2, 1, 13.0, 17.0, 20.0, 0.0, 8.0, "piece"),
        ("Pâtes Dari 500g", 2, 1, 5.5, 8.0, 20.0, 70.0, 20.0, "piece"),
        ("Café Dubois 250g", 2, 1, 24.0, 32.0, 20.0, 15.0, 5.0, "piece"),
        ("Lait Centrale 1L", 3, 3, 6.4, 7.5, 0.0, 80.0, 30.0, "piece"),
        ("Yaourt Jaouda x4", 3, 3, 8.5, 11.0, 20.0, 36.0, 12.0, "pack"),
        ("Fromage La Vache qui rit 16p", 3, 3, 19.0, 25.0, 20.0, 22.0, 8.0, "box"),
        ("Beurre Président 200g", 3, 3, 18.0, 24.0, 20.0, 4.0, 6.0, "piece"),
        ("Savon Dove", 4, 4, 9.0, 14.0, 20.0, 50.0, 10.0, "piece"),
        ("Shampoing Pantene 400ml", 4, 4, 28.0, 39.0, 20.0, 20.0, 6.0, "piece"),
        ("Dentifrice Signal", 4, 4, 11.0, 16.0, 20.0, 34.0, 10.0, "piece"),
        ("Couches Pampers T4", 4, 4, 85.0, 110.0, 20.0, 9.0, 4.0, "pack"),
        ("Javel Ace 1L", 5, 4, 7.0, 10.0, 20.0, 45.0, 12.0, "piece"),
        ("Liquide vaisselle Mio", 5, 4, 9.5, 14.0, 20.0, 2.0, 8.0, "piece"),
        ("Lessive Tide 3kg", 5, 4, 58.0, 75.0, 20.0, 14.0, 5.0, "piece"),
        ("Chips Lay's 45g", 6, 1, 3.2, 5.0, 20.0, 90.0, 30.0, "piece"),
        ("Biscuits Henry's", 6, 1, 1.6, 2.5, 20.0, 150.0, 40.0, "piece"),
        ("Chocolat Tonik", 6, 1, 1.8, 3.0, 20.0, 0.0, 30.0, "piece"),
        ("Câble USB-C 1m", 7, 5, 18.0, 45.0, 20.0, 25.0, 5.0, "piece"),
        ("Écouteurs filaires", 7, 5, 25.0, 60.0, 20.0, 12.0, 4.0, "piece"),
        ("Chargeur 20W", 7, 5, 55.0, 120.0, 20.0, 8.0, 3.0, "piece"),
        ("Pile AA x4", 7, 5, 9.0, 18.0, 20.0, 40.0, 10.0, "pack"),
    ];
    let mut ids = vec![];
    for (i, (name, cat, sup, cost, price, tax, qty, min, unit)) in products.iter().enumerate() {
        let barcode = ean13(&format!("611{:09}", 100000 + i * 37));
        tx.execute(
            "INSERT INTO products (name, sku, barcode, category_id, supplier_id, purchase_price, selling_price, tax_rate, minimum_stock,
                                   unit, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
            params![name, format!("SKU-{:04}", i + 1), barcode, cat, sup, cost, price, tax, min, unit, start],
        )?;
        let id = tx.last_insert_rowid();
        // Stock initial confortable puis ventes simulées → la quantité finale approche `qty`.
        stock::apply_movement(
            &tx,
            &Movement { product_id: id, warehouse_id: 1, kind: "INITIAL", delta: qty + 200.0, unit_cost: Some(*cost), reason: Some("Stock initial"), user_id: Some(session.user_id), created_at: Some(&start), ..Default::default() },
        )?;
        ids.push((id, *price, *qty));
    }
    // Lot avec expiration proche pour la démonstration
    tx.execute(
        "INSERT INTO product_batches (product_id, warehouse_id, batch_number, purchase_date, expiration_date, initial_quantity, quantity)
         VALUES (?1, 1, 'L-2611', date('now','localtime','-20 days'), date('now','localtime','+5 days'), 20, 20)",
        [ids[15].0],
    )?;
    tx.execute("UPDATE products SET track_batches = 1, expiration_date = date('now','localtime','+5 days') WHERE id = ?", [ids[15].0])?;

    // Ventes sur 90 jours
    let methods = ["cash", "cash", "cash", "card", "transfer", "credit"];
    for day in (0..90).rev() {
        let n = rng.gen_range(2..9);
        for k in 0..n {
            let date = Local::now() - Duration::days(day) - Duration::minutes(rng.gen_range(0..600) + k * 3);
            let created = date.format("%Y-%m-%d %H:%M:%S").to_string();
            let mut items = vec![];
            for _ in 0..rng.gen_range(1..5) {
                let (pid, price, _) = ids[rng.gen_range(0..ids.len())];
                if items.iter().any(|i: &SaleItemInput| i.product_id == pid) {
                    continue;
                }
                items.push(SaleItemInput { product_id: pid, quantity: rng.gen_range(1..4) as f64, unit_price: price, discount: 0.0 });
            }
            let method = methods[rng.gen_range(0..methods.len())];
            let customer = if method == "credit" { Some(rng.gen_range(1..9)) } else if rng.gen_bool(0.3) { Some(rng.gen_range(1..9)) } else { None };
            let input = SaleInput {
                customer_id: customer,
                warehouse_id: None,
                items,
                discount: 0.0,
                payment_method: method.into(),
                received_amount: None,
                paid_now: Some(0.0),
                note: None,
            };
            tx.execute_batch("SAVEPOINT demo_sale")?;
            match sales::create_in_tx(&tx, &session, &input, Some(&created)) {
                Ok(_) => tx.execute_batch("RELEASE demo_sale")?,
                Err(_) => tx.execute_batch("ROLLBACK TO demo_sale; RELEASE demo_sale")?,
            }
        }
    }
    // Ramène chaque produit à sa quantité cible via un ajustement tracé
    for (pid, _, target) in &ids {
        let current = stock::warehouse_qty(&tx, *pid, 1)?;
        let delta = db::round3(target - current);
        if delta != 0.0 {
            stock::apply_movement(
                &tx,
                &Movement { product_id: *pid, warehouse_id: 1, kind: "ADJUSTMENT", delta, reason: Some("Inventaire de démonstration"), user_id: Some(session.user_id), allow_negative: true, ..Default::default() },
            )?;
        }
    }
    tx.commit()?;
    // Quelques remboursements de crédit
    let debtors: Vec<(i64, f64)> = {
        let mut stmt = conn.prepare("SELECT id, balance FROM customers WHERE balance > 100")?;
        let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    for (cid, bal) in debtors.into_iter().take(3) {
        customers::add_payment(conn, &session, cid, db::round2(bal / 3.0), "cash", Some("Paiement partiel".into()))?;
    }
    conn.execute("UPDATE customers SET credit_limit = MAX(credit_limit, balance + 1000) WHERE credit_limit > 0", [])?;
    crate::notify::scan_expirations(conn)?;
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Intégration : le scénario complet de démonstration conserve les invariants de stock.
    #[test]
    fn demo_seed_keeps_stock_invariants() {
        let mut c = crate::db::test_conn();
        seed_demo(&mut c).unwrap();
        let sales: i64 = c.query_row("SELECT COUNT(*) FROM sales", [], |r| r.get(0)).unwrap();
        assert!(sales > 100);
        // quantité produit = somme des stocks par entrepôt = somme des mouvements
        let bad: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM products p WHERE abs(p.quantity - COALESCE((SELECT SUM(quantity) FROM warehouse_stock WHERE product_id = p.id), 0)) > 0.0001
                   OR abs(p.quantity - COALESCE((SELECT SUM(quantity) FROM stock_movements WHERE product_id = p.id), 0)) > 0.0001",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bad, 0);
        // solde client = somme des transactions de crédit
        let bad_credit: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM customers c WHERE abs(c.balance - COALESCE((SELECT SUM(amount) FROM customer_credit_transactions WHERE customer_id = c.id), 0)) > 0.01",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bad_credit, 0);
        // total des ventes = somme des lignes
        let bad_sales: i64 = c
            .query_row("SELECT COUNT(*) FROM sales s WHERE abs(s.total - (SELECT SUM(total) FROM sale_items WHERE sale_id = s.id)) > 0.01", [], |r| r.get(0))
            .unwrap();
        assert_eq!(bad_sales, 0);
    }
}
