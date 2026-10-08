import Papa from "papaparse";
import { parseNumber } from "./utils";

/** Export CSV compatible Excel (BOM UTF-8, séparateur « ; »). */
export function toCsv(rows: Record<string, unknown>[], columns: { key: string; label: string }[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => esc(c.label)).join(";");
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(";")).join("\r\n");
  return "﻿" + head + "\r\n" + body;
}

export function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim().toLowerCase(),
  });
  return res.data;
}

export const PRODUCT_CSV_COLUMNS = [
  "name",
  "sku",
  "barcode",
  "category",
  "purchase_price",
  "selling_price",
  "quantity",
  "minimum_stock",
  "supplier",
] as const;

export const PRODUCT_CSV_SAMPLE =
  "﻿name;sku;barcode;category;purchase_price;selling_price;quantity;minimum_stock;supplier\r\n" +
  "Coca Cola 1L;BOI-001;6111234567890;Boissons;7,50;10,00;48;12;ABC Distribution\r\n" +
  "Thé Sultan 200g;EPI-014;;Épicerie;16;22;30;10;\r\n";

export interface ProductImportRow {
  line: number;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  purchase_price: number;
  selling_price: number;
  quantity: number;
  minimum_stock: number;
  supplier: string | null;
}

export interface ImportIssue {
  line: number;
  message: string;
}

/**
 * Valide les lignes d'un import produits.
 * @param existingBarcodes codes-barres déjà présents en base
 */
export function validateProductRows(raw: Record<string, string>[], existingBarcodes: Set<string>, existingSkus = new Set<string>()) {
  const valid: ProductImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seenBarcodes = new Set<string>();
  const seenSkus = new Set<string>();
  raw.forEach((r, i) => {
    const line = i + 2; // ligne 1 = en-têtes
    const errs: string[] = [];
    const name = (r.name ?? r.nom ?? "").trim();
    if (!name) errs.push("nom manquant");
    const num = (key: string, required: boolean) => {
      const v = (r[key] ?? "").trim();
      if (!v) return required ? NaN : 0;
      return parseNumber(v);
    };
    const purchase = num("purchase_price", false);
    const selling = num("selling_price", true);
    const quantity = num("quantity", false);
    const minimum = num("minimum_stock", false);
    if (!Number.isFinite(selling) || selling < 0) errs.push("prix de vente invalide");
    if (!Number.isFinite(purchase) || purchase < 0) errs.push("prix d'achat invalide");
    if (!Number.isFinite(quantity) || quantity < 0) errs.push("quantité invalide");
    if (!Number.isFinite(minimum) || minimum < 0) errs.push("stock minimum invalide");
    const barcode = (r.barcode ?? "").trim() || null;
    if (barcode) {
      if (!/^[\x20-\x7E]{1,64}$/.test(barcode)) errs.push("code-barres invalide");
      else if (existingBarcodes.has(barcode)) errs.push("code-barres déjà utilisé");
      else if (seenBarcodes.has(barcode)) errs.push("code-barres en double dans le fichier");
    }
    const sku = (r.sku ?? "").trim() || null;
    if (sku) {
      if (existingSkus.has(sku)) errs.push("SKU déjà utilisé");
      else if (seenSkus.has(sku)) errs.push("SKU en double dans le fichier");
    }
    if (errs.length) {
      issues.push({ line, message: errs.join(", ") });
      return;
    }
    if (barcode) seenBarcodes.add(barcode);
    if (sku) seenSkus.add(sku);
    valid.push({
      line,
      name,
      sku,
      barcode,
      category: (r.category ?? "").trim() || null,
      purchase_price: purchase,
      selling_price: selling,
      quantity,
      minimum_stock: minimum,
      supplier: (r.supplier ?? "").trim() || null,
    });
  });
  return { valid, issues };
}
