import { format, startOfMonth, startOfYear, subDays, subMonths, endOfMonth } from "date-fns";
import { one, select } from "@/lib/db";
import { money, percent, qty, date as fdate } from "@/lib/format";
import { paymentLabel } from "@/i18n";

export type PeriodKey = "today" | "7d" | "30d" | "month" | "last_month" | "year" | "custom";
export type Grouping = "day" | "week" | "month";

export interface Period {
  from: string;
  to: string;
  label: string;
}

const iso = (d: Date) => format(d, "yyyy-MM-dd");

export function resolvePeriod(key: PeriodKey, custom: { from: string; to: string }): Period {
  const now = new Date();
  switch (key) {
    case "today":
      return { from: iso(now), to: iso(now), label: "Aujourd'hui" };
    case "7d":
      return { from: iso(subDays(now, 6)), to: iso(now), label: "7 derniers jours" };
    case "30d":
      return { from: iso(subDays(now, 29)), to: iso(now), label: "30 derniers jours" };
    case "month":
      return { from: iso(startOfMonth(now)), to: iso(now), label: "Ce mois-ci" };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { from: iso(startOfMonth(lm)), to: iso(endOfMonth(lm)), label: "Mois dernier" };
    }
    case "year":
      return { from: iso(startOfYear(now)), to: iso(now), label: "Cette année" };
    default:
      return { from: custom.from || iso(subDays(now, 29)), to: custom.to || iso(now), label: `Du ${fdate(custom.from)} au ${fdate(custom.to)}` };
  }
}

/** Section tabulaire réutilisée pour l'affichage, le CSV, le PDF et l'impression. */
export interface Section {
  id: string;
  title: string;
  columns: { key: string; label: string; align?: "right"; format?: (v: unknown) => string }[];
  rows: Record<string, unknown>[];
  premium?: boolean;
}

const m = (v: unknown) => money(Number(v ?? 0));
const q = (v: unknown) => qty(Number(v ?? 0));

export async function salesSummary(p: Period) {
  return one<{ revenue: number; profit: number; count: number; discounts: number; tax: number; cancelled: number; cost: number }>(
    `SELECT COALESCE(SUM(CASE WHEN status='completed' THEN total END),0) AS revenue,
            COALESCE(SUM(CASE WHEN status='completed' THEN profit END),0) AS profit,
            COUNT(CASE WHEN status='completed' THEN 1 END) AS count,
            COALESCE(SUM(CASE WHEN status='completed' THEN discount_total END),0) AS discounts,
            COALESCE(SUM(CASE WHEN status='completed' THEN tax_total END),0) AS tax,
            COALESCE(SUM(CASE WHEN status='completed' THEN cost_total END),0) AS cost,
            COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled
     FROM sales WHERE date(created_at) BETWEEN ? AND ?`,
    [p.from, p.to],
  );
}

export async function salesByPeriod(p: Period, g: Grouping): Promise<Section> {
  const key = g === "month" ? "strftime('%Y-%m', created_at)" : g === "week" ? "strftime('%Y-S%W', created_at)" : "date(created_at)";
  const rows = await select<Record<string, unknown>>(
    `SELECT ${key} AS period, COUNT(*) AS count, SUM(total) AS revenue, SUM(profit) AS profit, SUM(discount_total) AS discounts, SUM(tax_total) AS tax,
            SUM(total) / COUNT(*) AS average
     FROM sales WHERE status = 'completed' AND date(created_at) BETWEEN ? AND ? GROUP BY period ORDER BY period`,
    [p.from, p.to],
  );
  return {
    id: "sales_period",
    title: g === "month" ? "Ventes par mois" : g === "week" ? "Ventes par semaine" : "Ventes par jour",
    columns: [
      { key: "period", label: "Période", format: (v) => (g === "day" ? fdate(String(v)) : String(v)) },
      { key: "count", label: "Ventes", align: "right" },
      { key: "revenue", label: "Chiffre d'affaires", align: "right", format: m },
      { key: "profit", label: "Bénéfice", align: "right", format: m },
      { key: "average", label: "Panier moyen", align: "right", format: m },
      { key: "discounts", label: "Remises", align: "right", format: m },
      { key: "tax", label: "TVA", align: "right", format: m },
    ],
    rows,
  };
}

