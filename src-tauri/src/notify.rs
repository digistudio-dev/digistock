//! Notifications internes, dédupliquées pour ne jamais submerger l'utilisateur.

use crate::db;
use crate::error::AppResult;
use rusqlite::{params, Connection, OptionalExtension};

pub fn push(
    conn: &Connection,
    kind: &str,
    level: &str,
    title: &str,
    body: &str,
    entity: Option<(&str, i64)>,
    dedupe_key: Option<&str>,
) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO notifications (type, level, title, body, entity, entity_id, dedupe_key, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![kind, level, title, body, entity.map(|e| e.0), entity.map(|e| e.1), dedupe_key, db::now()],
    )?;
    Ok(())
}

fn release_key(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("UPDATE notifications SET dedupe_key = NULL WHERE dedupe_key = ?", [key])?;
    Ok(())
}

/// Vérifie le niveau de stock d'un produit après un mouvement.
/// Une alerte n'est émise qu'une fois tant que le produit n'est pas revenu à la normale.
pub fn check_stock(conn: &Connection, product_id: i64) -> AppResult<()> {
    let row: Option<(String, f64, f64, String, i64)> = conn
        .query_row(
            "SELECT name, quantity, minimum_stock, product_type, archived FROM products WHERE id = ?",
            [product_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((name, qty, min, kind, archived)) = row else { return Ok(()) };
    if kind == "service" || archived == 1 {
        return Ok(());
    }
    let low_key = format!("stock_low:{product_id}");
    let out_key = format!("stock_out:{product_id}");
    if qty <= 0.0 {
        push(conn, "stock_out", "danger", "Stock épuisé", &format!("{name} est en rupture de stock."), Some(("product", product_id)), Some(&out_key))?;
    } else if min > 0.0 && qty <= min {
        release_key(conn, &out_key)?;
        push(
            conn,
            "stock_low",
            "warning",
            "Stock faible",
            &format!("{name} : {} restant(s), minimum {}.", fmt_qty(qty), fmt_qty(min)),
            Some(("product", product_id)),
            Some(&low_key),
        )?;
    } else {
        release_key(conn, &out_key)?;
        release_key(conn, &low_key)?;
    }
    Ok(())
}

/// Analyse quotidienne des dates d'expiration (lots et produits).
pub fn scan_expirations(conn: &Connection) -> AppResult<()> {
    let today = db::today();
    let mut stmt = conn.prepare(
        "SELECT b.id, p.id, p.name, b.batch_number, b.expiration_date,
                CAST(julianday(b.expiration_date) - julianday(?1) AS INTEGER) AS days
         FROM product_batches b JOIN products p ON p.id = b.product_id
         WHERE b.quantity > 0 AND b.expiration_date IS NOT NULL AND p.archived = 0
           AND julianday(b.expiration_date) - julianday(?1) <= 7",
    )?;
    let rows: Vec<(i64, i64, String, Option<String>, String, i64)> = stmt
        .query_map([&today], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
        .collect::<Result<_, _>>()?;
    for (batch_id, pid, name, batch, _date, days) in rows {
        let lot = batch.map(|b| format!(" (lot {b})")).unwrap_or_default();
        if days < 0 {
            push(conn, "expired", "danger", "Produit expiré", &format!("{name}{lot} est expiré."), Some(("product", pid)), Some(&format!("exp:{batch_id}:expired")))?;
        } else {
            push(
                conn,
                "expiring",
                "warning",
                "Expiration proche",
                &format!("{name}{lot} expire dans {days} jour(s)."),
                Some(("product", pid)),
                Some(&format!("exp:{batch_id}:soon")),
            )?;
        }
    }
    let mut stmt = conn.prepare(
        "SELECT id, name, CAST(julianday(expiration_date) - julianday(?1) AS INTEGER)
         FROM products
         WHERE archived = 0 AND quantity > 0 AND expiration_date IS NOT NULL AND track_batches = 0
           AND julianday(expiration_date) - julianday(?1) <= 7",
    )?;
    let rows: Vec<(i64, String, i64)> =
        stmt.query_map([&today], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (pid, name, days) in rows {
        if days < 0 {
            push(conn, "expired", "danger", "Produit expiré", &format!("{name} est expiré."), Some(("product", pid)), Some(&format!("pexp:{pid}:expired")))?;
        } else {
            push(
                conn,
                "expiring",
                "warning",
                "Expiration proche",
                &format!("{name} expire dans {days} jour(s)."),
                Some(("product", pid)),
                Some(&format!("pexp:{pid}:soon")),
            )?;
        }
    }
    Ok(())
}

pub fn fmt_qty(q: f64) -> String {
    if (q - q.round()).abs() < 1e-9 {
        format!("{}", q.round() as i64)
    } else {
        format!("{:.3}", q).trim_end_matches('0').trim_end_matches('.').replace('.', ",")
    }
}
