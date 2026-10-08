import { paymentLabel, unitShort } from "@/i18n";
import { imageSrc } from "../files";
import { dateTime, money, qty } from "../format";
import { escapeHtml as e } from "../print";
import type { ReceiptFormat, SaleDocument } from "../documents";

/** Lignes d'identification légale selon les paramètres du ticket. */
export function legalLine(doc: Pick<SaleDocument, "company" | "settings">) {
  const c = doc.company;
  const s = doc.settings;
  return [s["receipt.show_ice"] && c.ice ? `ICE : ${c.ice}` : null, s["receipt.show_if"] && c.if_number ? `IF : ${c.if_number}` : null, s["receipt.show_rc"] && c.rc ? `RC : ${c.rc}` : null]
    .filter(Boolean)
    .join(" · ");
}

export function paymentSummary(doc: SaleDocument) {
  return doc.sale.payment_method === "credit"
    ? doc.payments.map((p) => `${paymentLabel(p.method)} ${money(p.amount)}`).join(" + ")
    : paymentLabel(doc.sale.payment_method);
}

function thermal(doc: SaleDocument, width: 58 | 80) {
  const { sale, items, company, settings } = doc;
  const logo = settings["receipt.show_logo"] ? imageSrc(company.logo) : null;
  const small = width === 58;
  const legal = legalLine(doc);
  const rows = items
    .map(
      (i) => `<tr><td colspan="3" class="name">${e(i.product_name)}</td></tr>
      <tr class="sub"><td>${qty(i.quantity)} ${e(unitShort(i.unit ?? "piece"))} × ${money(i.unit_price, false)}</td><td></td><td class="r">${money(i.total, false)}</td></tr>
      ${i.discount > 0 ? `<tr class="sub"><td colspan="2">Remise</td><td class="r">-${money(i.discount, false)}</td></tr>` : ""}`,
    )
    .join("");
  return `
  <style>
    @page { size: ${width}mm auto; margin: 0; }
    .t { width: ${width - (small ? 4 : 6)}mm; margin: 0 auto; padding: 3mm 0 6mm; font-family: 'Segoe UI', Arial, sans-serif; font-size: ${small ? 9 : 10.5}px; color: #000; line-height: 1.35; }
    .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
    .logo { max-width: 60%; max-height: 18mm; margin: 0 auto 2mm; display: block; }
    .title { font-size: ${small ? 12 : 14}px; font-weight: 800; }
    hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 0.3mm 0; vertical-align: top; }
    .name { font-weight: 600; padding-top: 1mm; }
    .sub td { color: #222; }
    .tot td { font-size: ${small ? 11 : 13}px; font-weight: 800; padding-top: 1mm; }
    .muted { color: #333; font-size: ${small ? 8 : 9}px; }
  </style>
  <div class="t">
    ${logo ? `<img class="logo" src="${logo}" />` : ""}
    <div class="c title">${e(company.name)}</div>
    ${settings["receipt.header"] ? `<div class="c">${e(settings["receipt.header"])}</div>` : ""}
    ${company.address || company.city ? `<div class="c">${e([company.address, company.city].filter(Boolean).join(", "))}</div>` : ""}
    ${company.phone ? `<div class="c">Tél : ${e(company.phone)}</div>` : ""}
    ${legal ? `<div class="c muted">${e(legal)}</div>` : ""}
    <hr />
    <table>
      <tr><td>Ticket</td><td class="r b">${e(sale.number)}</td></tr>
      <tr><td>Date</td><td class="r">${dateTime(sale.created_at)}</td></tr>
      ${sale.user_name ? `<tr><td>Caissier</td><td class="r">${e(sale.user_name)}</td></tr>` : ""}
      ${doc.customer ? `<tr><td>Client</td><td class="r">${e(doc.customer.name)}</td></tr>` : ""}
    </table>
    ${sale.status === "cancelled" ? `<hr /><div class="c b">*** VENTE ANNULÉE ***</div>` : ""}
    <hr />
    <table>${rows}</table>
    <hr />
    <table>
      <tr><td>Sous-total</td><td class="r">${money(sale.subtotal)}</td></tr>
      ${sale.discount_total > 0 ? `<tr><td>Remise</td><td class="r">-${money(sale.discount_total)}</td></tr>` : ""}
      ${sale.tax_total > 0 ? `<tr><td>TVA${settings["sales.prices_include_tax"] ? " (incluse)" : ""}</td><td class="r">${money(sale.tax_total)}</td></tr>` : ""}
      <tr class="tot"><td>TOTAL</td><td class="r">${money(sale.total)}</td></tr>
    </table>
    <hr />
    <table>
      <tr><td>Paiement</td><td class="r">${e(paymentSummary(doc))}</td></tr>
      ${sale.payment_method === "cash" && sale.change_amount > 0 ? `<tr><td>Reçu</td><td class="r">${money(sale.received_amount)}</td></tr><tr><td>Rendu</td><td class="r b">${money(sale.change_amount)}</td></tr>` : ""}
      ${sale.credit_amount > 0 ? `<tr><td>Reste à payer</td><td class="r b">${money(sale.credit_amount)}</td></tr>` : ""}
    </table>
    <hr />
    <div class="c b">${e(settings["receipt.footer"] || "Merci pour votre confiance.")}</div>
    <div class="c muted" style="margin-top:1.5mm">DigiStock par DigiStudio</div>
  </div>`;
}