export async function paymentsSection(p: Period): Promise<Section> {
  const rows = await select<Record<string, unknown>>(
    `SELECT sp.method, COUNT(DISTINCT sp.sale_id) AS count, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ? GROUP BY sp.method ORDER BY amount DESC`,
    [p.from, p.to],
  );
  const received = await select<Record<string, unknown>>(
    `SELECT 'Règlements de crédit' AS method, COUNT(*) AS count, -SUM(amount) AS amount FROM customer_credit_transactions WHERE type = 'PAYMENT' AND date(created_at) BETWEEN ? AND ?`,
    [p.from, p.to],
  );
  return {
    id: "payments",
    title: "Encaissements par mode de paiement",
    columns: [
      { key: "method", label: "Mode", format: (v) => paymentLabel(String(v)) },
      { key: "count", label: "Opérations", align: "right" },
      { key: "amount", label: "Montant", align: "right", format: m },
    ],
    rows: [...rows, ...received.filter((r) => Number(r.count) > 0)],
  };
}

export async function productSections(p: Period, premium: boolean): Promise<Section[]> {
  const base = `FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ?`;
  const cols = [
    { key: "name", label: "Produit" },
    { key: "units", label: "Quantité", align: "right" as const, format: q },
    { key: "revenue", label: "Chiffre d'affaires", align: "right" as const, format: m },
    { key: "profit", label: "Bénéfice", align: "right" as const, format: m },
  ];
  const [best, worst, profit, value, low] = await Promise.all([
    select<Record<string, unknown>>(`SELECT si.product_name AS name, SUM(si.quantity) AS units, SUM(si.total) AS revenue, SUM(si.profit) AS profit ${base} GROUP BY si.product_id ORDER BY units DESC LIMIT 20`, [p.from, p.to]),
    premium
      ? select<Record<string, unknown>>(
          `SELECT p.name, COALESCE(x.units, 0) AS units, COALESCE(x.revenue, 0) AS revenue, COALESCE(x.profit, 0) AS profit FROM products p
           LEFT JOIN (SELECT si.product_id, SUM(si.quantity) AS units, SUM(si.total) AS revenue, SUM(si.profit) AS profit ${base} GROUP BY si.product_id) x ON x.product_id = p.id
           WHERE p.archived = 0 AND p.product_type <> 'service' ORDER BY units ASC, p.name LIMIT 20`,
          [p.from, p.to],
        )
      : Promise.resolve([]),
    premium ? select<Record<string, unknown>>(`SELECT si.product_name AS name, SUM(si.quantity) AS units, SUM(si.total) AS revenue, SUM(si.profit) AS profit ${base} GROUP BY si.product_id ORDER BY profit DESC LIMIT 20`, [p.from, p.to]) : Promise.resolve([]),
    select<Record<string, unknown>>(
      `SELECT COALESCE(c.name, 'Sans catégorie') AS category, COUNT(*) AS products, SUM(p.quantity) AS units, SUM(p.quantity * p.purchase_price) AS cost_value, SUM(p.quantity * p.selling_price) AS sale_value
       FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.archived = 0 AND p.quantity > 0 GROUP BY category ORDER BY cost_value DESC`,
    ),
    select<Record<string, unknown>>(
      `SELECT p.name, p.quantity, p.minimum_stock, s.name AS supplier, CASE WHEN p.quantity <= 0 THEN 'Rupture' ELSE 'Stock faible' END AS state
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.archived = 0 AND p.product_type <> 'service' AND (p.quantity <= 0 OR (p.minimum_stock > 0 AND p.quantity <= p.minimum_stock)) ORDER BY p.quantity`,
    ),
  ]);
  return [
    { id: "best", title: "Meilleures ventes", columns: cols, rows: best },
    { id: "worst", title: "Ventes les plus faibles", columns: cols, rows: worst, premium: true },
    { id: "profit", title: "Plus forts bénéfices", columns: cols, rows: profit, premium: true },
    {
      id: "value",
      title: "Valeur du stock par catégorie",
      columns: [
        { key: "category", label: "Catégorie" },
        { key: "products", label: "Produits", align: "right" },
        { key: "units", label: "Unités", align: "right", format: q },
        { key: "cost_value", label: "Valeur d'achat", align: "right", format: m },
        { key: "sale_value", label: "Valeur de vente", align: "right", format: m },
      ],
      rows: value,
    },
    {
      id: "low",
      title: "Stock faible et ruptures",
      columns: [
        { key: "name", label: "Produit" },
        { key: "state", label: "État" },
        { key: "quantity", label: "Stock", align: "right", format: q },
        { key: "minimum_stock", label: "Minimum", align: "right", format: q },
        { key: "supplier", label: "Fournisseur", format: (v) => String(v ?? "—") },
      ],
      rows: low,
    },
  ];
}

