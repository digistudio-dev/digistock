//! CRUD générique et contrôlé pour les référentiels simples.
//! Seules les tables et colonnes listées ici sont modifiables depuis l'interface.

use crate::audit;
use crate::db::{self, json_to_sql};
use crate::error::{AppError, AppResult};
use crate::premium;
use crate::state::Session;
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde_json::{Map, Value};

pub struct EntitySpec {
    pub table: &'static str,
    pub label: &'static str,
    pub permission: &'static str,
    pub columns: &'static [&'static str],
    pub numeric: &'static [&'static str],
    pub archivable: bool,
}

pub const ENTITIES: &[EntitySpec] = &[
    EntitySpec {
        table: "categories",
        label: "catégorie",
        permission: "manage_products",
        columns: &["name", "description", "color", "icon"],
        numeric: &[],
        archivable: true,
    },
    EntitySpec {
        table: "customers",
        label: "client",
        permission: "manage_customers",
        columns: &["name", "phone", "whatsapp", "email", "address", "city", "ice", "notes", "credit_limit"],
        numeric: &["credit_limit"],
        archivable: true,
    },
    EntitySpec {
        table: "suppliers",
        label: "fournisseur",
        permission: "manage_suppliers",
        columns: &["name", "company_name", "phone", "whatsapp", "email", "address", "city", "ice", "payment_terms", "lead_time_days", "notes"],
        numeric: &["lead_time_days"],
        archivable: true,
    },
    EntitySpec {
        table: "warehouses",
        label: "entrepôt",
        permission: "manage_stock",
        columns: &["name", "address", "manager", "notes"],
        numeric: &[],
        archivable: true,
    },
    EntitySpec { table: "products", label: "produit", permission: "manage_products", columns: &[], numeric: &[], archivable: true },
];

pub fn spec(table: &str) -> AppResult<&'static EntitySpec> {
    ENTITIES.iter().find(|e| e.table == table).ok_or(AppError::Forbidden)
}

fn clean(spec: &EntitySpec, values: &Map<String, Value>) -> AppResult<Vec<(&'static str, Value)>> {
    let mut out = Vec::new();
    for col in spec.columns {
        if let Some(v) = values.get(*col) {
            let v = match v {
                Value::String(s) => {
                    let t = s.trim();
                    if t.is_empty() {
                        Value::Null
                    } else if t.chars().count() > 2000 {
                        return Err(AppError::validation("Un des champs est trop long."));
                    } else {
                        Value::String(t.to_string())
                    }
                }
                Value::Number(n) if spec.numeric.contains(col) => {
                    if n.as_f64().map(|f| f < 0.0).unwrap_or(true) {
                        return Err(AppError::validation("Les valeurs numériques doivent être positives."));
                    }
                    v.clone()
                }
                Value::Null => Value::Null,
                Value::Number(_) | Value::Bool(_) => v.clone(),
                _ => return Err(AppError::validation("Valeur invalide.")),
            };
            out.push((*col, v));
        }
    }
    Ok(out)
}

pub fn save(conn: &Connection, s: &Session, table: &str, id: Option<i64>, values: &Map<String, Value>) -> AppResult<i64> {
    let spec = spec(table)?;
    if spec.columns.is_empty() {
        return Err(AppError::Forbidden);
    }
    if !s.can(spec.permission) {
        return Err(AppError::Forbidden);
    }
    let fields = clean(spec, values)?;
    let name = fields.iter().find(|(c, _)| *c == "name").map(|(_, v)| v.clone());
    if id.is_none() || name.is_some() {
        match &name {
            Some(Value::String(_)) => {}
            _ => return Err(AppError::validation("Le nom est obligatoire.")),
        }
    }
    if table == "warehouses" && id.is_none() {
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM warehouses WHERE archived = 0", [], |r| r.get(0))?;
        if count >= 1 {
            premium::require(conn)?;
        }
    }
    let now = db::now();
    let display = name.as_ref().and_then(|v| v.as_str()).unwrap_or("").to_string();
    let new_id = match id {
        Some(id) => {
            if fields.is_empty() {
                return Ok(id);
            }
            let sets: Vec<String> = fields.iter().map(|(c, _)| format!("{c} = ?")).collect();
            let sql = format!("UPDATE {} SET {}, updated_at = ? WHERE id = ?", spec.table, sets.join(", "));
            let mut params: Vec<_> = fields.iter().map(|(_, v)| json_to_sql(v)).collect();
            params.push(rusqlite::types::Value::Text(now));
            params.push(rusqlite::types::Value::Integer(id));
            let n = conn.execute(&sql, params_from_iter(params.iter()))?;
            if n == 0 {
                return Err(AppError::NotFound("Élément introuvable.".into()));
            }
            audit::log(conn, Some(s), &format!("{}.update", spec.table), Some(spec.table), Some(id), &format!("{} a modifié le {} {display}.", s.name, spec.label), None)?;
            id
        }
        None => {
            let cols: Vec<&str> = fields.iter().map(|(c, _)| *c).collect();
            let marks: Vec<&str> = cols.iter().map(|_| "?").collect();
            let sql = format!(
                "INSERT INTO {} ({}, created_at, updated_at) VALUES ({}, ?, ?)",
                spec.table,
                cols.join(", "),
                marks.join(", ")
            );
            let mut params: Vec<_> = fields.iter().map(|(_, v)| json_to_sql(v)).collect();
            params.push(rusqlite::types::Value::Text(now.clone()));
            params.push(rusqlite::types::Value::Text(now));
            conn.execute(&sql, params_from_iter(params.iter()))?;
            let id = conn.last_insert_rowid();
            audit::log(conn, Some(s), &format!("{}.create", spec.table), Some(spec.table), Some(id), &format!("{} a créé le {} {display}.", s.name, spec.label), None)?;
            id
        }
    };
    Ok(new_id)
}

