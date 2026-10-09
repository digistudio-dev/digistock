import { fr, type Dictionary } from "./fr";

/**
 * Internationalisation minimaliste et typée.
 * Ajouter une langue : créer `ar.ts` / `en.ts` respectant `Dictionary`, l'enregistrer ci-dessous.
 * Pour l'arabe, positionner aussi `document.dir = "rtl"`.
 */
export type Locale = "fr-MA" | "ar-MA" | "en";

const dictionaries: Partial<Record<Locale, Dictionary>> = { "fr-MA": fr };

let current: Locale = "fr-MA";
let dict: Dictionary = fr;

export function setLocale(locale: Locale) {
  const d = dictionaries[locale];
  if (!d) return;
  current = locale;
  dict = d;
  document.documentElement.lang = locale.slice(0, 2);
  document.documentElement.dir = locale.startsWith("ar") ? "rtl" : "ltr";
}

export const getLocale = () => current;

type Path<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Path<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Path<Dictionary>;

/** t("nav.products") → « Produits » ; variables : t("x", { n: 3 }) remplace {n}. */
export function t(key: TranslationKey, vars?: Record<string, string | number>): string {
  const value = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], dict);
  const s = typeof value === "string" ? value : key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? "")) : s;
}

/** Accès direct à une section (ex. libellés d'énumérations). */
export function section<K extends keyof Dictionary>(k: K): Dictionary[K] {
  return dict[k];
}

export const unitLabel = (u: string) => (dict.units as Record<string, string>)[u] ?? u;
export const unitShort = (u: string) => (dict.unitsShort as Record<string, string>)[u] ?? u;
export const paymentLabel = (m: string) => (dict.payment as Record<string, string>)[m] ?? m;
export const movementLabel = (m: string) => (dict.movement as Record<string, string>)[m] ?? m;