export async function customerSections(p: Period): Promise<Section[]> {
  const [top, debt] = await Promise.all([
    select<Record<string, unknown>>(
      `SELECT c.name, COUNT(*) AS count, SUM(s.total) AS revenue, SUM(s.profit) AS profit FROM sales s JOIN customers c ON c.id = s.customer_id
       WHERE s.status = 'completed' AND date(s.created_at) BETWEEN ? AND ? GROUP BY c.id ORDER BY revenue DESC LIMIT 25`,
      [p.from, p.to],
    ),
    select<Record<string, unknown>>("SELECT name, phone, balance, credit_limit FROM customers WHERE archived = 0 AND balance > 0 ORDER BY balance DESC"),
  ]);
  return [
    {
      id: "top_customers",
      title: "Meilleurs clients",
      columns: [
        { key: "name", label: "Client" },
        { key: "count", label: "Achats", align: "right" },
        { key: "revenue", label: "Chiffre d'affaires", align: "right", format: m },
        { key: "profit", label: "Bénéfice", align: "right", format: m },
      ],
      rows: top,
    },
    {
      id: "debts",
      title: "Crédits clients",
      columns: [
        { key: "name", label: "Client" },
        { key: "phone", label: "Téléphone", format: (v) => String(v ?? "—") },
        { key: "credit_limit", label: "Plafond", align: "right", format: (v) => (Number(v) ? m(v) : "—") },
        { key: "balance", label: "Solde dû", align: "right", format: m },
      ],
      rows: debt,
    },
  ];
}

export async function supplierSections(p: Period): Promise<Section[]> {
  const [bySupplier, balances] = await Promise.all([
    select<Record<string, unknown>>(
      `SELECT s.name, COUNT(*) AS count, SUM(p.subtotal) AS subtotal, SUM(p.total) AS total, SUM(p.paid_amount) AS paid FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.status = 'received' AND p.purchase_date BETWEEN ? AND ? GROUP BY s.id ORDER BY total DESC`,
      [p.from, p.to],
    ),
    select<Record<string, unknown>>("SELECT name, phone, payment_terms, balance FROM suppliers WHERE archived = 0 AND balance > 0 ORDER BY balance DESC"),
  ]);
  return [
    {
      id: "purchases_supplier",
      title: "Achats par fournisseur",
      columns: [
        { key: "name", label: "Fournisseur" },
        { key: "count", label: "Achats", align: "right" },
        { key: "subtotal", label: "Total HT", align: "right", format: m },
        { key: "total", label: "Total TTC", align: "right", format: m },
        { key: "paid", label: "Payé", align: "right", format: m },
      ],
      rows: bySupplier,
    },
    {
      id: "supplier_balances",
      title: "Soldes fournisseurs à payer",
      columns: [
        { key: "name", label: "Fournisseur" },
        { key: "phone", label: "Téléphone", format: (v) => String(v ?? "—") },
        { key: "payment_terms", label: "Conditions", format: (v) => String(v ?? "—") },
        { key: "balance", label: "Solde dû", align: "right", format: m },
      ],
      rows: balances,
    },
  ];
}

export const fmtCell = (c: Section["columns"][number], v: unknown) => (c.format ? c.format(v) : v === null || v === undefined ? "—" : String(v));

export { percent };
