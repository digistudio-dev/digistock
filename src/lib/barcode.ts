/** Utilitaires code-barres : EAN-13 et Code128. */

export function ean13CheckDigit(base12: string): number {
  const sum = base12.split("").reduce((s, c, i) => s + Number(c) * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Génère un EAN-13 interne (préfixe 2x, réservé à l'usage en magasin). */
export function generateEan13(): string {
  let base = "2" + String(Math.floor(Math.random() * 10));
  for (let i = 0; i < 10; i++) base += String(Math.floor(Math.random() * 10));
  return base + ean13CheckDigit(base);
}

export type BarcodeFormat = "EAN13" | "CODE128";

export function detectFormat(code: string): BarcodeFormat {
  return isValidEan13(code) ? "EAN13" : "CODE128";
}

/** Code128 accepte l'ASCII imprimable. */
export function isValidCode128(code: string): boolean {
  return code.length > 0 && code.length <= 64 && /^[\x20-\x7E]+$/.test(code);
}

export function normalizeScan(raw: string) {
  return raw.replace(/[\r\n\t]/g, "").trim();
}
