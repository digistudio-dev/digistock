import { useQueryClient } from "@tanstack/react-query";
import { Plus, Warehouse } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { PartyOption } from "@/components/common/pickers";
import { Select } from "@/components/ui/input";
import { useDefaultWarehouseId, useWarehouses } from "@/features/warehouses/api";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { one } from "@/lib/db";
import type { PartyOption as Party } from "@/components/common/pickers";
import { printSaleReceipt } from "@/lib/receipts";
import { call, toAppError } from "@/lib/tauri";
import { parseNumber } from "@/lib/utils";
import { useCan, usePremium, useSettings } from "@/stores/app";
import { useScanHandler } from "@/stores/scan";
import { PosCart } from "./pos-cart";
import { PosProducts, type PosProduct } from "./pos-products";
import { usePos, usePosTotals } from "./pos-store";
import { SaleSuccessDialog, type CompletedSale } from "./sale-success";

/** Petit bip de confirmation de scan (Web Audio, aucun fichier requis). */
function beep(ok = true) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1250 : 320;
    g.gain.setValueAtTime(0.06, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.08 : 0.25));
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => ctx.close();
  } catch {
    /* audio indisponible */
  }
}

export function PosPage() {
  const settings = useSettings();
  const premium = usePremium();
  const can = useCan();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: warehouses = [] } = useWarehouses();
  const defaultWh = useDefaultWarehouseId();
  const storedWarehouse = usePos((s) => s.warehouseId);
  const warehouseId = storedWarehouse ?? defaultWh;
  const totals = usePosTotals(settings["sales.prices_include_tax"]);
  const [term, setTerm] = useState("");
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [customer, setCustomer] = useState<PartyOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [completed, setCompleted] = useState<CompletedSale | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sound = settings["sales.sound"];

  const multiplierMatch = term.trim().match(/^(\d+(?:[.,]\d+)?)\*$/);
  const multiplier = multiplierMatch ? parseNumber(multiplierMatch[1]) : null;

  // Client présélectionné (ex. « Nouvelle vente » depuis la fiche client).
  useEffect(() => {
    const cid = usePos.getState().customerId;
    if (cid) one<Party>("SELECT id, name, phone, whatsapp, balance, credit_limit FROM customers WHERE id = ?", [cid]).then((c) => c && setCustomer(c));
  }, []);

  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);

  const addProduct = (p: PosProduct | (Omit<PosProduct, "category_color" | "sku"> & { category_color?: null; sku?: null }), q?: number) => {
    usePos.getState().add(p, q ?? 1);
    if (sound) beep(true);
  };

  const findByCode = (code: string) =>
    one<PosProduct>(
      `SELECT p.id, p.name, p.barcode, p.sku, p.unit, p.image, p.selling_price, p.tax_rate, p.minimum_stock, NULL AS category_color,
              COALESCE((SELECT quantity FROM warehouse_stock WHERE product_id = p.id AND warehouse_id = ?2), 0) AS stock
       FROM products p WHERE p.archived = 0 AND (p.barcode = ?1 OR p.sku = ?1) LIMIT 1`,
      [code, warehouseId],
    );

  const notFound = (code: string) => {
    if (sound) beep(false);
    toast.error("Produit introuvable", {
      description: `Aucun produit avec le code ${code}.`,
      action: can("manage_products") ? { label: "Créer ce produit", onClick: () => navigate(`/products/new?barcode=${encodeURIComponent(code)}`) } : undefined,
    });
  };

  const addByCode = async (code: string, q = 1) => {
    const p = await findByCode(code);
    if (p) addProduct(p, q);
    else notFound(code);
    return !!p;
  };

  // Scan détecté hors du champ de recherche (ex. après un clic) : ajout direct.
  useScanHandler((code) => {
    addByCode(code);
    focusSearch();
  });

  /** Entrée dans la recherche : « CODE », « 5*CODE » (quantité) ou nom de produit. */
  const onSubmitSearch = async () => {
    const raw = term.trim();
    if (!raw) {
      if (usePos.getState().lines.length) validate();
      return;
    }
    if (multiplier) return;
    const m = raw.match(/^(\d+(?:[.,]\d+)?)\*(.+)$/);
    const q = m ? parseNumber(m[1]) : 1;
    const t = (m ? m[2] : raw).trim();
    const p = await findByCode(t);
    if (p) {
      addProduct(p, q > 0 ? q : 1);
      setTerm("");
      return;
    }
    // Pas de code exact : on ajoute le résultat de la recherche s'il est unique.
    const list = qc.getQueryData<PosProduct[]>(["pos", "products", t, categoryId, warehouseId]);
    if (list && list.length === 1) {
      addProduct(list[0], q > 0 ? q : 1);
      setTerm("");
    } else if (/^[!-~]{4,}$/.test(t) && /\d/.test(t) && (!list || list.length === 0)) {
      // Code scanné inconnu : on libère le champ pour le scan suivant.
      notFound(t);
      setTerm("");
    }
  };

  const validate = async () => {
    const s = usePos.getState();
    if (!s.lines.length || submitting) return;
    if (s.method === "credit" && !s.customerId) {
      toast.error("Sélectionnez un client pour une vente à crédit.");
      return;
    }
    if (s.method === "cash" && s.received && s.received > 0 && s.received < totals.total) {
      toast.error("Le montant reçu est inférieur au total.");
      return;
    }
    if (!settings["stock.allow_negative"]) {
      const over = s.lines.find((l) => l.quantity > l.stock);
      if (over) {
        toast.error("Stock insuffisant", { description: `« ${over.name} » : ${over.stock} disponible(s).` });
        return;
      }
    }
    setSubmitting(true);
    try {
      const res = await call<{ id: number; number: string; total: number; change_amount: number; credit_amount: number }>("sale_create", {
        input: {
          customer_id: s.customerId,
          warehouse_id: warehouseId,
          items: s.lines.map((l) => ({ product_id: l.productId, quantity: l.quantity, unit_price: l.unitPrice, discount: l.discount })),
          discount: s.discount,
          payment_method: s.method,
          received_amount: s.method === "cash" ? s.received : null,
          paid_now: s.method === "credit" ? s.paidNow ?? 0 : null,
          note: s.note || null,
        },
      });
      const done: CompletedSale = { ...res, customer: customer ? { name: customer.name, phone: customer.phone, whatsapp: customer.whatsapp } : null };
      usePos.getState().clear();
      setCustomer(null);
      qc.invalidateQueries();
      toast.success("Vente enregistrée.", { description: res.number });
      if (settings["receipt.after_sale"] === "print") {
        printSaleReceipt(res.id);
        focusSearch();
      } else if (settings["receipt.after_sale"] === "none") {
        focusSearch();
      } else {
        setCompleted(done);
      }
    } catch (e) {
      toast.error("Impossible d'enregistrer la vente.", { description: toAppError(e).message + " Aucune modification du stock n'a été effectuée." });
    } finally {
      setSubmitting(false);
    }
  };

  useShortcuts(
    {
      f9: () => validate(),
      "ctrl+enter": () => validate(),
      f6: () => usePos.getState().set({ method: "cash" }),
      f7: () => usePos.getState().set({ method: "card" }),
      f8: () => usePos.getState().set({ method: "credit" }),
      f10: () => (document.getElementById("pos-received") as HTMLInputElement | null)?.focus(),
      delete: () => {
        const l = usePos.getState().lines.at(-1);
        if (l) usePos.getState().remove(l.productId);
      },
      "+": () => {
        const l = usePos.getState().lines.at(-1);
        if (l) usePos.getState().inc(l.productId, 1);
      },
      "-": () => {
        const l = usePos.getState().lines.at(-1);
        if (l) usePos.getState().inc(l.productId, -1);
      },
    },
    !completed,
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <PosProducts
          ref={searchRef}
          term={term}
          setTerm={setTerm}
          categoryId={categoryId}
          setCategoryId={setCategoryId}
          warehouseId={warehouseId}
          onAdd={(p) => {
            addProduct(p, multiplier ?? 1);
            if (multiplier) setTerm("");
            focusSearch();
          }}
          onSubmitSearch={onSubmitSearch}
          multiplier={multiplier}
        />
        <div className="flex h-9 shrink-0 items-center gap-4 border-t bg-surface px-5 text-[0.6875rem] text-muted-foreground">
          <span>
            <span className="kbd">Entrée</span> ajouter / valider
          </span>
          <span>
            <span className="kbd">F9</span> valider
          </span>
          <span>
            <span className="kbd">F6</span> espèces <span className="kbd">F7</span> carte <span className="kbd">F8</span> crédit
          </span>
          <span>
            <span className="kbd">+</span> <span className="kbd">−</span> quantité
          </span>
          <span>
            <span className="kbd">Suppr</span> retirer
          </span>
          <div className="ml-auto flex items-center gap-2">
            {premium && warehouses.length > 1 && (
              <>
                <Warehouse className="size-3.5" />
                <Select inputSize="sm" className="w-44 [&_select]:h-7 [&_select]:text-[0.75rem]" value={warehouseId} onChange={(e) => usePos.getState().set({ warehouseId: Number(e.target.value) })}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {can("manage_products") && (
              <button onClick={() => navigate("/products/new")} className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-accent hover:text-foreground">
                <Plus className="size-3.5" /> Nouveau produit
              </button>
            )}
          </div>
        </div>
      </div>
      <PosCart totals={totals} onValidate={validate} submitting={submitting} customer={customer} setCustomer={setCustomer} />
      <SaleSuccessDialog
        sale={completed}
        onClose={() => {
          setCompleted(null);
          focusSearch();
        }}
      />
    </div>
  );
}