function a4(doc: SaleDocument, title = "FACTURE") {
  const { sale, items, company, settings, customer } = doc;
  const logo = settings["receipt.show_logo"] ? imageSrc(company.logo) : null;
  const legal = legalLine(doc);
  const rows = items
    .map(
      (i, n) => `<tr>
        <td class="muted">${n + 1}</td>
        <td><div class="b">${e(i.product_name)}</div>${i.barcode ? `<div class="muted">${e(i.barcode)}</div>` : ""}</td>
        <td class="r">${qty(i.quantity)} ${e(unitShort(i.unit ?? "piece"))}</td>
        <td class="r">${money(i.unit_price)}</td>
        <td class="r">${i.discount > 0 ? "-" + money(i.discount) : "—"}</td>
        <td class="r">${i.tax_rate} %</td>
        <td class="r b">${money(i.total)}</td>
      </tr>`,
    )
    .join("");
  return `
  <style>
    @page { size: A4; margin: 14mm 14mm 16mm; }
    .inv { font-size: 11px; color: #111827; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #2563EB; }
    .logo { max-height: 56px; max-width: 160px; margin-bottom: 8px; }
    .cname { font-size: 18px; font-weight: 800; }
    .muted { color: #6b7280; font-size: 10px; }
    .doc { text-align: right; }
    .doc h1 { margin: 0 0 6px; font-size: 26px; letter-spacing: 0.04em; color: #2563EB; }
    .grid { display: flex; gap: 24px; margin: 20px 0; }
    .box { flex: 1; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px; }
    .box h4 { margin: 0 0 6px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7280; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; background: #f5f6fa; padding: 8px; }
    td { padding: 8px; border-bottom: 1px solid #eef0f4; vertical-align: top; }
    .r { text-align: right; } .b { font-weight: 700; }
    .totals { width: 280px; margin-left: auto; margin-top: 14px; }
    .totals td { border: 0; padding: 4px 8px; }
    .grand td { font-size: 15px; font-weight: 800; border-top: 2px solid #111827; padding-top: 8px; }
    .foot { margin-top: 36px; padding-top: 12px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 9.5px; }
    .stamp { display: inline-block; margin-top: 8px; padding: 4px 10px; border: 2px solid #dc2626; color: #dc2626; font-weight: 800; border-radius: 6px; }
  </style>
  <div class="inv">
    <div class="head">
      <div>
        ${logo ? `<img class="logo" src="${logo}" />` : ""}
        <div class="cname">${e(company.name)}</div>
        <div>${e([company.address, company.city].filter(Boolean).join(", "))}</div>
        <div>${e([company.phone ? "Tél : " + company.phone : null, company.email].filter(Boolean).join(" · "))}</div>
      </div>
      <div class="doc">
        <h1>${title}</h1>
        <div><span class="muted">N°</span> <b>${e(sale.number.replace(/^V-/, "FAC-"))}</b></div>
        <div><span class="muted">Date</span> ${dateTime(sale.created_at)}</div>
        <div><span class="muted">Vente</span> ${e(sale.number)}</div>
        ${sale.status === "cancelled" ? `<div class="stamp">ANNULÉE</div>` : ""}
      </div>
    </div>
    <div class="grid">
      <div class="box"><h4>Client</h4>${
        customer
          ? `<div class="b">${e(customer.name)}</div><div>${e([customer.address, customer.city].filter(Boolean).join(", "))}</div><div>${e(customer.phone ?? "")}</div>${customer.ice ? `<div>ICE : ${e(customer.ice)}</div>` : ""}`
          : `<div>Client de passage</div>`
      }</div>
      <div class="box"><h4>Règlement</h4><div class="b">${e(paymentSummary(doc))}</div>${sale.credit_amount > 0 ? `<div>Reste à payer : <b>${money(sale.credit_amount)}</b></div>` : `<div>Payé</div>`}<div class="muted">${e(settings["invoice.payment_terms"] ?? "")}</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Désignation</th><th class="r">Qté</th><th class="r">P.U.</th><th class="r">Remise</th><th class="r">TVA</th><th class="r">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals">
      <tr><td>Sous-total</td><td class="r">${money(sale.subtotal)}</td></tr>
      ${sale.discount_total > 0 ? `<tr><td>Remise</td><td class="r">-${money(sale.discount_total)}</td></tr>` : ""}
      <tr><td>Total HT</td><td class="r">${money(sale.total - sale.tax_total)}</td></tr>
      <tr><td>TVA</td><td class="r">${money(sale.tax_total)}</td></tr>
      <tr class="grand"><td>Total TTC</td><td class="r">${money(sale.total)}</td></tr>
    </table>
    ${settings["invoice.notes"] ? `<p class="muted" style="margin-top:18px">${e(settings["invoice.notes"])}</p>` : ""}
    <div class="foot">
      <div><b>${e(settings["receipt.footer"] || "Merci pour votre confiance.")}</b></div>
      ${legal ? `<div>${e(company.name)} · ${e(legal)}</div>` : ""}
      <div style="margin-top:4px">DigiStock par DigiStudio</div>
    </div>
  </div>`;
}

export function receiptHtml(doc: SaleDocument, format: ReceiptFormat) {
  if (format === "a4") return { html: a4(doc), pageCss: "" };
  const w = format === "ticket_58" ? 58 : 80;
  return { html: thermal(doc, w), pageCss: `@page { size: ${w}mm auto; margin: 0; }` };
}
