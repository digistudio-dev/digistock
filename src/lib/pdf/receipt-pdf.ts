import { jsPDF } from "jspdf";
import { unitShort } from "@/i18n";
import { imageToDataUrl } from "../files";
import { dateTime, money, qty } from "../format";
import type { ReceiptFormat, SaleDocument } from "../documents";
import { a4Footer, a4Header, BRAND, INK, MUTED, pdfText, table, toBase64 } from "./common";
import { legalLine, paymentSummary } from "./receipt-html";

async function thermalPdf(d: SaleDocument, width: 58 | 80) {
  const { sale, items, company, settings } = d;
  const small = width === 58;
  const margin = small ? 3 : 4;
  const inner = width - margin * 2;
  const fs = small ? 7 : 8;
  const lh = fs * 0.45;
  const logo = settings["receipt.show_logo"] ? await imageToDataUrl(company.logo) : null;
  // Estimation de la hauteur du ticket
  const height = 80 + items.length * lh * 3.2 + (logo ? 22 : 0) + (sale.credit_amount > 0 ? 6 : 0) + (sale.discount_total > 0 ? 4 : 0);
  const doc = new jsPDF({ unit: "mm", format: [width, height] });
  let y = margin + 2;
  const center = (t: string, bold = false, size = fs) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    const lines = doc.splitTextToSize(pdfText(t), inner) as string[];
    lines.forEach((l) => {
      doc.text(l, width / 2, y, { align: "center" });
      y += size * 0.42;
    });
  };
  const row = (l: string, r: string, bold = false, size = fs) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.text(pdfText(l), margin, y);
    doc.text(pdfText(r), width - margin, y, { align: "right" });
    y += size * 0.45;
  };
  const sep = () => {
    y += 0.6;
    doc.setLineDashPattern([0.8, 0.8], 0).setDrawColor(0).setLineWidth(0.15).line(margin, y, width - margin, y);
    doc.setLineDashPattern([], 0);
    y += lh + 0.8;
  };
  doc.setTextColor(0, 0, 0);
  if (logo) {
    try {
      const p = doc.getImageProperties(logo);
      const h = 14;
      const w = Math.min(inner * 0.6, (p.width / p.height) * h);
      doc.addImage(logo, p.fileType, (width - w) / 2, y - 1, w, h);
      y += h + 2;
    } catch {
      /* ignoré */
    }
  }
  center(company.name, true, fs + 3);
  if (settings["receipt.header"]) center(settings["receipt.header"]);
  if (company.address || company.city) center([company.address, company.city].filter(Boolean).join(", "));
  if (company.phone) center(`Tél : ${company.phone}`);
  const legal = legalLine(d);
  if (legal) center(legal, false, fs - 1);
  sep();
  row("Ticket", sale.number, true);
  row("Date", dateTime(sale.created_at));
  if (sale.user_name) row("Caissier", sale.user_name);
  if (d.customer) row("Client", d.customer.name);
  if (sale.status === "cancelled") {
    sep();
    center("*** VENTE ANNULÉE ***", true);
  }
  sep();
  for (const i of items) {
    doc.setFont("helvetica", "bold").setFontSize(fs);
    (doc.splitTextToSize(pdfText(i.product_name), inner) as string[]).forEach((l) => {
      doc.text(l, margin, y);
      y += lh;
    });
    row(`${qty(i.quantity)} ${unitShort(i.unit ?? "piece")} x ${money(i.unit_price, false)}`, money(i.total, false));
    if (i.discount > 0) row("Remise", "-" + money(i.discount, false));
  }
  sep();
  row("Sous-total", money(sale.subtotal));
  if (sale.discount_total > 0) row("Remise", "-" + money(sale.discount_total));
  if (sale.tax_total > 0) row(settings["sales.prices_include_tax"] ? "TVA (incluse)" : "TVA", money(sale.tax_total));
  y += 0.8;
  row("TOTAL", money(sale.total), true, fs + 3);
  sep();
  row("Paiement", paymentSummary(d));
  if (sale.payment_method === "cash" && sale.change_amount > 0) {
    row("Reçu", money(sale.received_amount));
    row("Rendu", money(sale.change_amount), true);
  }
  if (sale.credit_amount > 0) row("Reste à payer", money(sale.credit_amount), true);
  sep();
  center(settings["receipt.footer"] || "Merci pour votre confiance.", true);
  y += 1;
  center("DigiStock par DigiStudio", false, fs - 1.5);
  return doc;
}

