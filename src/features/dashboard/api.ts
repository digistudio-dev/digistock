import { format, subDays, subMonths } from "date-fns";
import { fr } from "date-fns/locale";
import { one, select } from "@/lib/db";

export type Range = "7d" | "30d" | "12m";

export interface TodayStats {
  revenue: number;
  profit: number;
  count: number;
  y_revenue: number;
  y_profit: number;
  y_count: number;
}

export const todayStats = () =>
  one<TodayStats>(
    `SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime') THEN total END), 0) AS revenue,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime') THEN profit END), 0) AS profit,
      COUNT(CASE WHEN date(created_at) = date('now','localtime') THEN 1 END) AS count,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime','-1 day') THEN total END), 0) AS y_revenue,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now','localtime','-1 day') THEN profit END), 0) AS y_profit,
      COUNT(CASE WHEN date(created_at) = date('now','localtime','-1 day') THEN 1 END) AS y_count
     FROM sales WHERE status = 'completed' AND created_at >= date('now','localtime','-1 day')`,
  );

export const secondaryStats = () =>
  one<{ low: number; out: number; stock_value: number; credits: number; orders: number; expiring: number }>(
    `SELECT
      (SELECT COUNT(*) FROM products WHERE archived = 0 AND product_type <> 'service' AND quantity > 0 AND minimum_stock > 0 AND quantity <= minimum_stock) AS low,
      (SELECT COUNT(*) FROM products WHERE archived = 0 AND product_type <> 'service' AND quantity <= 0) AS out,
      (SELECT COALESCE(SUM(quantity * purchase_price), 0) FROM products WHERE archived = 0 AND quantity > 0) AS stock_value,
      (SELECT COALESCE(SUM(balance), 0) FROM customers WHERE archived = 0 AND balance > 0) AS credits,
      (SELECT COUNT(*) FROM purchases WHERE status = 'ordered') AS orders,
      (SELECT COUNT(*) FROM product_batches b JOIN products p ON p.id = b.product_id WHERE p.archived = 0 AND b.quantity > 0 AND b.expiration_date IS NOT NULL AND b.expiration_date <= date('now','localtime','+30 days')) AS expiring`,
  );

/** Série de chiffre d'affaires avec les jours/mois sans vente remplis à zéro. */
export async function revenueSeries(range: Range) {
  const now = new Date();
  if (range === "12m") {
    const rows = await select<{ k: string; v: number }>(
      "SELECT strftime('%Y-%m', created_at) AS k, SUM(total) AS v FROM sales WHERE status = 'completed' AND created_at >= date('now','localtime','start of month','-11 months') GROUP BY k",
    );
    const map = new Map(rows.map((r) => [r.k, r.v]));
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(now, 11 - i);
      return { label: format(d, "MMM yy", { locale: fr }), value: map.get(format(d, "yyyy-MM")) ?? 0 };
    });
  }
  const days = range === "7d" ? 7 : 30;
  const rows = await select<{ k: string; v: number }>(
    "SELECT date(created_at) AS k, SUM(total) AS v FROM sales WHERE status = 'completed' AND created_at >= date('now','localtime',?) GROUP BY k",
    [`-${days - 1} days`],
  );
  const map = new Map(rows.map((r) => [r.k, r.v]));
  return Array.from({ length: days }, (_, i) => {
    const d = subDays(now, days - 1 - i);
    return { label: format(d, days === 7 ? "EEE d" : "dd/MM", { locale: fr }), value: map.get(format(d, "yyyy-MM-dd")) ?? 0 };
  });
}

export const topProducts = (days = 30, limit = 6) =>
  select<{ product_id: number; name: string; units: number; revenue: number }>(
    `SELECT si.product_id, si.product_name AS name, SUM(si.quantity) AS units, SUM(si.total) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'completed' AND s.created_at >= date('now','localtime',?)
     GROUP BY si.product_id ORDER BY revenue DESC LIMIT ?`,
    [`-${days} days`, limit],
  );

export const lowStock = (limit = 6) =>
  select<{ id: number; name: string; quantity: number; minimum_stock: number; unit: string; supplier_id: number | null; supplier_name: string | null }>(
    `SELECT p.id, p.name, p.quantity, p.minimum_stock, p.unit, p.supplier_id, s.name AS supplier_name
     FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.archived = 0 AND p.product_type <> 'service' AND (p.quantity <= 0 OR (p.minimum_stock > 0 AND p.quantity <= p.minimum_stock))
     ORDER BY (p.quantity / NULLIF(p.minimum_stock, 0)) ASC, p.quantity ASC LIMIT ?`,
    [limit],
  );

export const recentSales = (limit = 7) =>
  select<{ id: number; number: string; total: number; payment_method: string; created_at: string; customer_name: string | null; status: string }>(
    "SELECT s.id, s.number, s.total, s.payment_method, s.created_at, s.status, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id ORDER BY s.id DESC LIMIT ?",
    [limit],
  );

export const recentActivity = (limit = 7) =>
  select<{ id: number; description: string; action: string; created_at: string }>("SELECT id, description, action, created_at FROM audit_logs ORDER BY id DESC LIMIT ?", [limit]);
