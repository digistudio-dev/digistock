/**
 * Suggestion de réapprovisionnement.
 * quantité = ventes moyennes/jour × délai fournisseur + stock de sécurité − stock actuel
 * Le stock de sécurité vaut le plus grand de : stock minimum, ventes/jour × jours de sécurité.
 */
export interface ReorderInput {
  avgDailySales: number;
  leadTimeDays: number;
  safetyDays: number;
  minimumStock: number;
  currentStock: number;
  maximumStock?: number | null;
}

export function safetyStock(i: Pick<ReorderInput, "avgDailySales" | "safetyDays" | "minimumStock">) {
  return Math.max(i.minimumStock, i.avgDailySales * i.safetyDays);
}

export function recommendedQuantity(i: ReorderInput): number {
  let q: number;
  if (i.avgDailySales <= 0) {
    // Aucun historique de ventes : on vise le double du stock minimum.
    q = basicRecommendedQuantity(i.minimumStock, i.currentStock);
  } else {
    const target = i.avgDailySales * i.leadTimeDays + safetyStock(i);
    q = Math.ceil(target - Math.max(i.currentStock, 0) - 1e-9);
    // Toujours remonter au-dessus du seuil d'alerte.
    if (i.currentStock + q <= i.minimumStock) q = Math.ceil(i.minimumStock - Math.max(i.currentStock, 0)) + 1;
  }
  if (i.maximumStock && i.maximumStock > 0) q = Math.min(q, Math.ceil(i.maximumStock - i.currentStock));
  return Math.max(q, 0);
}

/** Version simple (gratuite) : remonter au double du stock minimum. */
export function basicRecommendedQuantity(minimumStock: number, currentStock: number) {
  return Math.max(Math.ceil(minimumStock * 2 - Math.max(currentStock, 0)), 1);
}

/** Jours de stock restants au rythme actuel (Infinity si aucune vente). */
export function daysOfStock(currentStock: number, avgDailySales: number) {
  if (avgDailySales <= 0) return Infinity;
  return Math.max(currentStock, 0) / avgDailySales;
}

export function coverageLabel(days: number) {
  if (!Number.isFinite(days)) return "Pas de ventes récentes";
  if (days <= 0) return "Épuisé";
  if (days < 1) return "Moins d'un jour";
  if (days < 2) return "Environ 1 jour";
  if (days < 14) return `Environ ${Math.floor(days)} jours`;
  if (days < 60) return `Environ ${Math.round(days / 7)} semaines`;
  return "Plus de 2 mois";
}
