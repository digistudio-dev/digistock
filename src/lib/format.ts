import { format as fmtDate, formatDistanceToNowStrict, isValid, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

// Formatage fr-MA : « 12 450,00 DH ». Séparateur de milliers : espace fine insécable.
const moneyFmt = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const intFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

const clean = (s: string) => s.replace(/ /g, " ");

export const CURRENCY = "DH";

export function money(v: number | null | undefined, withCurrency = true) {
  const n = Number(v ?? 0);
  const s = clean(moneyFmt.format(Number.isFinite(n) ? n : 0));
  return withCurrency ? `${s} ${CURRENCY}` : s;
}

/** Montant compact pour les axes de graphiques : 12,4 k */
export function moneyShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${pctFmt.format(v / 1_000_000)} M`;
  if (abs >= 1_000) return `${pctFmt.format(v / 1_000)} k`;
  return intFmt.format(v);
}

export function qty(v: number | null | undefined) {
  return clean(numFmt.format(Number(v ?? 0)));
}

export function int(v: number | null | undefined) {
  return clean(intFmt.format(Number(v ?? 0)));
}

export function percent(v: number | null | undefined) {
  return `${clean(pctFmt.format(Number(v ?? 0)))} %`;
}

export function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = parseISO(v.replace(" ", "T"));
  return isValid(d) ? d : null;
}

/** 05/10/2026 */
export function date(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? fmtDate(d, "dd/MM/yyyy") : "—";
}

/** 05/10/2026 14:32 */
export function dateTime(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? fmtDate(d, "dd/MM/yyyy HH:mm") : "—";
}

export function time(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? fmtDate(d, "HH:mm") : "—";
}

export function relative(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? `il y a ${formatDistanceToNowStrict(d, { locale: fr })}` : "—";
}

export function dateLong(v: string | Date | null | undefined) {
  const d = toDate(v);
  return d ? fmtDate(d, "EEEE d MMMM yyyy", { locale: fr }) : "—";
}

/** Date SQL locale 'YYYY-MM-DD'. */
export function sqlDate(d: Date) {
  return fmtDate(d, "yyyy-MM-dd");
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${pctFmt.format(bytes / 1024)} Ko`;
  return `${pctFmt.format(bytes / 1024 / 1024)} Mo`;
}
