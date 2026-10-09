import { create } from "zustand";
import { computeTotals } from "@/lib/calc";
import { round3 } from "@/lib/utils";

export interface CartLine {
  productId: number;
  name: string;
  barcode: string | null;
  unit: string;
  image: string | null;
  unitPrice: number;
  originalPrice: number;
  quantity: number;
  discount: number;
  taxRate: number;
  stock: number;
}

export type PaymentMethod = "cash" | "card" | "transfer" | "credit" | "other";

export interface ProductLike {
  id: number;
  name: string;
  barcode: string | null;
  unit: string;
  image: string | null;
  selling_price: number;
  tax_rate: number;
  stock?: number;
  quantity?: number;
}

interface PosState {
  lines: CartLine[];
  customerId: number | null;
  discount: number;
  method: PaymentMethod;
  received: number | null;
  paidNow: number | null;
  note: string;
  warehouseId: number | null;
  /** Dernière ligne modifiée (pour la surbrillance) et compteur d'animation. */
  flash: { productId: number; n: number } | null;
  add: (p: ProductLike, qty?: number) => void;
  setQty: (productId: number, qty: number) => void;
  inc: (productId: number, delta: number) => void;
  setPrice: (productId: number, price: number) => void;
  setLineDiscount: (productId: number, discount: number) => void;
  remove: (productId: number) => void;
  clear: () => void;
  set: (patch: Partial<Pick<PosState, "customerId" | "discount" | "method" | "received" | "paidNow" | "note" | "warehouseId">>) => void;
}

let flashN = 0;

export const usePos = create<PosState>((set, get) => ({
  lines: [],
  customerId: null,
  discount: 0,
  method: "cash",
  received: null,
  paidNow: null,
  note: "",
  warehouseId: null,
  flash: null,
  add: (p, qty = 1) => {
    const lines = get().lines;
    const existing = lines.find((l) => l.productId === p.id);
    const next = existing
      ? lines.map((l) => (l.productId === p.id ? { ...l, quantity: round3(l.quantity + qty) } : l))
      : [
          ...lines,
          {
            productId: p.id,
            name: p.name,
            barcode: p.barcode,
            unit: p.unit,
            image: p.image,
            unitPrice: p.selling_price,
            originalPrice: p.selling_price,
            quantity: qty,
            discount: 0,
            taxRate: p.tax_rate,
            stock: p.stock ?? p.quantity ?? 0,
          },
        ];
    set({ lines: next, flash: { productId: p.id, n: ++flashN } });
  },
  setQty: (productId, qty) =>
    set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(round3(qty), 0.001) } : l)), flash: { productId, n: ++flashN } }),
  inc: (productId, delta) => {
    const line = get().lines.find((l) => l.productId === productId);
    if (!line) return;
    const q = round3(line.quantity + delta);
    if (q <= 0) get().remove(productId);
    else get().setQty(productId, q);
  },
  setPrice: (productId, price) => set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, unitPrice: Math.max(price, 0) } : l)) }),
  setLineDiscount: (productId, discount) => set({ lines: get().lines.map((l) => (l.productId === productId ? { ...l, discount: Math.max(discount, 0) } : l)) }),
  remove: (productId) => set({ lines: get().lines.filter((l) => l.productId !== productId) }),
  clear: () => set({ lines: [], customerId: null, discount: 0, received: null, paidNow: null, note: "", flash: null, method: "cash" }),
  set: (patch) => set(patch),
}));

export function usePosTotals(pricesIncludeTax: boolean) {
  const lines = usePos((s) => s.lines);
  const discount = usePos((s) => s.discount);
  return computeTotals(
    lines.map((l) => ({ quantity: l.quantity, unitPrice: l.unitPrice, discount: l.discount, taxRate: l.taxRate })),
    discount,
    pricesIncludeTax,
  );
}
