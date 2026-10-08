import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/** Convertit une chaîne saisie (virgule ou point) en nombre. */
export function parseNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.replace(/\s| | /g, "").replace(",", ".");
  if (s === "") return NaN;
  return Number(s);
}

export function round2(v: number) {
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
}

export function round3(v: number) {
  const r = Math.round((v + Number.EPSILON) * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

export function uniqueBy<T>(items: T[], key: (t: T) => unknown) {
  const seen = new Set();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
