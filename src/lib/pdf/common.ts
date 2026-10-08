import { jsPDF } from "jspdf";
import { autoTable, type RowInput } from "jspdf-autotable";
import type { Company } from "@/types";
import { imageToDataUrl } from "../files";
import { dateTime } from "../format";

export const BRAND: [number, number, number] = [37, 99, 235];
export const INK: [number, number, number] = [17, 24, 39];
export const MUTED: [number, number, number] = [107, 114, 128];

/** jsPDF (Helvetica) ne gère que le jeu WinAnsi : on remplace les caractères non supportés. */
export function pdfText(s: unknown) {
  return String(s ?? "")
    .replace(/[  ]/g, " ")
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”«»]/g, '"')
    .replace(/…/g, "...")
    .replace(/×/g, "x");
}

export function toBase64(doc: jsPDF) {
  return doc.output("datauristring").split(",")[1];
}

export function lastY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 40;
}

/** En-tête A4 standard : logo + entreprise à gauche, titre du document à droite. */
export async function a4Header(doc: jsPDF, company: Company, title: string, lines: string[]) {
  const W = doc.internal.pageSize.getWidth();
  let x = 14;
  const logo = await imageToDataUrl(company.logo);
  if (logo) {
    try {
      const props = doc.getImageProperties(logo);
      const h = 16;
      const w = Math.min(40, (props.width / props.height) * h);
      doc.addImage(logo, props.fileType, 14, 12, w, h);
      x = 14;
    } catch {
      /* logo illisible : ignoré */
    }
  }
  const top = logo ? 33 : 16;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold").setFontSize(14).text(pdfText(company.name), x, top);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
  const info = [[company.address, company.city].filter(Boolean).join(", "), [company.phone && `Tél : ${company.phone}`, company.email].filter(Boolean).join(" · ")].filter(Boolean);
  info.forEach((l, i) => doc.text(pdfText(l), x, top + 5 + i * 4));

  doc.setTextColor(...BRAND).setFont("helvetica", "bold").setFontSize(20).text(pdfText(title), W - 14, 20, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...INK);
  lines.forEach((l, i) => doc.text(pdfText(l), W - 14, 27 + i * 4.6, { align: "right" }));
  const y = Math.max(top + 5 + info.length * 4, 27 + lines.length * 4.6) + 3;
  doc.setDrawColor(...BRAND).setLineWidth(0.6).line(14, y, W - 14, y);
  return y + 6;
}

export function a4Footer(doc: jsPDF, company: Company, legal: string) {
  const pages = doc.getNumberOfPages();
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(229, 231, 235).setLineWidth(0.2).line(14, H - 16, W - 14, H - 16);
    doc.setFontSize(7.5).setTextColor(...MUTED).setFont("helvetica", "normal");
    doc.text(pdfText([company.name, legal].filter(Boolean).join(" · ")), 14, H - 11);
    doc.text(pdfText(`DigiStock par DigiStudio · Page ${p}/${pages}`), W - 14, H - 11, { align: "right" });
  }
}

export function table(doc: jsPDF, startY: number, head: string[], body: RowInput[], opts: { rightCols?: number[]; foot?: RowInput[] } = {}) {
  const right = Object.fromEntries((opts.rightCols ?? []).map((i) => [i, { halign: "right" as const }]));
  autoTable(doc, {
    startY,
    head: [head.map(pdfText)],
    body: body.map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === "string" || typeof c === "number" ? pdfText(c) : c)) : r)),
    foot: opts.foot,
    margin: { left: 14, right: 14, bottom: 22 },
    styles: { font: "helvetica", fontSize: 8.5, cellPadding: 2.2, textColor: INK, lineColor: [238, 240, 244], lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: [245, 246, 250], textColor: MUTED, fontStyle: "bold", fontSize: 7.5 },
    footStyles: { fillColor: [245, 246, 250], textColor: INK, fontStyle: "bold" },
    columnStyles: right,
    didParseCell: (d) => {
      if (d.section !== "body" && (opts.rightCols ?? []).includes(d.column.index)) d.cell.styles.halign = "right";
    },
    theme: "plain",
  });
  return lastY(doc);
}

export interface ReportSection {
  title: string;
  head: string[];
  rows: RowInput[];
  rightCols?: number[];
  foot?: RowInput[];
}

/** Rapport PDF générique : indicateurs + tableaux. */
export async function reportPdf(opts: { company: Company; title: string; subtitle: string; kpis?: { label: string; value: string }[]; sections: ReportSection[]; landscape?: boolean }) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: opts.landscape ? "landscape" : "portrait" });
  const W = doc.internal.pageSize.getWidth();
  let y = await a4Header(doc, opts.company, opts.title, [opts.subtitle, `Édité le ${dateTime(new Date())}`]);
  if (opts.kpis?.length) {
    const n = opts.kpis.length;
    const gap = 3;
    const w = (W - 28 - gap * (n - 1)) / n;
    opts.kpis.forEach((k, i) => {
      const x = 14 + i * (w + gap);
      doc.setDrawColor(229, 231, 235).setFillColor(250, 250, 252).roundedRect(x, y, w, 17, 2, 2, "FD");
      doc.setFontSize(7).setTextColor(...MUTED).text(pdfText(k.label.toUpperCase()), x + 3, y + 5.5);
      doc.setFontSize(11.5).setTextColor(...INK).setFont("helvetica", "bold").text(pdfText(k.value), x + 3, y + 12.5);
      doc.setFont("helvetica", "normal");
    });
    y += 24;
  }
  for (const s of opts.sections) {
    if (y > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      y = 18;
    }
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text(pdfText(s.title), 14, y);
    doc.setFont("helvetica", "normal");
    y = table(doc, y + 2.5, s.head, s.rows, { rightCols: s.rightCols, foot: s.foot }) + 9;
  }
  a4Footer(doc, opts.company, "");
  return doc;
}
