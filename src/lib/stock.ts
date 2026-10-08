export type StockLevel = "normal" | "low" | "critical" | "out";

/** Niveau de stock : Normal, Faible (≤ minimum), Critique (≤ moitié du minimum), Rupture (≤ 0). */
export function stockLevel(quantity: number, minimum: number, criticalRatio = 0.5): StockLevel {
  if (quantity <= 0) return "out";
  if (minimum > 0 && quantity <= minimum * criticalRatio) return "critical";
  if (minimum > 0 && quantity <= minimum) return "low";
  return "normal";
}

export const STOCK_LEVEL_LABEL: Record<StockLevel, string> = {
  normal: "Normal",
  low: "Faible",
  critical: "Critique",
  out: "Rupture",
};

export type ExpiryStatus = "expired" | "7d" | "30d" | "ok";

export function daysUntil(dateStr: string, today = new Date()) {
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function expiryStatus(expiration: string | null | undefined, today = new Date()): ExpiryStatus | null {
  if (!expiration) return null;
  const days = daysUntil(expiration, today);
  if (days < 0) return "expired";
  if (days <= 7) return "7d";
  if (days <= 30) return "30d";
  return "ok";
}

export const EXPIRY_LABEL: Record<ExpiryStatus, string> = {
  expired: "Expiré",
  "7d": "Expire dans 7 jours",
  "30d": "Expire dans 30 jours",
  ok: "Valide",
};

/** Expression SQL du niveau de stock, cohérente avec `stockLevel`. */
export const SQL_STOCK_LEVEL = `CASE
  WHEN p.quantity <= 0 THEN 'out'
  WHEN p.minimum_stock > 0 AND p.quantity <= p.minimum_stock * 0.5 THEN 'critical'
  WHEN p.minimum_stock > 0 AND p.quantity <= p.minimum_stock THEN 'low'
  ELSE 'normal' END`;
