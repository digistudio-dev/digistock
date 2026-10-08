import { useEffect, useRef } from "react";
import { create } from "zustand";

/**
 * Pile de gestionnaires de scan : la page active (Caisse, Inventaire, Achat…) peut
 * intercepter les scans globaux. Sans gestionnaire, le shell ouvre la fiche produit.
 */
type ScanHandler = (code: string) => void;

interface ScanState {
  stack: { id: number; fn: React.MutableRefObject<ScanHandler> }[];
  push: (id: number, fn: React.MutableRefObject<ScanHandler>) => void;
  remove: (id: number) => void;
}

export const useScanStore = create<ScanState>((set) => ({
  stack: [],
  push: (id, fn) => set((s) => ({ stack: [...s.stack, { id, fn }] })),
  remove: (id) => set((s) => ({ stack: s.stack.filter((h) => h.id !== id) })),
}));

let seq = 0;

export function useScanHandler(fn: ScanHandler) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const id = ++seq;
    useScanStore.getState().push(id, ref);
    return () => useScanStore.getState().remove(id);
  }, []);
}

export function dispatchScan(code: string): boolean {
  const { stack } = useScanStore.getState();
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.fn.current(code);
  return true;
}