async function a4Pdf(d: SaleDocument) {
  const { sale, items, company, settings, customer } = d;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  let y = await a4Header(doc, company, "FACTURE", [`N° ${sale.number.replace(/^V-/, "FAC-")}`, `Date : ${dateTime(sale.created_at)}`, `Vente : ${sale.number}`]);
  // Blocs client / règlement
  const boxW = (W - 28 - 6) / 2;
  const box = (x: string | number, title: string, lines: string[]) => {
    const bx = Number(x);
    doc.setDrawColor(229, 231, 235).setLineWidth(0.25).roundedRect(bx, y, boxW, 24, 2, 2);
    doc.setFontSize(7).setTextColor(...MUTED).setFont("helvetica", "bold").text(title.toUpperCase(), bx + 4, y + 5.5);
    doc.setFontSize(9).setTextColor(...INK);
    lines.slice(0, 4).forEach((l, i) => doc.setFont("helvetica", i === 0 ? "bold" : "normal").text(pdfText(l), bx + 4, y + 11 + i * 4.2));
  };
  box(
    14,
    "Client",
    customer ? [customer.name, [customer.address, customer.city].filter(Boolean).join(", "), customer.phone ?? "", customer.ice ? `ICE : ${customer.ice}` : ""].filter(Boolean) : ["Client de passage"],
  );
  box(14 + boxW + 6, "Règlement", [paymentSummary(d), sale.credit_amount > 0 ? `Reste à payer : ${money(sale.credit_amount)}` : "Payé", settings["invoice.payment_terms"] ?? ""].filter(Boolean));
  y += 31;
  if (sale.status === "cancelled") {
    doc.setTextColor(220, 38, 38).setFont("helvetica", "bold").setFontSize(11).text("VENTE ANNULÉE", 14, y);
    y += 6;
  }
  y = table(
    doc,
    y,
    ["#", "Désignation", "Qté", "P.U.", "Remise", "TVA", "Total"],
    items.map((i, n) => [String(n + 1), i.product_name, `${qty(i.quantity)} ${unitShort(i.unit ?? "piece")}`, money(i.unit_price), i.discount > 0 ? "-" + money(i.discount) : "-", `${i.tax_rate} %`, money(i.total)]),
    { rightCols: [2, 3, 4, 5, 6] },
  );
  // Totaux
  y += 6;
  const tx = W - 14 - 72;
  const line = (l: string, r: string, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(bold ? 11 : 9).setTextColor(...INK);
    doc.text(pdfText(l), tx, y);
    doc.text(pdfText(r), W - 14, y, { align: "right" });
    y += bold ? 7 : 5;
  };
  line("Sous-total", money(sale.subtotal));
  if (sale.discount_total > 0) line("Remise", "-" + money(sale.discount_total));
  line("Total HT", money(sale.total - sale.tax_total));
  line("TVA", money(sale.tax_total));
  doc.setDrawColor(...INK).setLineWidth(0.4).line(tx, y - 2.5, W - 14, y - 2.5);
  y += 2;
  line("Total TTC", money(sale.total), true);
  doc.setTextColor(...BRAND).setFontSize(9).setFont("helvetica", "bold").text(pdfText(settings["receipt.footer"] || "Merci pour votre confiance."), 14, y + 8);
  if (settings["invoice.notes"]) doc.setTextColor(...MUTED).setFont("helvetica", "normal").setFontSize(8).text(pdfText(settings["invoice.notes"]), 14, y + 13);
  a4Footer(doc, company, legalLine(d));
  return doc;
}

export async function receiptPdf(d: SaleDocument, format: ReceiptFormat) {
  const doc = format === "a4" ? await a4Pdf(d) : await thermalPdf(d, format === "ticket_58" ? 58 : 80);
  return { base64: toBase64(doc), filename: `${format === "a4" ? d.sale.number.replace(/^V-/, "FAC-") : d.sale.number}.pdf` };
}
