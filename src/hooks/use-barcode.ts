import { useEffect, useRef } from "react";
import { normalizeScan } from "@/lib/barcode";

/**
 * Écoute globale des douchettes USB (émulation clavier).
 * Une saisie est considérée comme un scan si ≥ 4 caractères arrivent très rapidement
 * (< 50 ms entre deux touches) puis sont terminés par Entrée.
 *
 * Les champs marqués `data-scan-target` reçoivent le scan normalement (ex. recherche POS) :
 * l'écouteur global ne s'active que lorsque le focus n'est pas dans un champ de saisie.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef("");
  const last = useRef(0);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editable = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if (editable) {
        buffer.current = "";
        return;
      }
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const now = performance.now();
      const gap = now - last.current;
      last.current = now;
      if (e.key === "Enter") {
        const code = normalizeScan(buffer.current);
        buffer.current = "";
        if (code.length >= 4) {
          e.preventDefault();
          cb.current(code);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (gap > 50) buffer.current = "";
      buffer.current += e.key;
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [enabled]);
}

/** Détecte si une saisie dans un champ provient d'une douchette (frappes très rapides). */
export function useScanTiming() {
  const times = useRef<number[]>([]);
  return {
    onKeyDown: () => {
      const now = performance.now();
      times.current = [...times.current.filter((t) => now - t < 1000), now].slice(-30);
    },
    /** Vrai si les derniers caractères ont été tapés à un rythme de scanner. */
    isScan: (length: number) => {
      const t = times.current.slice(-Math.max(length, 4));
      if (t.length < 4) return false;
      const avg = (t[t.length - 1] - t[0]) / (t.length - 1);
      return avg < 35;
    },
    reset: () => (times.current = []),
  };
}
