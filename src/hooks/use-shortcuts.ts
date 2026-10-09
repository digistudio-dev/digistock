import { useEffect, useRef } from "react";

type Handler = (e: KeyboardEvent) => void;

/**
 * Raccourcis clavier : { "ctrl+k": fn, "f2": fn }.
 * Les touches de fonction et combinaisons Ctrl fonctionnent même dans un champ de saisie.
 */
export function useShortcuts(map: Record<string, Handler>, enabled = true) {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const parts: string[] = [];
      if (e.ctrlKey || e.metaKey) parts.push("ctrl");
      if (e.shiftKey) parts.push("shift");
      if (e.altKey) parts.push("alt");
      parts.push(e.key.toLowerCase());
      const combo = parts.join("+");
      const fn = ref.current[combo];
      if (!fn) return;
      const target = e.target as HTMLElement | null;
      const editable = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const isFn = /^f\d+$/.test(e.key.toLowerCase());
      if (editable && !isFn && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      fn(e);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled]);
}
