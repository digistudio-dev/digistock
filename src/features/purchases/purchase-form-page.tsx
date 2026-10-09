import { useQuery } from "@tanstack/react-query";
import { CalendarClock, PackagePlus, Save, ShoppingBag, Trash2, Truck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { MoneyInput, NumberInput } from "@/components/common/inputs";
import { EmptyState, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { ProductFinder, SupplierPicker, loadProduct, type ProductOption } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Checkbox, Card, CardHeader } from "@/components/ui/misc";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useWarehouses } from "@/features/warehouses/api";
import { useAction } from "@/hooks/use-action";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { paymentLabel, unitShort } from "@/i18n";
import { purchaseTotals } from "@/lib/calc";
import { one, select } from "@/lib/db";
import { money, qty, sqlDate } from "@/lib/format";
import { basicRecommendedQuantity } from "@/lib/reorder";
import { call } from "@/lib/tauri";
import { cn, round2 } from "@/lib/utils";
import { usePremium } from "@/stores/app";
import { useScanHandler } from "@/stores/scan";
import type { Purchase, PurchaseItem } from "@/types";

interface Line {
  product_id: number;
  name: string;
  unit: string;
  stock: number;
  quantity: number;
  unit_cost: number;
  tax_rate: number;
  batch_number: string;
  expiration_date: string;
}

const TAX_RATES = [0, 7, 10, 14, 20];

