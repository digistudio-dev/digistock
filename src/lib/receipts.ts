import { toast } from "sonner";
import { loadSaleDocument, type ReceiptFormat } from "./documents";
import { savePdf } from "./files";
import { receiptHtml } from "./pdf/receipt-html";
import { receiptPdf } from "./pdf/receipt-pdf";
import { printHtml } from "./print";
import { toAppError } from "./tauri";
import { useApp } from "@/stores/app";

const defaultFormat = () => (useApp.getState().settings["receipt.format"] as ReceiptFormat) ?? "ticket_80";

export async function printSaleReceipt(saleId: number, format: ReceiptFormat = defaultFormat()) {
  try {
    const doc = await loadSaleDocument(saleId);
    const { html, pageCss } = receiptHtml(doc, format);
    await printHtml(html, { pageCss: pageCss || undefined, copies: Number(doc.settings["receipt.copies"]) || 1 });
  } catch (e) {
    toast.error("Impression impossible.", { description: toAppError(e).message });
  }
}

export async function saveSaleReceiptPdf(saleId: number, format: ReceiptFormat = defaultFormat()) {
  try {
    const doc = await loadSaleDocument(saleId);
    const { base64, filename } = await receiptPdf(doc, format);
    const path = await savePdf(filename, base64);
    if (path) toast.success("PDF enregistré.", { description: path });
  } catch (e) {
    toast.error("Génération du PDF impossible.", { description: toAppError(e).message });
  }
}

export async function saleReceiptAttachment(saleId: number, format: ReceiptFormat = defaultFormat()) {
  const doc = await loadSaleDocument(saleId);
  const { base64, filename } = await receiptPdf(doc, format);
  return { base64, mimetype: "application/pdf", filename };
}
