import { round2 } from "./utils";

/**
 * Calculs commerciaux — miroir exact de `src-tauri/src/domain/sales.rs`.
 * Le backend recalcule toujours les montants : ces fonctions servent à l'affichage instantané.
 */
export interface CalcLine {
  quantity: number;
  unitPrice: number;
  /** Remise de ligne en DH */
  discount: number;
  taxRate: number;
}

export interface LineResult {
  gross: number;
  lineDiscount: number;
  globalDiscount: number;
  total: number;
  tax: number;
  netExclTax: number;
}

export interface Totals {
  lines: LineResult[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
}

export function computeTotals(items: CalcLine[], globalDiscount: number, pricesIncludeTax: boolean): Totals {
  let subtotal = 0;
  let lineDiscounts = 0;
  const nets = items.map((it) => {
    const gross = round2(it.quantity * it.unitPrice);
    const d = Math.min(Math.max(it.discount || 0, 0), gross);
    subtotal += gross;
    lineDiscounts += d;
    return { gross, d: round2(d), net: round2(gross - d) };
  });
  const linesNet = nets.reduce((s, n) => s + n.net, 0);
  const global = round2(Math.min(Math.max(globalDiscount || 0, 0), linesNet));
  let lastNonZero = -1;
  nets.forEach((n, i) => {
    if (n.net > 0) lastNonZero = i;
  });
  let allocated = 0;
  const lines: LineResult[] = items.map((it, i) => {
    const { gross, d, net } = nets[i];
    let share = 0;
    if (linesNet > 0 && global !== 0) {
      share = i === lastNonZero ? round2(global - allocated) : round2((global * net) / linesNet);
    }
    allocated = round2(allocated + share);
    const base = round2(net - share);
    const rate = it.taxRate || 0;
    if (pricesIncludeTax) {
      const tax = round2((base * rate) / (100 + rate));
      return { gross, lineDiscount: d, globalDiscount: share, total: base, tax, netExclTax: round2(base - tax) };
    }
    const tax = round2((base * rate) / 100);
    return { gross, lineDiscount: d, globalDiscount: share, total: round2(base + tax), tax, netExclTax: base };
  });
  return {
    lines,
    subtotal: round2(subtotal),
    discountTotal: round2(lineDiscounts + global),
    taxTotal: round2(lines.reduce((s, l) => s + l.tax, 0)),
    total: round2(lines.reduce((s, l) => s + l.total, 0)),
  };
}

/** Bénéfice d'une ligne : montant HT encaissé − coût d'achat figé. */
export function lineProfit(netExclTax: number, quantity: number, unitCost: number) {
  return round2(netExclTax - quantity * unitCost);
}

/** Marge unitaire et taux de marge (sur prix de vente HT). */
export function margin(sellingPrice: number, purchasePrice: number, taxRate = 0, pricesIncludeTax = true) {
  const ht = pricesIncludeTax ? sellingPrice / (1 + taxRate / 100) : sellingPrice;
  const value = round2(ht - purchasePrice);
  const rate = ht > 0 ? round2((value / ht) * 100) : 0;
  return { value, rate, markup: purchasePrice > 0 ? round2((value / purchasePrice) * 100) : 0 };
}

/** Totaux d'achat : prix HT + TVA. */
export function purchaseTotals(items: { quantity: number; unitCost: number; taxRate: number }[]) {
  let sub = 0;
  let tax = 0;
  for (const it of items) {
    const ht = round2(it.quantity * it.unitCost);
    sub += ht;
    tax += round2((ht * (it.taxRate || 0)) / 100);
  }
  return { subtotal: round2(sub), tax: round2(tax), total: round2(sub + tax) };
}

/** Interprète une remise saisie : « 10 » (DH) ou « 10% » (pourcentage de la base). */
export function parseDiscount(input: string, base: number): number {
  const s = input.trim().replace(",", ".");
  if (!s) return 0;
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1));
    return Number.isFinite(p) ? round2((base * Math.min(Math.max(p, 0), 100)) / 100) : 0;
  }
  const v = Number(s);
  return Number.isFinite(v) ? round2(Math.min(Math.max(v, 0), base)) : 0;
}

export function changeDue(total: number, received: number) {
  return round2(Math.max(0, received - total));
}
