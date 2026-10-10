import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, ScanBarcode, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { NumberInput } from "@/components/common/inputs";
import { EmptyState, ErrorState, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { ProductFinder, findByBarcode, type ProductOption } from "@/components/common/pickers";
import { Kpi } from "@/components/common/stat";
import { Button } from "@/components/ui/button";
import { Badge, Card, Switch } from "@/components/ui/misc";
import { useAction } from "@/hooks/use-action";
import { section, unitShort } from "@/i18n";
import { one, select } from "@/lib/db";
import { dateTime, int, money, qty } from "@/lib/format";
import { call, toAppError } from "@/lib/tauri";
import { cn, round3 } from "@/lib/utils";
import { useCan } from "@/stores/app";
import { useScanHandler } from "@/stores/scan";

interface Session {
  id: number;
  number: string;
  status: "open" | "validated" | "cancelled";
  warehouse_id: number;
  warehouse_name: string;
  notes: string | null;
  created_at: string;
  validated_at: string | null;
}

interface Item {
  product_id: number;
  name: string;
  barcode: string | null;
  unit: string;
  purchase_price: number;
  expected_quantity: number;
  counted_quantity: number;
  difference: number;
  counted_at: string;
}

export function InventorySessionPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const can = useCan();
  const { run, pending } = useAction();
  const [scanIncrement, setScanIncrement] = useState(true);
  const [lastId, setLastId] = useState<number | null>(null);
  const labels = section("inventoryStatus") as Record<string, string>;

  const { data: session, isLoading, error, refetch } = useQuery({
    queryKey: ["inventory", id],
    queryFn: () => one<Session>("SELECT s.*, w.name AS warehouse_name FROM inventory_sessions s JOIN warehouses w ON w.id = s.warehouse_id WHERE s.id = ?", [id]),
  });
  const { data: items = [] } = useQuery({
    queryKey: ["inventory", id, "items"],
    queryFn: () =>
      select<Item>(
        "SELECT i.*, p.name, p.barcode, p.unit, p.purchase_price FROM inventory_items i JOIN products p ON p.id = i.product_id WHERE i.session_id = ? ORDER BY i.counted_at DESC, i.id DESC",
        [id],
      ),
  });

  const open = session?.status === "open";
  const refresh = () => qc.invalidateQueries({ queryKey: ["inventory", id, "items"] });

  const setCount = async (productId: number, counted: number) => {
    try {
      await call("inventory_set_count", { sessionId: id, productId, counted: round3(counted) });
      setLastId(productId);
      refresh();
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  const addProduct = (p: Pick<ProductOption, "id">) => {
    const existing = items.find((i) => i.product_id === p.id);
    if (existing) setCount(p.id, scanIncrement ? existing.counted_quantity + 1 : existing.counted_quantity);
    else setCount(p.id, scanIncrement ? 1 : 0);
  };

  useScanHandler(async (code) => {
    if (!open) return;
    const p = await findByBarcode(code);
    if (p) addProduct(p);
    else toast.error("Produit introuvable", { description: code });
  });

  const validate = async () => {
    const diffs = items.filter((i) => i.difference !== 0).length;
    const ok = await confirm({
      title: "Valider cet inventaire ?",
      description: `${items.length} produit(s) compté(s), ${diffs} écart(s). Les ajustements de stock seront enregistrés automatiquement. Cette action est définitive.`,
      confirmLabel: "Valider l'inventaire",
    });
    if (ok === false) return;
    const n = await run(() => call<number>("inventory_validate", { sessionId: id }));
    if (n !== undefined) toast.success("Inventaire validé.", { description: `${n} ajustement(s) de stock enregistré(s).` });
  };

  const cancel = async () => {
    const ok = await confirm({ title: "Annuler cet inventaire ?", description: "Les comptages seront abandonnés. Le stock n'est pas modifié.", confirmLabel: "Annuler l'inventaire", danger: true });
    if (ok === false) return;
    await run(() => call("inventory_cancel", { sessionId: id }), { success: "Inventaire annulé." });
  };

  if (isLoading) return <LoadingRows />;
  if (error || !session) return <ErrorState error={error ?? new Error("Inventaire introuvable.")} onRetry={refetch} />;

  const diffs = items.filter((i) => i.difference !== 0);
  const valueDiff = items.reduce((s, i) => s + i.difference * i.purchase_price, 0);

  return (
    <Page>
      <PageHeader
        back="/inventory"
        title={`Inventaire ${session.number}`}
        meta={
          <Badge tone={session.status === "validated" ? "success" : session.status === "open" ? "info" : "neutral"} dot>
            {labels[session.status]}
          </Badge>
        }
        description={`${session.warehouse_name} · démarré le ${dateTime(session.created_at)}${session.validated_at ? ` · validé le ${dateTime(session.validated_at)}` : ""}`}
        actions={
          open && (
            <>
              <Button variant="secondary" onClick={cancel}>
                <XCircle /> Annuler
              </Button>
              <Button onClick={validate} loading={pending} disabled={!items.length}>
                <CheckCircle2 /> Valider l'inventaire
              </Button>
            </>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Produits comptés" value={int(items.length)} />
        <Kpi label="Écarts" value={int(diffs.length)} tone={diffs.length ? "warning" : undefined} />
        <Kpi label="Unités comptées" value={qty(items.reduce((s, i) => s + i.counted_quantity, 0))} />
        {can("view_purchase_price") && <Kpi label="Valeur de l'écart" value={money(valueDiff)} tone={valueDiff < 0 ? "danger" : valueDiff > 0 ? "success" : undefined} />}
      </div>
      {open && (
        <Card className="mb-4 p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <ScanBarcode className="size-5" />
            </div>
            <div className="min-w-[280px] flex-1">
              <ProductFinder autoFocus onPick={addProduct} placeholder="Scannez ou recherchez un produit à compter…" />
            </div>
            <label className="flex items-center gap-2 text-[0.8125rem]">
              <Switch checked={scanIncrement} onCheckedChange={setScanIncrement} /> Chaque scan ajoute 1
            </label>
          </div>
        </Card>
      )}
      <Card className="overflow-hidden">
        {items.length === 0 ? (
          <EmptyState icon={<ClipboardCheck />} title="Aucun produit compté" description="Scannez les articles en rayon : chaque scan ajoute une unité au comptage." />
        ) : (
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-b bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">Produit</th>
                <th className="px-3 py-2.5 text-right">Stock théorique</th>
                <th className="px-3 py-2.5 text-right">Stock compté</th>
                <th className="px-3 py-2.5 text-right">Différence</th>
                <th className="w-12 px-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.product_id} className={cn("border-b last:border-0", lastId === i.product_id && "animate-flash")}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{i.name}</div>
                    <div className="text-[0.75rem] text-muted-foreground">{i.barcode ?? "—"}</div>
                  </td>
                  <td className="num px-3 text-right text-muted-foreground">
                    {qty(i.expected_quantity)} {unitShort(i.unit)}
                  </td>
                  <td className="px-3 text-right">
                    {open ? (
                      <NumberInput value={i.counted_quantity} onValueChange={(v) => v !== null && v >= 0 && v !== i.counted_quantity && setCount(i.product_id, v)} decimals={3} inputSize="sm" className="ml-auto w-24" />
                    ) : (
                      <span className="num font-semibold">{qty(i.counted_quantity)}</span>
                    )}
                  </td>
                  <td className={cn("num px-3 text-right font-semibold", i.difference > 0 ? "text-success" : i.difference < 0 ? "text-danger" : "text-muted-foreground")}>
                    {i.difference > 0 ? "+" : ""}
                    {qty(i.difference)}
                  </td>
                  <td className="px-3 text-right">
                    {open && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label="Retirer"
                        onClick={async () => {
                          await call("inventory_remove_item", { sessionId: id, productId: i.product_id });
                          refresh();
                        }}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {!open && (
        <div className="mt-4 text-right">
          <Button variant="ghost" onClick={() => navigate("/stock/movements")}>
            Voir les mouvements de stock
          </Button>
        </div>
      )}
    </Page>
  );
}
