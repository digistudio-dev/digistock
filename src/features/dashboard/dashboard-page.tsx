import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CalendarClock, Coins, PackageX, Receipt, ShoppingBag, ShoppingCart, TrendingUp, Wallet, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { RevenueArea } from "@/components/common/charts";
import { EmptyState, Page } from "@/components/common/page";
import { StockBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton, Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { paymentLabel, unitShort } from "@/i18n";
import { int, money, qty, relative, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useApp, useCan } from "@/stores/app";
import { lowStock, recentActivity, recentSales, revenueSeries, secondaryStats, todayStats, topProducts, type Range } from "./api";

function delta(cur: number, prev: number) {
  if (!prev && !cur) return undefined;
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function StatCard({ label, value, icon: Icon, prev, current, loading, accent }: { label: string; value: string; icon: LucideIcon; prev?: number; current?: number; loading?: boolean; accent?: boolean }) {
  const d = current !== undefined && prev !== undefined ? delta(current, prev) : undefined;
  return (
    <Card className={cn("relative overflow-hidden p-4", accent && "border-primary/25")}>
      {accent && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary" />}
      <div className="flex items-center justify-between">
        <span className="text-[0.8125rem] font-medium text-muted-foreground">{label}</span>
        <span className={cn("flex size-8 items-center justify-center rounded-lg", accent ? "bg-primary-soft text-primary" : "bg-muted text-muted-foreground")}>
          <Icon className="size-4" />
        </span>
      </div>
      {loading ? <Skeleton className="mt-2 h-8 w-32" /> : <div className="num mt-1.5 text-[1.625rem] font-semibold leading-tight tracking-tight">{value}</div>}
      <div className="mt-1.5 h-4 text-[0.75rem]">
        {d === null ? (
          <span className="text-muted-foreground">Aucune vente hier</span>
        ) : d !== undefined ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", d >= 0 ? "text-success" : "text-danger")}>
            {d >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(d).toFixed(0)} %<span className="ml-1 font-normal text-muted-foreground">vs hier</span>
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function MiniStat({ label, value, icon: Icon, tone, to }: { label: string; value: string; icon: LucideIcon; tone?: "warning" | "danger" | "info"; to: string }) {
  return (
    <Link to={to} className="group flex items-center gap-3 rounded-lg border bg-card px-3.5 py-3 shadow-card transition-colors hover:border-foreground/20">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          tone === "danger" ? "bg-danger-soft text-danger" : tone === "warning" ? "bg-warning-soft text-warning" : tone === "info" ? "bg-info-soft text-info" : "bg-muted text-muted-foreground",
        )}
      >
        <Icon className="size-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[0.75rem] text-muted-foreground">{label}</div>
        <div className="num text-[0.9375rem] font-semibold">{value}</div>
      </div>
    </Link>
  );
}

export function DashboardPage() {
  const session = useApp((s) => s.session);
  const navigate = useNavigate();
  const can = useCan();
  const [range, setRange] = useState<Range>("30d");
  const showProfit = can("view_profit");
  const showCost = can("view_purchase_price");
  const full = can("view_dashboard");

  const { data: today, isLoading } = useQuery({ queryKey: ["dash", "today"], queryFn: todayStats, enabled: full, refetchInterval: 60_000 });
  const { data: sec } = useQuery({ queryKey: ["dash", "secondary"], queryFn: secondaryStats, enabled: full });
  const { data: series = [], isLoading: loadingSeries } = useQuery({ queryKey: ["dash", "series", range], queryFn: () => revenueSeries(range), enabled: full });
  const { data: top = [] } = useQuery({ queryKey: ["dash", "top"], queryFn: () => topProducts(30, 6), enabled: full });
  const { data: low = [] } = useQuery({ queryKey: ["dash", "low"], queryFn: () => lowStock(6), enabled: full });
  const { data: recent = [] } = useQuery({ queryKey: ["dash", "recent"], queryFn: () => recentSales(7) });
  const { data: activity = [] } = useQuery({ queryKey: ["dash", "activity"], queryFn: () => recentActivity(7), enabled: full });

  const hour = new Date().getHours();
  const hello = hour < 5 || hour >= 18 ? "Bonsoir" : "Bonjour";
  const firstName = session?.name.split(" ")[0] ?? "";
  const avg = today && today.count ? today.revenue / today.count : 0;
  const yAvg = today && today.y_count ? today.y_revenue / today.y_count : 0;
  const periodTotal = series.reduce((s, p) => s + p.value, 0);
  const maxTop = Math.max(1, ...top.map((t) => t.revenue));

  if (!full) {
    return (
      <Page>
        <div className="mb-6">
          <h1 className="text-[1.5rem] font-semibold">
            {hello}, {firstName}
          </h1>
          <p className="mt-1 text-[0.875rem] text-muted-foreground">Prêt pour vos ventes du jour.</p>
        </div>
        <Card className="mb-4">
          <EmptyState
            icon={<ShoppingCart />}
            title="Encaisser une vente"
            description="Ouvrez la caisse pour scanner les articles et encaisser vos clients."
            actions={
              can("create_sales") && (
                <Button size="lg" onClick={() => navigate("/pos")}>
                  <ShoppingCart /> Nouvelle vente (F2)
                </Button>
              )
            }
          />
        </Card>
        <RecentSales recent={recent} />
      </Page>
    );
  }

  return (
    <Page wide>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-semibold">
            {hello}, {firstName}
          </h1>
          <p className="mt-1 text-[0.875rem] text-muted-foreground">Voici l'activité de votre entreprise aujourd'hui.</p>
        </div>
        <div className="flex gap-2">
          {can("manage_purchases") && (
            <Button variant="secondary" onClick={() => navigate("/purchases/new")}>
              <ShoppingBag /> Nouvel achat
            </Button>
          )}
          {can("create_sales") && (
            <Button onClick={() => navigate("/pos")}>
              <ShoppingCart /> Nouvelle vente
            </Button>
          )}
        </div>
      </div>

      <div className={cn("grid gap-3", showProfit ? "grid-cols-2 xl:grid-cols-4" : "grid-cols-1 sm:grid-cols-3")}>
        <StatCard accent label="Chiffre d'affaires" value={money(today?.revenue)} icon={Coins} current={today?.revenue} prev={today?.y_revenue} loading={isLoading} />
        {showProfit && <StatCard label="Bénéfice" value={money(today?.profit)} icon={TrendingUp} current={today?.profit} prev={today?.y_profit} loading={isLoading} />}
        <StatCard label="Nombre de ventes" value={int(today?.count)} icon={Receipt} current={today?.count} prev={today?.y_count} loading={isLoading} />
        <StatCard label="Panier moyen" value={money(avg)} icon={ShoppingCart} current={avg} prev={yAvg} loading={isLoading} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Produits en stock faible" value={int(sec?.low)} icon={AlertTriangle} tone={sec?.low ? "warning" : undefined} to="/products?level=alert" />
        <MiniStat label="Produits en rupture" value={int(sec?.out)} icon={PackageX} tone={sec?.out ? "danger" : undefined} to="/products?level=out" />
        {showCost && <MiniStat label="Valeur du stock" value={money(sec?.stock_value)} icon={Boxes} to="/reports" />}
        <MiniStat label="Crédits clients" value={money(sec?.credits)} icon={Wallet} tone={sec?.credits ? "info" : undefined} to="/credits" />
        <MiniStat label="Commandes fournisseurs" value={int(sec?.orders)} icon={ShoppingBag} to="/purchases" />
        <MiniStat label="Expirations (30 j)" value={int(sec?.expiring)} icon={CalendarClock} tone={sec?.expiring ? "warning" : undefined} to="/actions" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <Card className="pb-3">
          <CardHeader
            title="Chiffre d'affaires"
            description={
              <span>
                Total sur la période : <span className="num font-semibold text-foreground">{money(periodTotal)}</span>
              </span>
            }
            actions={
              <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                <TabsList>
                  <TabsTrigger value="7d">7 jours</TabsTrigger>
                  <TabsTrigger value="30d">30 jours</TabsTrigger>
                  <TabsTrigger value="12m">12 mois</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
          <div className="px-3 pt-4">{loadingSeries ? <Skeleton className="mx-2 h-[260px]" /> : <RevenueArea data={series} />}</div>
        </Card>
        <Card>
          <CardHeader title="Top produits" description="30 derniers jours" actions={<Link to="/reports" className="text-[0.75rem] font-medium text-primary hover:underline">Rapports</Link>} />
          <div className="space-y-3 px-5 pb-5 pt-4">
            {top.length === 0 ? (
              <p className="py-10 text-center text-[0.8125rem] text-muted-foreground">Aucune vente sur la période.</p>
            ) : (
              top.map((t, i) => (
                <Link key={t.product_id} to={`/products/${t.product_id}`} className="group block">
                  <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="num w-4 text-[0.75rem] text-muted-foreground">{i + 1}</span>
                      <span className="truncate font-medium group-hover:text-primary">{t.name}</span>
                    </span>
                    <span className="num shrink-0 font-semibold">{money(t.revenue)}</span>
                  </div>
                  <div className="ml-6 mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/80" style={{ width: `${(t.revenue / maxTop) * 100}%` }} />
                    </div>
                    <span className="num w-16 text-right text-[0.6875rem] text-muted-foreground">{qty(t.units)} vendus</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Stock faible" description="Produits à réapprovisionner" actions={<Link to="/actions" className="text-[0.75rem] font-medium text-primary hover:underline">Centre d'actions</Link>} />
          {low.length === 0 ? (
            <EmptyState compact title="Tout est en stock" description="Aucun produit sous son stock minimum." />
          ) : (
            <table className="mt-3 w-full text-[0.8125rem]">
              <thead>
                <tr className="border-y bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-5 py-2">Produit</th>
                  <th className="px-3 py-2 text-right">Restant</th>
                  <th className="px-3 py-2 text-right">Minimum</th>
                  <th className="px-3 py-2">Fournisseur</th>
                  <th className="px-5 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {low.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-5 py-2.5">
                      <Link to={`/products/${p.id}`} className="font-medium hover:text-primary">
                        {p.name}
                      </Link>
                      <div className="mt-0.5">
                        <StockBadge quantity={p.quantity} minimum={p.minimum_stock} />
                      </div>
                    </td>
                    <td className={cn("num px-3 text-right font-semibold", p.quantity <= 0 ? "text-danger" : "text-warning")}>
                      {qty(p.quantity)} {unitShort(p.unit)}
                    </td>
                    <td className="num px-3 text-right text-muted-foreground">{qty(p.minimum_stock)}</td>
                    <td className="px-3 text-muted-foreground">{p.supplier_name ?? "—"}</td>
                    <td className="px-5 text-right">
                      {can("manage_purchases") && (
                        <Button size="sm" variant="secondary" onClick={() => navigate(`/purchases/new?product=${p.id}${p.supplier_id ? `&supplier=${p.supplier_id}` : ""}`)}>
                          Commander
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card>
          <CardHeader title="Activité récente" />
          <ol className="space-y-3 px-5 pb-5 pt-4">
            {activity.length === 0 ? (
              <p className="py-6 text-center text-[0.8125rem] text-muted-foreground">Aucune activité.</p>
            ) : (
              activity.map((a) => (
                <li key={a.id} className="flex gap-3 text-[0.8125rem]">
                  <span className="num w-10 shrink-0 pt-px text-[0.75rem] text-muted-foreground">{time(a.created_at)}</span>
                  <span className="min-w-0 leading-snug">
                    {a.description}
                    <span className="block text-[0.6875rem] text-muted-foreground">{relative(a.created_at)}</span>
                  </span>
                </li>
              ))
            )}
          </ol>
        </Card>
      </div>
      <div className="mt-4">
        <RecentSales recent={recent} />
      </div>
    </Page>
  );
}

function RecentSales({ recent }: { recent: { id: number; number: string; total: number; payment_method: string; created_at: string; customer_name: string | null; status: string }[] }) {
  return (
    <Card>
      <CardHeader title="Dernières ventes" actions={<Link to="/sales" className="text-[0.75rem] font-medium text-primary hover:underline">Tout voir</Link>} />
      {recent.length === 0 ? (
        <EmptyState compact title="Aucune vente" description="Vos ventes apparaîtront ici." />
      ) : (
        <table className="mt-3 w-full text-[0.8125rem]">
          <tbody>
            {recent.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="px-5 py-2.5">
                  <Link to={`/sales/${s.id}`} className="font-medium hover:text-primary">
                    {s.number}
                  </Link>
                </td>
                <td className="px-3 text-muted-foreground">{s.customer_name ?? "Client de passage"}</td>
                <td className="px-3 text-muted-foreground">{paymentLabel(s.payment_method)}</td>
                <td className="num px-3 text-muted-foreground">{relative(s.created_at)}</td>
                <td className={cn("num px-5 text-right font-semibold", s.status === "cancelled" && "text-muted-foreground line-through")}>{money(s.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
