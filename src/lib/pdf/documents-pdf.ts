import { jsPDF } from "jspdf";
import { paymentLabel } from "@/i18n";
import { one, select } from "../db";
import { date, dateTime, money, qty } from "../format";
import type { Company, Customer, Purchase, PurchaseItem, Supplier } from "@/types";
import { a4Footer, a4Header, INK, MUTED, pdfText, table, toBase64 } from "./common";

async function company() {
  return (await one<Company>("SELECT * FROM companies WHERE id = 1")) ?? { name: "DigiStock" };
}

function legal(c: Company) {
  return [c.ice && `ICE : ${c.ice}`, c.if_number && `IF : ${c.if_number}`, c.rc && `RC : ${c.rc}`].filter(Boolean).join(" · ");
}

function partyBox(doc: jsPDF, y: number, title: string, lines: string[]) {
  doc.setDrawColor(229, 231, 235).setLineWidth(0.25).roundedRect(14, y, 90, 26, 2, 2);
  doc.setFontSize(7).setTextColor(...MUTED).setFont("helvetica", "bold").text(title.toUpperCase(), 18, y + 5.5);
  doc.setFontSize(9).setTextColor(...INK);
  lines.filter(Boolean).slice(0, 4).forEach((l, i) => doc.setFont("helvetica", i === 0 ? "bold" : "normal").text(pdfText(l), 18, y + 11 + i * 4.2));
  return y + 33;
}

/** Bon de commande ou bon de réception fournisseur. */
export async function purchasePdf(id: number) {
  const p = await one<Purchase>("SELECT * FROM purchases WHERE id = ?", [id]);
  if (!p) throw new Error("Achat introuvable.");
  const [items, supplier, c] = await Promise.all([
    select<PurchaseItem>("SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id", [id]),
    one<Supplier>("SELECT * FROM suppliers WHERE id = ?", [p.supplier_id]),
    company(),
  ]);
  const title = p.status === "ordered" ? "BON DE COMMANDE" : "BON DE RÉCEPTION";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = await a4Header(doc, c, title, [`N° ${p.number}`, `Date : ${date(p.purchase_date)}`, p.reference ? `Réf. fournisseur : ${p.reference}` : ""].filter(Boolean));
  y = partyBox(doc, y, "Fournisseur", [supplier?.company_name || supplier?.name || "", supplier?.address ?? "", [supplier?.city, supplier?.phone].filter(Boolean).join(" · "), supplier?.ice ? `ICE : ${supplier.ice}` : ""]);
  y = table(
    doc,
    y,
    ["#", "Désignation", "Qté", "P.U. HT", "TVA", "Total TTC", ...(items.some((i) => i.batch_number || i.expiration_date) ? ["Lot / Exp."] : [])],
    items.map((i, n) => [
      String(n + 1),
      i.product_name,
      qty(i.quantity),
      money(i.unit_cost),
      `${i.tax_rate} %`,
      money(i.total),
      ...(items.some((x) => x.batch_number || x.expiration_date) ? [[i.batch_number, i.expiration_date && date(i.expiration_date)].filter(Boolean).join(" / ")] : []),
    ]),
    { rightCols: [2, 3, 4, 5] },
  );
  const W = doc.internal.pageSize.getWidth();
  y += 7;
  const line = (l: string, r: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 11 : 9).setTextColor(...INK);
    doc.text(pdfText(l), W - 86, y);
    doc.text(pdfText(r), W - 14, y, { align: "right" });
    y += bold ? 7 : 5;
  };
  line("Total HT", money(p.subtotal));
  line("TVA", money(p.tax_total));
  line("Total TTC", money(p.total), true);
  if (p.paid_amount > 0) {
    line("Déjà payé", money(p.paid_amount));
    line("Reste à payer", money(Math.max(0, p.total - p.paid_amount)), true);
  }
  if (p.note) doc.setFontSize(8.5).setTextColor(...MUTED).setFont("helvetica", "normal").text(pdfText(`Notes : ${p.note}`), 14, y + 6);
  a4Footer(doc, c, legal(c));
  return { base64: toBase64(doc), filename: `${p.number}.pdf` };
}

