import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Pencil, ShoppingBag, SlidersHorizontal, Tags } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { BarcodeSvg } from "@/components/common/barcode";
import { confirm } from "@/components/common/confirm";
import { EmptyState, ErrorState, InfoRow, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { ProductThumb } from "@/components/common/pickers";
import { Delta, ExpiryBadge, StockBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Badge, Card, Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from "@/components/ui/misc";
import { Kpi } from "@/components/common/stat";
import { useAdjust } from "@/features/stock/adjust-dialog";
import { useAction } from "@/hooks/use-action";
import { movementLabel, unitLabel, unitShort } from "@/i18n";
import { margin } from "@/lib/calc";
import { one, select } from "@/lib/db";
import { date, dateTime, money, percent, qty } from "@/lib/format";
import { call } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useCan, useSettings } from "@/stores/app";
import type { Product } from "@/types";

type Detail = Product & { category_name: string | null; supplier_name: string | null; sold_30: number; revenue_30: number };

interface Movement {
  id: number;
  type: string;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference: string | null;
  reference_type: string | null;
  reference_id: number | null;
  reason: string | null;
  user_name: string | null;
  warehouse_name: string;
  created_at: string;
}

function refLink(m: Movement) {
  if (!m.reference) return null;
  const base = m.reference_type === "sale" ? "/sales/" : m.reference_type === "purchase" ? "/purchases/" : m.reference_type === "inventory" ? "/inventory/" : null;
  return base && m.reference_id ? (
    <Link to={base + m.reference_id} className="font-medium text-primary hover:underline">
      #{m.reference}
    </Link>
  ) : (
    <span className="font-medium">#{m.reference}</span>
  );
}

export function ProductDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const can = useCan();
  const settings = useSettings();
  const openAdjust = useAdjust((s) => s.open);
  const { run } = useAction();
  const showCost = can("view_purchase_price");

  const { data: p, isLoading, error, refetch } = useQuery({
    queryKey: ["product", id, "detail"],
    queryFn: () =>
      one<Detail>(
        `SELECT p.*, c.name AS category_name, s.name AS supplier_name,
          COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = p.id AND sa.status = 'completed' AND sa.created_at >= date('now','localtime','-30 days')), 0) AS sold_30,
          COALESCE((SELECT SUM(si.total) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id WHERE si.product_id = p.id AND sa.status = 'completed' AND sa.created_at >= date('now','localtime','-30 days')), 0) AS revenue_30
         FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?`,
        [id],
      ),
  });
  const { data: movements = [] } = useQuery({
    queryKey: ["product", id, "movements"],
    queryFn: () =>
      select<Movement>(
        `SELECT m.*, u.name AS user_name, w.name AS warehouse_name FROM stock_movements m
         LEFT JOIN users u ON u.id = m.user_id JOIN warehouses w ON w.id = m.warehouse_id
         WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 200`,
        [id],
      ),
  });
  const { data: stocks = [] } = useQuery({
    queryKey: ["product", id, "stocks"],
    queryFn: () => select<{ name: string; quantity: number }>("SELECT w.name, COALESCE(ws.quantity, 0) AS quantity FROM warehouses w LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id AND ws.product_id = ? WHERE w.archived = 0 ORDER BY w.is_default DESC, w.name", [id]),
  });
  const { data: batches = [] } = useQuery({
    queryKey: ["product", id, "batches"],
    queryFn: () => select<{ id: number; batch_number: string | null; expiration_date: string | null; quantity: number; initial_quantity: number; purchase_date: string | null; warehouse: string }>(
      "SELECT b.*, w.name AS warehouse FROM product_batches b JOIN warehouses w ON w.id = b.warehouse_id WHERE b.product_id = ? ORDER BY b.quantity > 0 DESC, b.expiration_date", [id]),
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["product", id, "sales"],
    queryFn: () => select<{ sale_id: number; number: string; created_at: string; quantity: number; unit_price: number; total: number; customer: string | null }>(
      "SELECT s.id AS sale_id, s.number, s.created_at, si.quantity, si.unit_price, si.total, c.name AS customer FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN customers c ON c.id = s.customer_id WHERE si.product_id = ? AND s.status = 'completed' ORDER BY s.id DESC LIMIT 50", [id]),
  });

  if (isLoading) return <LoadingRows />;
  if (error || !p) return <ErrorState error={error ?? new Error("Produit introuvable.")} onRetry={refetch} />;

  const m = margin(p.selling_price, p.purchase_price, p.tax_rate, settings["sales.prices_include_tax"]);
  const stockValue = p.quantity * p.purchase_price;

  const archive = async () => {
    if (!p.archived) {
      const ok = await confirm({ title: `Archiver « ${p.name} » ?`, description: "Le produit sera masqué de la caisse. L'historique est conservé.", confirmLabel: "Archiver" });
      if (ok === false) return;
    }
    await run(() => call("entity_archive", { table: "products", id, archived: !p.archived }), { success: p.archived ? "Produit restauré." : "Produit archivé." });
  };

  const duplicate = async () => {
    const nid = await run(() => call<number>("product_duplicate", { id }), { success: "Produit dupliqué." });
    if (nid) navigate(`/products/${nid}/edit`);
  };

  return (
    <Page>
      <PageHeader
        back="/products"
        title={
          <span className="flex items-center gap-3">
            <ProductThumb image={p.image} className="size-10" />
            {p.name}
          </span>
        }
        meta={
          <>
            {p.product_type !== "service" && <StockBadge quantity={p.quantity} minimum={p.minimum_stock} />}
            {p.archived ? <Badge>Archivé</Badge> : null}
            <ExpiryBadge date={p.expiration_date} />
          </>
        }
        actions={
          <>
            {can("manage_products") && (
              <Button variant="secondary" onClick={archive}>
                {p.archived ? <ArchiveRestore /> : <Archive />} {p.archived ? "Restaurer" : "Archiver"}
              </Button>
            )}
            {can("manage_products") && (
              <Button variant="secondary" onClick={duplicate}>
                <Copy /> Dupliquer
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate(`/products/labels?ids=${id}`)}>
              <Tags /> Étiquettes
            </Button>
            {can("manage_purchases") && (
              <Button variant="secondary" onClick={() => navigate(`/purchases/new?product=${id}${p.supplier_id ? `&supplier=${p.supplier_id}` : ""}`)}>
                <ShoppingBag /> Commander
              </Button>
            )}
            {can("manage_stock") && !p.archived && (
              <Button variant="secondary" onClick={() => openAdjust(id)}>
                <SlidersHorizontal /> Ajuster le stock
              </Button>
            )}
            {can("manage_products") && (
              <Button onClick={() => navigate(`/products/${id}/edit`)}>
                <Pencil /> Modifier
              </Button>
            )}
          </>
        }
      />

      <div className={cn("mb-4 grid gap-3", showCost ? "grid-cols-2 lg:grid-cols-5" : "grid-cols-2 lg:grid-cols-3")}>
        <Kpi label="Stock actuel" value={`${qty(p.quantity)} ${unitShort(p.unit)}`} hint={p.minimum_stock ? `Minimum : ${qty(p.minimum_stock)}` : undefined} />
        {showCost && <Kpi label="Prix d'achat" value={money(p.purchase_price)} hint="HT" />}
        <Kpi label="Prix de vente" value={money(p.selling_price)} hint={`TVA ${p.tax_rate} %`} />
        {showCost && <Kpi label="Marge" value={money(m.value)} hint={percent(m.rate)} tone={m.value < 0 ? "danger" : "success"} />}
        {showCost ? <Kpi label="Valeur totale du stock" value={money(stockValue)} hint="Au prix d'achat" /> : <Kpi label="Vendus (30 jours)" value={qty(p.sold_30)} hint={money(p.revenue_30)} />}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <Tabs defaultValue="movements">
            <UnderlineTabsList>
              <UnderlineTabsTrigger value="movements">Mouvements</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="sales">Ventes</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="warehouses">Stock par entrepôt</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="batches">Lots ({batches.length})</UnderlineTabsTrigger>
            </UnderlineTabsList>
            <TabsContent value="movements" className="pt-4">
              {movements.length === 0 ? (
                <EmptyState compact title="Aucun mouvement" description="Les entrées et sorties de stock apparaîtront ici." />
              ) : (
                <ol className="relative ml-2 border-l">
                  {movements.map((mv) => (
                    <li key={mv.id} className="relative pb-4 pl-6 last:pb-0">
                      <span className={cn("absolute -left-[5px] top-1.5 size-2.5 rounded-full ring-4 ring-card", mv.quantity > 0 ? "bg-success" : "bg-danger")} />
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[0.8125rem]">
                        <Delta value={mv.quantity} />
                        <span className="font-medium">{movementLabel(mv.type)}</span>
                        {refLink(mv)}
                        <span className="ml-auto text-[0.75rem] text-muted-foreground">{dateTime(mv.created_at)}</span>
                      </div>
                      <div className="mt-0.5 text-[0.75rem] text-muted-foreground">
                        <span className="num">
                          {qty(mv.quantity_before)} → {qty(mv.quantity_after)}
                        </span>
                        {stocks.length > 1 && <> · {mv.warehouse_name}</>}
                        {mv.user_name && <> · {mv.user_name}</>}
                        {mv.reason && <> · {mv.reason}</>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
            <TabsContent value="sales" className="pt-3">
              {sales.length === 0 ? (
                <EmptyState compact title="Aucune vente" description="Ce produit n'a pas encore été vendu." />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.sale_id + "-" + s.created_at} className="border-b last:border-0">
                        <td className="py-2">
                          <Link to={`/sales/${s.sale_id}`} className="font-medium hover:text-primary">
                            {s.number}
                          </Link>
                          <div className="text-[0.75rem] text-muted-foreground">{s.customer ?? "Client de passage"}</div>
                        </td>
                        <td className="num text-muted-foreground">{dateTime(s.created_at)}</td>
                        <td className="num text-right">× {qty(s.quantity)}</td>
                        <td className="num text-right font-semibold">{money(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
            <TabsContent value="warehouses" className="pt-3">
              <table className="w-full text-[0.8125rem]">
                <tbody>
                  {stocks.map((s) => (
                    <tr key={s.name} className="border-b">
                      <td className="py-2.5 font-medium">{s.name}</td>
                      <td className="num py-2.5 text-right">
                        {qty(s.quantity)} {unitShort(p.unit)}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2.5 font-semibold">Total</td>
                    <td className="num py-2.5 text-right font-bold">
                      {qty(p.quantity)} {unitShort(p.unit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </TabsContent>
            <TabsContent value="batches" className="pt-3">
              {batches.length === 0 ? (
                <EmptyState compact title="Aucun lot" description="Les lots sont créés lors des achats avec un n° de lot ou une date d'expiration." />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <thead>
                    <tr className="text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2">Lot</th>
                      <th className="pb-2">Entrepôt</th>
                      <th className="pb-2">Expiration</th>
                      <th className="pb-2 text-right">Restant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id} className={cn("border-t", b.quantity <= 0 && "opacity-50")}>
                        <td className="py-2 font-medium">{b.batch_number ?? "—"}</td>
                        <td className="py-2 text-muted-foreground">{b.warehouse}</td>
                        <td className="py-2">
                          <span className="num mr-2">{date(b.expiration_date)}</span>
                          {b.quantity > 0 && <ExpiryBadge date={b.expiration_date} />}
                        </td>
                        <td className="num py-2 text-right">
                          {qty(b.quantity)} / {qty(b.initial_quantity)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
          </Tabs>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="eyebrow mb-1">Détails</div>
            <InfoRow label="Catégorie">{p.category_name ?? "—"}</InfoRow>
            <InfoRow label="Fournisseur">
              {p.supplier_id ? (
                <Link to={`/suppliers/${p.supplier_id}`} className="hover:text-primary">
                  {p.supplier_name}
                </Link>
              ) : (
                "—"
              )}
            </InfoRow>
            <InfoRow label="Marque">{p.brand ?? "—"}</InfoRow>
            <InfoRow label="SKU">{p.sku ?? "—"}</InfoRow>
            <InfoRow label="Unité">{unitLabel(p.unit)}</InfoRow>
            <InfoRow label="Emplacement">{p.location ?? "—"}</InfoRow>
            <InfoRow label="Stock min. / max.">
              {qty(p.minimum_stock)} / {p.maximum_stock ? qty(p.maximum_stock) : "—"}
            </InfoRow>
            <InfoRow label="Lot / expiration">
              {p.batch_number ?? "—"} · {date(p.expiration_date)}
            </InfoRow>
            <InfoRow label="Vendus (30 j)">{qty(p.sold_30)}</InfoRow>
            <InfoRow label="Créé le">{date(p.created_at)}</InfoRow>
            {p.description && <p className="mt-2 border-t pt-3 text-[0.8125rem] text-muted-foreground">{p.description}</p>}
          </Card>
          {p.barcode && (
            <Card className="p-5">
              <div className="eyebrow mb-3">Code-barres</div>
              <div className="flex justify-center rounded-lg bg-white p-3 text-black">
                <BarcodeSvg value={p.barcode} height={50} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