pub fn set_archived(conn: &Connection, s: &Session, table: &str, id: i64, archived: bool) -> AppResult<()> {
    let spec = spec(table)?;
    if !spec.archivable || !s.can(spec.permission) {
        return Err(AppError::Forbidden);
    }
    if table == "warehouses" {
        let is_default: Option<i64> = conn.query_row("SELECT is_default FROM warehouses WHERE id = ?", [id], |r| r.get(0)).optional()?;
        if is_default == Some(1) {
            return Err(AppError::validation("L'entrepôt principal ne peut pas être archivé."));
        }
        let stock: f64 = conn.query_row("SELECT COALESCE(SUM(quantity),0) FROM warehouse_stock WHERE warehouse_id = ?", [id], |r| r.get(0))?;
        if archived && stock > 0.0 {
            return Err(AppError::validation("Cet entrepôt contient encore du stock. Transférez-le avant d'archiver."));
        }
    }
    let sql = format!("UPDATE {} SET archived = ?, updated_at = ? WHERE id = ?", spec.table);
    let n = conn.execute(&sql, rusqlite::params![archived as i64, db::now(), id])?;
    if n == 0 {
        return Err(AppError::NotFound("Élément introuvable.".into()));
    }
    let name: String = conn
        .query_row(&format!("SELECT name FROM {} WHERE id = ?", spec.table), [id], |r| r.get(0))
        .unwrap_or_default();
    let verb = if archived { "archivé" } else { "restauré" };
    audit::log(conn, Some(s), &format!("{}.archive", spec.table), Some(spec.table), Some(id), &format!("{} a {verb} le {} {name}.", s.name, spec.label), None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_conn;
    use crate::domain::stock::tests::seed_user;
    use serde_json::json;

    fn session(perms: &[&str]) -> Session {
        Session { user_id: 1, name: "Test".into(), username: "t".into(), role_id: None, role_name: None, permissions: perms.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn permissions_are_enforced() {
        let c = test_conn();
        seed_user(&c);
        let v = json!({ "name": "Client A", "phone": "0612345678" });
        let v = v.as_object().unwrap();
        assert!(matches!(save(&c, &session(&[]), "customers", None, v), Err(AppError::Forbidden)));
        assert!(save(&c, &session(&["manage_customers"]), "customers", None, v).is_ok());
    }

    #[test]
    fn unknown_tables_and_columns_are_rejected() {
        let c = test_conn();
        seed_user(&c);
        let s = session(&["manage_customers", "manage_users"]);
        let v = json!({ "name": "x" });
        assert!(save(&c, &s, "users", None, v.as_object().unwrap()).is_err());
        let v = json!({ "name": "Client", "balance": 9999 });
        let id = save(&c, &s, "customers", None, v.as_object().unwrap()).unwrap();
        let bal: f64 = c.query_row("SELECT balance FROM customers WHERE id = ?", [id], |r| r.get(0)).unwrap();
        assert_eq!(bal, 0.0);
    }

    #[test]
    fn second_warehouse_requires_premium() {
        let c = test_conn();
        seed_user(&c);
        let s = session(&["manage_stock"]);
        let v = json!({ "name": "Entrepôt A" });
        assert!(matches!(save(&c, &s, "warehouses", None, v.as_object().unwrap()), Err(AppError::Premium)));
        assert!(set_archived(&c, &s, "warehouses", 1, true).is_err());
    }
}
