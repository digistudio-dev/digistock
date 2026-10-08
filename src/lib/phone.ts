/** Normalise un numéro marocain au format international (ex. 212612345678). Miroir de whatsapp.rs. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  let n: string;
  if (digits.startsWith("00")) n = digits.slice(2);
  else if (digits.startsWith("0") && digits.length === 10) n = "212" + digits.slice(1);
  else if (digits.length === 9 && /^[567]/.test(digits)) n = "212" + digits;
  else n = digits;
  return n.length >= 10 && n.length <= 15 ? n : null;
}

export function formatPhone(raw: string | null | undefined) {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10 && d.startsWith("0")) return d.replace(/(\d{2})(?=\d)/g, "$1 ").trim();
  return raw;
}

/** Remplace les variables {nom} d'un modèle de message. */
export function fillTemplate(template: string, vars: Record<string, string | number | null | undefined>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").toString());
}
