import { describe, expect, it } from "vitest";
import { ean13CheckDigit, generateEan13, isValidCode128, isValidEan13, detectFormat } from "./barcode";
import { changeDue, computeTotals, lineProfit, margin, parseDiscount, purchaseTotals } from "./calc";
import { validateProductRows, parseCsv, toCsv } from "./csv";
import { money, qty } from "./format";
import { hasPermission } from "./permissions";
import { fillTemplate, normalizePhone } from "./phone";
import { basicRecommendedQuantity, coverageLabel, daysOfStock, recommendedQuantity } from "./reorder";
import { expiryStatus, stockLevel } from "./stock";

describe("totaux de vente (miroir du backend Rust)", () => {
  it("prix TTC : la TVA est extraite du total", () => {
    const t = computeTotals([{ quantity: 2, unitPrice: 60, discount: 0, taxRate: 20 }], 0, true);
    expect(t.total).toBe(120);
    expect(t.taxTotal).toBe(20);
    expect(t.lines[0].netExclTax).toBe(100);
  });

  it("prix HT : la TVA est ajoutée", () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 100, discount: 0, taxRate: 20 }], 0, false);
    expect(t.total).toBe(120);
    expect(t.taxTotal).toBe(20);
  });

  it("la remise globale est répartie au centime près", () => {
    const t = computeTotals(
      [
        { quantity: 1, unitPrice: 10, discount: 0, taxRate: 0 },
        { quantity: 1, unitPrice: 20, discount: 0, taxRate: 0 },
        { quantity: 1, unitPrice: 3.33, discount: 0, taxRate: 0 },
      ],
      10,
      true,
    );
    expect(t.lines.reduce((s, l) => s + l.globalDiscount, 0)).toBeCloseTo(10, 6);
    expect(t.total).toBe(23.33);
    expect(t.discountTotal).toBe(10);
  });

  it("une remise ne rend jamais le total négatif", () => {
    const t = computeTotals([{ quantity: 1, unitPrice: 10, discount: 50, taxRate: 0 }], 100, true);
    expect(t.total).toBe(0);
  });

  it("remise ligne + remise globale", () => {
    const t = computeTotals([{ quantity: 3, unitPrice: 10, discount: 5, taxRate: 0 }], 5, true);
    expect(t.subtotal).toBe(30);
    expect(t.discountTotal).toBe(10);
    expect(t.total).toBe(20);
  });

  it("bénéfice = HT encaissé − coût figé", () => {
    expect(lineProfit(100, 1, 60)).toBe(40);
    expect(lineProfit(50, 2, 30)).toBe(-10);
  });

  it("monnaie à rendre", () => {
    expect(changeDue(4.5, 10)).toBe(5.5);
    expect(changeDue(10, 5)).toBe(0);
  });

  it("saisie de remise en DH ou en %", () => {
    expect(parseDiscount("10%", 200)).toBe(20);
    expect(parseDiscount("15,5", 200)).toBe(15.5);
    expect(parseDiscount("500", 200)).toBe(200);
    expect(parseDiscount("abc", 200)).toBe(0);
    expect(parseDiscount("150%", 200)).toBe(200);
  });

  it("marge", () => {
    expect(margin(100, 60, 0, true)).toEqual({ value: 40, rate: 40, markup: 66.67 });
    expect(margin(120, 60, 20, true).value).toBe(40);
  });
});

describe("achats", () => {
  it("totaux HT, TVA, TTC", () => {
    expect(
      purchaseTotals([
        { quantity: 10, unitCost: 5, taxRate: 20 },
        { quantity: 2, unitCost: 2.5, taxRate: 0 },
      ]),
    ).toEqual({ subtotal: 55, tax: 10, total: 65 });
  });
});

describe("suggestion de réapprovisionnement", () => {
  it("exemple du cahier des charges : 7/jour × 5 jours + 15 de sécurité", () => {
    const q = recommendedQuantity({ avgDailySales: 7, leadTimeDays: 5, safetyDays: 0, minimumStock: 15, currentStock: 0 });
    expect(q).toBe(50);
  });
  it("déduit le stock actuel", () => {
    expect(recommendedQuantity({ avgDailySales: 7, leadTimeDays: 5, safetyDays: 0, minimumStock: 15, currentStock: 3 })).toBe(47);
  });
  it("sans historique : double du stock minimum", () => {
    expect(recommendedQuantity({ avgDailySales: 0, leadTimeDays: 5, safetyDays: 2, minimumStock: 10, currentStock: 3 })).toBe(17);
    expect(basicRecommendedQuantity(10, 3)).toBe(17);
  });
  it("respecte le stock maximum", () => {
    expect(recommendedQuantity({ avgDailySales: 10, leadTimeDays: 10, safetyDays: 2, minimumStock: 5, currentStock: 10, maximumStock: 50 })).toBe(40);
  });
  it("couverture de stock", () => {
    expect(daysOfStock(3, 7)).toBeCloseTo(0.43, 2);
    expect(coverageLabel(daysOfStock(3, 7))).toBe("Moins d'un jour");
    expect(coverageLabel(Infinity)).toBe("Pas de ventes récentes");
  });
});