/** Reçu de paiement client (règlement de crédit). */
export async function customerPaymentPdf(transactionId: number) {
  const t = await one<{ id: number; customer_id: number; amount: number; balance_after: number; number: string; method: string; note: string | null; created_at: string; user_name: string | null }>(
    "SELECT t.*, u.name AS user_name FROM customer_credit_transactions t LEFT JOIN users u ON u.id = t.user_id WHERE t.id = ?",
    [transactionId],
  );
  if (!t) throw new Error("Paiement introuvable.");
  const [customer, c] = await Promise.all([one<Customer>("SELECT * FROM customers WHERE id = ?", [t.customer_id]), company()]);
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const W = doc.internal.pageSize.getWidth();
  let y = await a4Header(doc, c, "REÇU DE PAIEMENT", [`N° ${t.number}`, dateTime(t.created_at)]);
  y += 4;
  doc.setFontSize(10).setTextColor(...INK).setFont("helvetica", "normal");
  doc.text(pdfText(`Reçu de : ${customer?.name ?? ""}`), 14, y);
  y += 10;
  doc.setFillColor(245, 246, 250).roundedRect(14, y, W - 28, 22, 2, 2, "F");
  doc.setFontSize(8).setTextColor(...MUTED).text("MONTANT REÇU", 20, y + 7);
  doc.setFontSize(18).setTextColor(...INK).setFont("helvetica", "bold").text(pdfText(money(Math.abs(t.amount))), 20, y + 16);
  doc.setFontSize(9).setFont("helvetica", "normal").text(pdfText(paymentLabel(t.method)), W - 20, y + 16, { align: "right" });
  y += 32;
  doc.setFontSize(9.5).text(pdfText(`Solde restant dû : ${money(t.balance_after)}`), 14, y);
  if (t.note) doc.setTextColor(...MUTED).text(pdfText(t.note), 14, y + 6);
  if (t.user_name) doc.setTextColor(...MUTED).setFontSize(8.5).text(pdfText(`Encaissé par ${t.user_name}`), 14, y + 12);
  doc.setTextColor(...INK).setFont("helvetica", "bold").text(pdfText("Merci pour votre confiance."), 14, y + 22);
  a4Footer(doc, c, legal(c));
  return { base64: toBase64(doc), filename: `${t.number}.pdf` };
}

/** Relevé de compte client (historique du crédit). */
export async function customerStatementPdf(customerId: number) {
  const [customer, c, rows] = await Promise.all([
    one<Customer>("SELECT * FROM customers WHERE id = ?", [customerId]),
    company(),
    select<{ type: string; amount: number; balance_after: number; number: string | null; note: string | null; created_at: string }>(
      "SELECT * FROM customer_credit_transactions WHERE customer_id = ? ORDER BY id",
      [customerId],
    ),
  ]);
  if (!customer) throw new Error("Client introuvable.");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = await a4Header(doc, c, "RELEVÉ DE COMPTE", [customer.name, `Au ${date(new Date())}`]);
  y = partyBox(doc, y, "Client", [customer.name, customer.address ?? "", [customer.city, customer.phone].filter(Boolean).join(" · ")]);
  const label: Record<string, string> = { SALE: "Vente à crédit", PAYMENT: "Paiement", SALE_CANCELLED: "Annulation de vente", ADJUSTMENT: "Ajustement" };
  table(
    doc,
    y,
    ["Date", "Opération", "Référence", "Débit", "Crédit", "Solde"],
    rows.map((r) => [dateTime(r.created_at), label[r.type] ?? r.type, r.number ?? r.note ?? "", r.amount > 0 ? money(r.amount) : "", r.amount < 0 ? money(-r.amount) : "", money(r.balance_after)]),
    { rightCols: [3, 4, 5], foot: [["", "", "Solde dû", "", "", money(customer.balance)]] },
  );
  a4Footer(doc, c, legal(c));
  return { base64: toBase64(doc), filename: `releve-${customer.name.replace(/[^\w-]+/g, "-").toLowerCase()}.pdf` };
}