export function PurchaseFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const premium = usePremium();
  const { data: warehouses = [] } = useWarehouses();
  const { run, pending } = useAction();

  const [supplierId, setSupplierId] = useState<number | null>(search.get("supplier") ? Number(search.get("supplier")) : null);
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(sqlDate(new Date()));
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [status, setStatus] = useState<"received" | "ordered">(search.get("order") === "1" || search.get("product") ? "ordered" : "received");
  const [lines, setLines] = useState<Line[]>([]);
  const [paid, setPaid] = useState<number | null>(null);
  const [method, setMethod] = useState("cash");
  const [updatePrice, setUpdatePrice] = useState(true);
  const [note, setNote] = useState("");
  const [showBatches, setShowBatches] = useState(false);
  const [touched, setTouched] = useState(false);

  // Mode édition (commande non réceptionnée)
  const { data: existing, isLoading } = useQuery({
    queryKey: ["purchase", id, "edit"],
    enabled: !!id,
    queryFn: async () => {
      const p = await one<Purchase>("SELECT * FROM purchases WHERE id = ?", [id]);
      const items = await select<PurchaseItem & { unit: string; stock: number }>("SELECT i.*, p.unit, p.quantity AS stock FROM purchase_items i JOIN products p ON p.id = i.product_id WHERE i.purchase_id = ?", [id]);
      return { p, items };
    },
  });
  useEffect(() => {
    if (!existing?.p) return;
    const p = existing.p;
    if (p.status !== "ordered") {
      toast.error("Seules les commandes non réceptionnées peuvent être modifiées.");
      navigate(`/purchases/${id}`, { replace: true });
      return;
    }
    setSupplierId(p.supplier_id);
    setReference(p.reference ?? "");
    setDate(p.purchase_date);
    setWarehouseId(p.warehouse_id);
    setStatus("ordered");
    setNote(p.note ?? "");
    setLines(
      existing.items.map((i) => ({
        product_id: i.product_id,
        name: i.product_name,
        unit: i.unit,
        stock: i.stock,
        quantity: i.quantity,
        unit_cost: i.unit_cost,
        tax_rate: i.tax_rate,
        batch_number: i.batch_number ?? "",
        expiration_date: i.expiration_date ?? "",
      })),
    );
    if (existing.items.some((i) => i.batch_number || i.expiration_date)) setShowBatches(true);
  }, [existing, id, navigate]);

  // Préremplissage depuis « Commander » (?product=&qty=)
  useEffect(() => {
    const pid = search.get("product");
    if (!pid || id) return;
    loadProduct(Number(pid)).then((p) => {
      if (!p) return;
      const q = Number(search.get("qty")) || basicRecommendedQuantity(p.minimum_stock, p.quantity);
      addLine(p, q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLine = (p: ProductOption, q = 1) => {
    setLines((cur) => {
      const ex = cur.find((l) => l.product_id === p.id);
      if (ex) return cur.map((l) => (l.product_id === p.id ? { ...l, quantity: l.quantity + q } : l));
      return [...cur, { product_id: p.id, name: p.name, unit: p.unit, stock: p.quantity, quantity: q, unit_cost: p.purchase_price, tax_rate: p.tax_rate, batch_number: "", expiration_date: "" }];
    });
    if (!supplierId && p.supplier_id) setSupplierId(p.supplier_id);
  };

  useScanHandler(async (code) => {
    const rows = await select<ProductOption>("SELECT id, name, barcode, sku, selling_price, purchase_price, tax_rate, quantity, minimum_stock, unit, image, supplier_id FROM products WHERE barcode = ? AND archived = 0", [code]);
    if (rows[0]) addLine(rows[0]);
    else toast.error("Produit introuvable", { description: code, action: { label: "Créer ce produit", onClick: () => navigate(`/products/new?barcode=${encodeURIComponent(code)}`) } });
  });

  const addLowStock = async () => {
    if (!supplierId) return;
    const rows = await select<ProductOption>(
      "SELECT id, name, barcode, sku, selling_price, purchase_price, tax_rate, quantity, minimum_stock, unit, image, supplier_id FROM products WHERE archived = 0 AND supplier_id = ? AND product_type <> 'service' AND (quantity <= 0 OR (minimum_stock > 0 AND quantity <= minimum_stock)) ORDER BY name",
      [supplierId],
    );
    if (!rows.length) return toast.info("Aucun produit de ce fournisseur n'est en stock faible.");
    rows.forEach((p) => addLine(p, basicRecommendedQuantity(p.minimum_stock, p.quantity)));
    toast.success(`${rows.length} produit(s) ajouté(s).`);
  };

  const update = (pid: number, patch: Partial<Line>) => setLines((cur) => cur.map((l) => (l.product_id === pid ? { ...l, ...patch } : l)));
  const totals = purchaseTotals(lines.map((l) => ({ quantity: l.quantity, unitCost: l.unit_cost, taxRate: l.tax_rate })));
  const errors = {
    supplier: !supplierId ? "Sélectionnez un fournisseur." : undefined,
    lines: !lines.length ? "Ajoutez au moins un produit." : lines.some((l) => !(l.quantity > 0)) ? "Chaque quantité doit être supérieure à zéro." : undefined,
  };

  const submit = async () => {
    setTouched(true);
    if (errors.supplier || errors.lines) {
      toast.error(errors.supplier ?? errors.lines!);
      return;
    }
    const res = await run(
      () =>
        call<{ id: number; number: string }>("purchase_save", {
          input: {
            id,
            supplier_id: supplierId,
            warehouse_id: warehouseId,
            reference: reference || null,
            purchase_date: date,
            status,
            items: lines.map((l) => ({
              product_id: l.product_id,
              quantity: l.quantity,
              unit_cost: l.unit_cost,
              tax_rate: l.tax_rate,
              batch_number: l.batch_number || null,
              expiration_date: l.expiration_date || null,
            })),
            paid_amount: paid ?? 0,
            payment_method: method,
            update_purchase_price: updatePrice,
            note: note || null,
          },
        }),
      { success: status === "received" ? "Achat enregistré. Stock mis à jour." : "Commande fournisseur enregistrée." },
    );
    if (res) navigate(`/purchases/${res.id}`, { replace: true });
  };

  useShortcuts({ "ctrl+s": submit });

  if (id && isLoading) return <LoadingRows />;

  return (
    <Page wide>
      <PageHeader
        back="/purchases"
        title={id ? `Modifier la commande ${existing?.p?.number ?? ""}` : "Nouvel achat"}
        description="Enregistrez une réception de marchandise ou préparez une commande fournisseur."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Annuler
            </Button>
            <Button onClick={submit} loading={pending}>
              <Save /> {status === "received" ? "Enregistrer et mettre en stock" : "Enregistrer la commande"}
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-5 lg:grid-cols-4">
              <Field label="Fournisseur" required error={touched ? errors.supplier : undefined} className="col-span-2">
                <SupplierPicker value={supplierId} onChange={(s) => setSupplierId(s?.id ?? null)} invalid={touched && !!errors.supplier} clearable={false} />
              </Field>
              <Field label="N° facture / référence">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Ex. FA-2026-118" />
              </Field>
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {premium && warehouses.length > 1 && (
                <Field label="Entrepôt de réception" className="col-span-2">
                  <Select value={warehouseId ?? warehouses[0]?.id} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {!id && (
                <div className="col-span-2 grid grid-cols-2 gap-2 lg:col-span-4">
                  {[
                    { v: "received" as const, icon: PackagePlus, t: "Marchandise reçue", d: "Le stock est augmenté immédiatement." },
                    { v: "ordered" as const, icon: CalendarClock, t: "Commande fournisseur", d: "À réceptionner plus tard ; stock inchangé." },
                  ].map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setStatus(o.v)}
                      className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors", status === o.v ? "border-primary bg-primary-soft/50 ring-2 ring-primary/15" : "hover:border-foreground/25")}
                    >
                      <o.icon className={cn("mt-0.5 size-[18px]", status === o.v ? "text-primary" : "text-muted-foreground")} />
                      <span>
                        <span className="block text-[0.8125rem] font-semibold">{o.t}</span>
                        <span className="block text-[0.75rem] text-muted-foreground">{o.d}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Produits"
              description={`${lines.length} ligne(s)`}
              actions={
                <>
                  <label className="mr-2 flex items-center gap-2 text-[0.75rem] text-muted-foreground">
                    <Checkbox checked={showBatches} onCheckedChange={setShowBatches} /> Lots et expiration
                  </label>
                  {supplierId && (
                    <Button variant="secondary" size="sm" onClick={addLowStock}>
                      <Truck /> Ajouter les produits à réapprovisionner
                    </Button>
                  )}
                </>
              }
            />
            <div className="px-5 pb-2 pt-3">
              <ProductFinder onPick={(p) => addLine(p)} showCost placeholder="Scannez ou recherchez un produit à ajouter…" />
            </div>
            {lines.length === 0 ? (
              <EmptyState compact icon={<ShoppingBag />} title="Aucun produit" description="Scannez les articles reçus ou recherchez-les par nom." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="border-y bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-2">Produit</th>
                      <th className="px-2 py-2 text-right">Quantité</th>
                      <th className="px-2 py-2 text-right">Prix d'achat HT</th>
                      <th className="px-2 py-2">TVA</th>
                      {showBatches && <th className="px-2 py-2">Lot</th>}
                      {showBatches && <th className="px-2 py-2">Expiration</th>}
                      <th className="px-2 py-2 text-right">Total TTC</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.product_id} className="border-b last:border-0">
                        <td className="px-5 py-2">
                          <div className="font-medium">{l.name}</div>
                          <div className="text-[0.75rem] text-muted-foreground">
                            Stock actuel : {qty(l.stock)} {unitShort(l.unit)}
                          </div>
                        </td>
                        <td className="px-2">
                          <NumberInput value={l.quantity} onValueChange={(v) => update(l.product_id, { quantity: v ?? 0 })} decimals={3} inputSize="sm" className="ml-auto w-24" />
                        </td>
                        <td className="px-2">
                          <MoneyInput value={l.unit_cost} onValueChange={(v) => update(l.product_id, { unit_cost: v ?? 0 })} inputSize="sm" className="ml-auto w-32" />
                        </td>
                        <td className="px-2">
                          <Select inputSize="sm" className="w-20" value={l.tax_rate} onChange={(e) => update(l.product_id, { tax_rate: Number(e.target.value) })}>
                            {TAX_RATES.map((r) => (
                              <option key={r} value={r}>
                                {r} %
                              </option>
                            ))}
                          </Select>
                        </td>
                        {showBatches && (
                          <td className="px-2">
                            <Input inputSize="sm" className="w-28" value={l.batch_number} onChange={(e) => update(l.product_id, { batch_number: e.target.value })} placeholder="N° lot" />
                          </td>
                        )}
                        {showBatches && (
                          <td className="px-2">
                            <Input inputSize="sm" type="date" className="w-36" value={l.expiration_date} onChange={(e) => update(l.product_id, { expiration_date: e.target.value })} />
                          </td>
                        )}
                        <td className="num px-2 text-right font-semibold">{money(round2(l.quantity * l.unit_cost * (1 + l.tax_rate / 100)))}</td>
                        <td className="pr-3 text-right">
                          <Button variant="ghost" size="icon-xs" onClick={() => setLines((c) => c.filter((x) => x.product_id !== l.product_id))} aria-label="Retirer">
                            <Trash2 />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="section-title mb-3">Récapitulatif</div>
            <div className="space-y-1.5 text-[0.8125rem]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total HT</span>
                <span className="num font-medium">{money(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">TVA</span>
                <span className="num font-medium">{money(totals.tax)}</span>
              </div>
              <div className="flex items-baseline justify-between border-t pt-2.5">
                <span className="font-semibold">Total TTC</span>
                <span className="num text-[1.5rem] font-bold">{money(totals.total)}</span>
              </div>
            </div>
          </Card>
          <Card className="space-y-3.5 p-5">
            <div className="section-title">Paiement au fournisseur</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Montant payé">
                <MoneyInput value={paid} onValueChange={setPaid} allowEmpty placeholder="0,00" />
              </Field>
              <Field label="Mode">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {["cash", "transfer", "cheque", "card", "other"].map((m) => (
                    <option key={m} value={m}>
                      {paymentLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPaid(totals.total)}>
                Tout payer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setPaid(null)}>
                Non payé
              </Button>
            </div>
            <div className="flex justify-between text-[0.8125rem]">
              <span className="text-muted-foreground">Reste dû</span>
              <span className="num font-semibold text-warning">{money(Math.max(0, totals.total - (paid ?? 0)))}</span>
            </div>
          </Card>
          <Card className="space-y-3.5 p-5">
            <label className="flex items-start gap-2.5 text-[0.8125rem]">
              <Checkbox checked={updatePrice} onCheckedChange={setUpdatePrice} />
              <span>
                <span className="font-medium">Mettre à jour les prix d'achat</span>
                <span className="block text-[0.75rem] text-muted-foreground">Le prix d'achat des produits prendra la valeur de cet achat à la réception.</span>
              </span>
            </label>
            <Field label="Notes">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </Card>
        </div>
      </div>
    </Page>
  );
}
