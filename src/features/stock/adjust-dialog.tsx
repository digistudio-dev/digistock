import { useQuery } from "@tanstack/react-query";
import { ArrowRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { NumberInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { TabsList, TabsTrigger, Tabs } from "@/components/ui/misc";
import { useAction } from "@/hooks/use-action";
import { unitShort } from "@/i18n";
import { one } from "@/lib/db";
import { qty } from "@/lib/format";
import { call } from "@/lib/tauri";
import { round3 } from "@/lib/utils";
import { usePremium } from "@/stores/app";
import { useWarehouses } from "@/features/warehouses/api";

interface AdjustState {
  productId: number | null;
  open: (productId: number) => void;
  close: () => void;
}

export const useAdjust = create<AdjustState>((set) => ({
  productId: null,
  open: (productId) => set({ productId }),
  close: () => set({ productId: null }),
}));

const KINDS = [
  { value: "ADJUSTMENT", label: "Ajustement manuel" },
  { value: "DAMAGED", label: "Produit endommagé / perte" },
  { value: "RETURN", label: "Retour" },
];

const REASONS = ["Recomptage physique", "Erreur de saisie", "Casse", "Produit périmé", "Vol ou perte", "Retour client", "Échantillon offert"];

export function StockAdjustHost() {
  const { productId, close } = useAdjust();
  const premium = usePremium();
  const { data: warehouses = [] } = useWarehouses();
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [kind, setKind] = useState("ADJUSTMENT");
  const [quantity, setQuantity] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();

  useEffect(() => {
    if (productId) {
      setMode("add");
      setKind("ADJUSTMENT");
      setQuantity(null);
      setReason("");
      setTouched(false);
      setWarehouseId(warehouses.find((w) => w.is_default)?.id ?? 1);
    }
  }, [productId, warehouses]);

  const { data: product } = useQuery({
    queryKey: ["adjust-product", productId, warehouseId],
    enabled: !!productId,
    queryFn: () =>
      one<{ name: string; unit: string; quantity: number; wh_quantity: number }>(
        "SELECT p.name, p.unit, p.quantity, COALESCE((SELECT quantity FROM warehouse_stock WHERE product_id = p.id AND warehouse_id = ?2), 0) AS wh_quantity FROM products p WHERE p.id = ?1",
        [productId, warehouseId ?? 1],
      ),
  });

  const current = product?.wh_quantity ?? 0;
  const q = quantity ?? 0;
  const after = mode === "add" ? current + q : mode === "remove" ? current - q : q;
  const effectiveKind = mode === "remove" || mode === "set" ? kind : kind === "DAMAGED" ? "ADJUSTMENT" : kind;
  const errors = {
    quantity: quantity === null || quantity < 0 || (mode !== "set" && quantity === 0) ? "Saisissez une quantité valide." : undefined,
    reason: reason.trim().length < 3 ? "Le motif est obligatoire." : undefined,
  };

  const submit = async () => {
    setTouched(true);
    if (errors.quantity || errors.reason || !productId) return;
    const res = await run(
      () => call("stock_adjust", { input: { product_id: productId, warehouse_id: warehouseId, mode, quantity: q, kind: effectiveKind, reason: reason.trim() } }),
      { success: "Stock mis à jour." },
    );
    if (res) close();
  };

  return (
    <Dialog open={!!productId} onOpenChange={(o) => !o && close()}>
      <DialogContent size="md" title="Ajuster le stock" description={product?.name} icon={<SlidersHorizontal />}>
        <DialogBody className="space-y-4">
          <Tabs value={mode} onValueChange={(v) => setMode(v as typeof mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="add">Ajouter</TabsTrigger>
              <TabsTrigger value="remove">Retirer</TabsTrigger>
              <TabsTrigger value="set">Définir le stock</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="grid grid-cols-2 gap-3">
            {premium && warehouses.length > 1 && (
              <Field label="Entrepôt" className="col-span-2">
                <Select value={warehouseId ?? ""} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={mode === "set" ? "Nouveau stock" : "Quantité"} required error={touched ? errors.quantity : undefined}>
              <NumberInput autoFocus value={quantity} onValueChange={setQuantity} decimals={3} allowEmpty suffix={product ? unitShort(product.unit) : undefined} aria-invalid={touched && !!errors.quantity} />
            </Field>
            <Field label="Type de mouvement">
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.filter((k) => mode !== "add" || k.value !== "DAMAGED").map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex items-center justify-center gap-4 rounded-lg border bg-subtle py-3 text-[0.8125rem]">
            <div className="text-center">
              <div className="text-muted-foreground">Stock actuel</div>
              <div className="num text-[1.125rem] font-semibold">{qty(current)}</div>
            </div>
            <ArrowRight className="size-4 text-muted-foreground" />
            <div className="text-center">
              <div className="text-muted-foreground">Après ajustement</div>
              <div className={"num text-[1.125rem] font-semibold " + (after < 0 ? "text-danger" : "text-primary")}>{qty(round3(after))}</div>
            </div>
          </div>
          <Field label="Motif" required error={touched ? errors.reason : undefined}>
            <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Expliquez la raison de cet ajustement" aria-invalid={touched && !!errors.reason} />
          </Field>
          <div className="-mt-1 flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full border bg-surface px-2.5 py-1 text-[0.75rem] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground">
                {r}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            Annuler
          </Button>
          <Button onClick={submit} loading={pending}>
            Enregistrer l'ajustement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
