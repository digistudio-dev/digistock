import { ArrowLeftRight, ArrowRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { NumberInput } from "@/components/common/inputs";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { ProductFinder, type ProductOption } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { useAction } from "@/hooks/use-action";
import { unitShort } from "@/i18n";
import { select } from "@/lib/db";
import { qty } from "@/lib/format";
import { call } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { usePremium } from "@/stores/app";
import { useScanHandler } from "@/stores/scan";
import { useWarehouses } from "./api";

interface Line {
  product_id: number;
  name: string;
  unit: string;
  available: number;
  quantity: number;
}

export function TransferFormPage() {
  const navigate = useNavigate();
  const premium = usePremium();
  const gate = usePremiumGate();
  const { data: warehouses = [] } = useWarehouses();
  const { run, pending } = useAction();
  const [source, setSource] = useState<number | null>(null);
  const [destination, setDestination] = useState<number | null>(null);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!premium) {
      gate.open("transfers");
      navigate("/warehouses", { replace: true });
    }
  }, [premium, gate, navigate]);

  useEffect(() => {
    if (warehouses.length >= 2 && source === null) {
      setSource(warehouses[0].id);
      setDestination(warehouses[1].id);
    }
  }, [warehouses, source]);

  const availability = async (productId: number, wh: number) =>
    (await select<{ q: number }>("SELECT COALESCE((SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?), 0) AS q", [productId, wh]))[0]?.q ?? 0;

  // Rafraîchit le disponible quand l'entrepôt source change.
  useEffect(() => {
    if (!source) return;
    Promise.all(lines.map(async (l) => ({ ...l, available: await availability(l.product_id, source) }))).then(setLines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const add = async (p: Pick<ProductOption, "id" | "name" | "unit">) => {
    if (!source) return;
    const available = await availability(p.id, source);
    setLines((cur) => (cur.some((l) => l.product_id === p.id) ? cur.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l)) : [...cur, { product_id: p.id, name: p.name, unit: p.unit, available, quantity: 1 }]));
  };

  useScanHandler(async (code) => {
    const rows = await select<ProductOption>("SELECT id, name, unit FROM products WHERE barcode = ? AND archived = 0", [code]);
    if (rows[0]) add(rows[0]);
    else toast.error("Produit introuvable", { description: code });
  });

  const invalid = lines.some((l) => !(l.quantity > 0) || l.quantity > l.available);
  const submit = async () => {
    if (!source || !destination || source === destination) return toast.error("Choisissez deux entrepôts différents.");
    if (!lines.length) return toast.error("Ajoutez au moins un produit.");
    if (invalid) return toast.error("Certaines quantités dépassent le stock disponible.");
    const res = await run(
      () =>
        call<{ id: number; number: string }>("stock_transfer", {
          input: { source_warehouse_id: source, destination_warehouse_id: destination, reference: reference || null, notes: notes || null, items: lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity })) },
        }),
      { success: "Transfert enregistré." },
    );
    if (res) navigate("/warehouses");
  };

  if (warehouses.length < 2)
    return (
      <Page>
        <PageHeader back="/warehouses" title="Nouveau transfert" />
        <Card>
          <EmptyState icon={<ArrowLeftRight />} title="Un seul entrepôt" description="Créez au moins un second entrepôt pour effectuer des transferts." actions={<Button onClick={() => navigate("/warehouses")}>Gérer les entrepôts</Button>} />
        </Card>
      </Page>
    );

  return (
    <Page className="max-w-[1100px]">
      <PageHeader
        back="/warehouses"
        title="Nouveau transfert"
        description="Le stock est retiré de l'entrepôt source et ajouté à la destination, avec un mouvement de chaque côté."
        actions={
          <Button onClick={submit} loading={pending}>
            <ArrowLeftRight /> Valider le transfert
          </Button>
        }
      />
      <Card className="mb-4 p-5">
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4">
          <Field label="Entrepôt source">
            <Select value={source ?? ""} onChange={(e) => setSource(Number(e.target.value))}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <ArrowRight className="mb-2.5 size-5 text-muted-foreground" />
          <Field label="Entrepôt de destination" error={source === destination ? "Choisissez un autre entrepôt." : undefined}>
            <Select value={destination ?? ""} onChange={(e) => setDestination(Number(e.target.value))}>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Référence">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex. BL interne 12" />
          </Field>
          <span />
          <Field label="Notes">
            <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-9" />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Produits à transférer" />
        <div className="px-5 pb-3 pt-3">
          <ProductFinder onPick={add} />
        </div>
        {lines.length === 0 ? (
          <EmptyState compact title="Aucun produit" description="Scannez ou recherchez les produits à déplacer." />
        ) : (
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2">Produit</th>
                <th className="px-3 py-2 text-right">Disponible (source)</th>
                <th className="px-3 py-2 text-right">Quantité</th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.product_id} className="border-b last:border-0">
                  <td className="px-5 py-2 font-medium">{l.name}</td>
                  <td className={cn("num px-3 text-right", l.quantity > l.available ? "font-semibold text-danger" : "text-muted-foreground")}>
                    {qty(l.available)} {unitShort(l.unit)}
                  </td>
                  <td className="px-3">
                    <NumberInput value={l.quantity} onValueChange={(v) => setLines((c) => c.map((x) => (x.product_id === l.product_id ? { ...x, quantity: v ?? 0 } : x)))} decimals={3} inputSize="sm" className="ml-auto w-28" />
                  </td>
                  <td className="pr-3 text-right">
                    <Button variant="ghost" size="icon-xs" onClick={() => setLines((c) => c.filter((x) => x.product_id !== l.product_id))} aria-label="Retirer">
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