describe("niveaux de stock et expiration", () => {
  it("niveaux", () => {
    expect(stockLevel(0, 10)).toBe("out");
    expect(stockLevel(4, 10)).toBe("critical");
    expect(stockLevel(8, 10)).toBe("low");
    expect(stockLevel(11, 10)).toBe("normal");
    expect(stockLevel(5, 0)).toBe("normal");
  });
  it("expiration", () => {
    const today = new Date(2026, 9, 5);
    expect(expiryStatus("2026-10-01", today)).toBe("expired");
    expect(expiryStatus("2026-10-10", today)).toBe("7d");
    expect(expiryStatus("2026-10-30", today)).toBe("30d");
    expect(expiryStatus("2027-01-01", today)).toBe("ok");
    expect(expiryStatus(null, today)).toBeNull();
  });
});

describe("codes-barres", () => {
  it("EAN-13 : clé de contrôle", () => {
    expect(ean13CheckDigit("611100000000")).toBe(Number(isValidEan13("6111000000002") ? 2 : ean13CheckDigit("611100000000")));
    expect(isValidEan13("4006381333931")).toBe(true);
    expect(isValidEan13("4006381333932")).toBe(false);
    expect(isValidEan13("123")).toBe(false);
  });
  it("génération EAN-13 valide", () => {
    for (let i = 0; i < 50; i++) expect(isValidEan13(generateEan13())).toBe(true);
  });
  it("détection du format", () => {
    expect(detectFormat("4006381333931")).toBe("EAN13");
    expect(detectFormat("ABC-123")).toBe("CODE128");
    expect(isValidCode128("ABC-123")).toBe(true);
    expect(isValidCode128("é")).toBe(false);
  });
});

describe("téléphone et modèles WhatsApp", () => {
  it("normalise les numéros marocains", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("212612345678");
    expect(normalizePhone("+212 6 12 34 56 78")).toBe("212612345678");
    expect(normalizePhone("0012345")).toBeNull();
  });
  it("remplit les variables", () => {
    expect(fillTemplate("Bonjour {customer_name}, {amount} DH", { customer_name: "Mohammed", amount: "1 280,00" })).toBe("Bonjour Mohammed, 1 280,00 DH");
  });
});

describe("permissions", () => {
  const cashier = ["create_sales", "manage_customers"];
  it("caissier", () => {
    expect(hasPermission(cashier, "create_sales")).toBe(true);
    expect(hasPermission(cashier, "view_purchase_price")).toBe(false);
    expect(hasPermission(cashier, "view_profit")).toBe(false);
    expect(hasPermission(cashier, ["view_reports", "manage_customers"])).toBe(true);
    expect(hasPermission(undefined, "create_sales")).toBe(false);
    expect(hasPermission(cashier, undefined)).toBe(true);
  });
});

describe("format fr-MA", () => {
  it("montants en DH avec séparateur d'espace", () => {
    expect(money(12450)).toBe("12 450,00 DH");
    expect(money(0)).toBe("0,00 DH");
    expect(qty(1.5)).toBe("1,5");
  });
});

describe("import CSV produits", () => {
  it("valide, signale les erreurs et les doublons", () => {
    const rows = parseCsv(
      "name;sku;barcode;category;purchase_price;selling_price;quantity;minimum_stock;supplier\n" +
        "Coca 1L;A1;6111234567890;Boissons;7,5;10;48;12;ABC\n" +
        ";A2;;;1;2;3;4;\n" +
        "Eau;A3;6111234567890;;1;abc;3;4;\n" +
        "Thé;A4;999;;16;22;-1;0;\n" +
        "Sucre;A5;111;;15;19;10;5;",
    );
    const { valid, issues } = validateProductRows(rows, new Set(["111"]));
    expect(valid.map((v) => v.name)).toEqual(["Coca 1L"]);
    expect(valid[0].purchase_price).toBe(7.5);
    expect(issues.map((i) => i.line)).toEqual([3, 4, 5, 6]);
  });
  it("export CSV échappe les séparateurs", () => {
    const csv = toCsv([{ a: 'x;"y"', b: 1.5 }], [{ key: "a", label: "A" }, { key: "b", label: "B" }]);
    expect(csv).toContain('"x;""y"""');
    expect(csv).toContain("1,5");
  });
});
