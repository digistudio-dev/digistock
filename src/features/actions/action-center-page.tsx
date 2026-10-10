import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, MessageCircle, PackageX, ShoppingBag, Sparkles, Wallet, type LucideIcon } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { ExpiryBadge, PremiumBadge, StockBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { useWhatsApp } from "@/features/whatsapp/composer";
import { unitShort } from "@/i18n";
import { select } from "@/lib/db";
import { date, int, money, qty } from "@/lib/format";
import { fillTemplate } from "@/lib/phone";
import { basicRecommendedQuantity, coverageLabel, daysOfStock, recommendedQuantity } from "@/lib/reorder";
import { cn } from "@/lib/utils";
import { useApp, useCan, usePremium, useSettings } from "@/stores/app";

interface Suggestion {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  minimum_stock: number;
  maximum_stock: number | null;
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  supplier_whatsapp: string | null;
  lead_time_days: number | null;
  sold: number;
}

function SummaryCard({ title, value, sub, icon: Icon, tone, to }: { title: string; value: string; sub: string; icon: LucideIcon; tone: "danger" | "warning" | "info" | "neutral"; to?: string }) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    info: "bg-info-soft text-info",
    neutral: "bg-muted text-muted-foreground",
  };
  const content = (
    <Card className="h-full p-4 transition-colors hover:border-foreground/20">
      <div className={cn("mb-3 flex size-9 items-center justify-center rounded-lg", tones[tone])}>
        <Icon className="size-[18px]" />
      </div>
      <div className="num text-[1.5rem] font-semibold leading-none">{value}</div>
      <div className="mt-1.5 text-[0.8125rem] font-medium">{title}</div>
      <div className="text-[0.75rem] text-muted-foreground">{sub}</div>
    </Card>
  );
  return to ? <Link to={to}>{content}</Link> : content;
}

export function ActionCenterPage() {
  const navigate = useNavigate();
  const can = useCan();
  const premium = usePremium();
  const gate = usePremiumGate();
  const settings = useSettings();
  const company = useApp((s) => s.company);
  const whatsapp = useWhatsApp();
  const lookback = Number(settings["reorder.lookback_days"]) || 30;

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ["actions", "suggestions", lookback],
    queryFn: () =>
      select<Suggestion>(
        `SELECT p.id, p.name, p.unit, p.quantity, p.minimum_stock, p.maximum_stock, p.supplier_id,
                s.name AS supplier_name, s.phone AS supplier_phone, s.whatsapp AS supplier_whatsapp, s.lead_time_days,
                COALESCE((SELECT SUM(si.quantity) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
                          WHERE si.product_id = p.id AND sa.status = 'completed' AND sa.created_at >= date('now','localtime',?)), 0) AS sold
         FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
         WHERE p.archived = 0 AND p.product_type <> 'service' AND (p.quantity <= 0 OR (p.minimum_stock > 0 AND p.quantity <= p.minimum_stock))
         ORDER BY p.quantity <= 0 DESC, p.quantity / NULLIF(p.minimum_stock, 0) ASC LIMIT 100`,
        [`-${lookback} days`],
      ),
  });
  const { data: expiring = [] } = useQuery({
    queryKey: ["actions", "expiring"],
    queryFn: () =>
      select<{ product_id: number; name: string; batch_number: string | null; expiration_date: string; quantity: number; unit: string }>(
        `SELECT p.id AS product_id, p.name, b.batch_number, b.expiration_date, b.quantity, p.unit FROM product_batches b JOIN products p ON p.id = b.product_id
         WHERE p.archived = 0 AND b.quantity > 0 AND b.expiration_date IS NOT NULL AND b.expiration_date <= date('now','localtime',?)
         UNION ALL
         SELECT p.id, p.name, p.batch_number, p.expiration_date, p.quantity, p.unit FROM products p
         WHERE p.archived = 0 AND p.track_batches = 0 AND p.quantity > 0 AND p.expiration_date IS NOT NULL AND p.expiration_date <= date('now','localtime',?)
         ORDER BY expiration_date LIMIT 100`,
        [`+${settings["stock.expiry_warning_days"] || 30} days`, `+${settings["stock.expiry_warning_days"] || 30} days`],
      ),
  });
  const { data: credits } = useQuery({
    queryKey: ["actions", "credits"],
    queryFn: () => select<{ total: number; n: number }>("SELECT COALESCE(SUM(balance),0) AS total, COUNT(*) AS n FROM customers WHERE archived = 0 AND balance > 0").then((r) => r[0]),
  });
  const { data: orders } = useQuery({
    queryKey: ["actions", "orders"],
    queryFn: () => select<{ total: number; n: number }>("SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS n FROM purchases WHERE status = 'ordered'").then((r) => r[0]),
  });

  const critical = suggestions.filter((s) => s.quantity > 0);
  const out = suggestions.filter((s) => s.quantity <= 0);
  const safetyDays = Number(settings["reorder.safety_days"]) || 2;
  const defaultLead = Number(settings["reorder.default_lead_time"]) || 3;

  const enrich = (s: Suggestion) => {
    const avg = s.sold / lookback;
    const lead = s.lead_time_days ?? defaultLead;
    const rec = premium
      ? recommendedQuantity({ avgDailySales: avg, leadTimeDays: lead, safetyDays, minimumStock: s.minimum_stock, currentStock: s.quantity, maximumStock: s.maximum_stock })
      : basicRecommendedQuantity(s.minimum_stock, s.quantity);
    return { avg, lead, rec, days: daysOfStock(s.quantity, avg) };
  };

  const contact = (s: Suggestion, rec: number) =>
    whatsapp({
      title: "Contacter le fournisseur",
      recipientName: s.supplier_name ?? "Fournisseur",
      phone: s.supplier_whatsapp ?? s.supplier_phone,
      message: fillTemplate(settings["whatsapp.template_supplier"], {
        supplier_name: s.supplier_name ?? "",
        product_name: s.name,
        current_stock: `${qty(s.quantity)} ${unitShort(s.unit)}`,
        recommended_quantity: `${qty(rec)} ${unitShort(s.unit)}`,
        company_name: company?.name ?? "",
      }),
      kind: "supplier_order",
      entity: "product",
      entityId: s.id,
    });

  return (
    <Page wide>
      <PageHeader title="Centre d'actions" description="Ce qui mérite votre attention aujourd'hui, avec l'action recommandée." />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard title="Stock critique" value={int(critical.length)} sub="Sous le stock minimum" icon={AlertTriangle} tone={critical.length ? "warning" : "neutral"} to="/products?level=alert" />
        <SummaryCard title="Ruptures" value={int(out.length)} sub="Stock épuisé" icon={PackageX} tone={out.length ? "danger" : "neutral"} to="/products?level=out" />
        <SummaryCard title="Proches de l'expiration" value={int(expiring.length)} sub={`Sous ${settings["stock.expiry_warning_days"] || 30} jours`} icon={CalendarClock} tone={expiring.length ? "warning" : "neutral"} />
        <SummaryCard title="Crédits clients" value={money(credits?.total)} sub={`${int(credits?.n)} client(s)`} icon={Wallet} tone={credits?.total ? "info" : "neutral"} to="/credits" />
        <SummaryCard title="Commandes fournisseurs" value={int(orders?.n)} sub={money(orders?.total)} icon={ShoppingBag} tone="neutral" to="/purchases" />
      </div>

      <Card className="mb-4">
        <CardHeader
          icon={<Sparkles />}
          title="Suggestion de réapprovisionnement"
          description={
            premium
              ? `Basée sur les ventes des ${lookback} derniers jours, le délai fournisseur et ${safetyDays} jour(s) de stock de sécurité.`
              : "Version simple : remonter au double du stock minimum."
          }
          actions={
            !premium && (
              <button onClick={() => gate.open("reorder")} className="flex items-center gap-2 text-[0.75rem] font-medium text-primary hover:underline">
                Suggestions avancées <PremiumBadge />
              </button>
            )
          }
        />
        <div className="p-5 pt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 rounded-lg" />
              ))}
            </div>
          ) : suggestions.length === 0 ? (
            <EmptyState compact icon={<CheckCircle2 />} title="Rien à commander" description="Tous vos produits sont au-dessus de leur stock minimum." />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {suggestions.map((s) => {
                const e = enrich(s);
                return (
                  <div key={s.id} className={cn("flex flex-col rounded-lg border bg-surface p-4", s.quantity <= 0 && "border-danger/30")}>
                    <div className="flex items-start justify-between gap-2">
                      <Link to={`/products/${s.id}`} className="font-semibold leading-snug hover:text-primary">
                        {s.name}
                      </Link>
                      <StockBadge quantity={s.quantity} minimum={s.minimum_stock} />
                    </div>
                    <div className="mt-1 text-[0.8125rem]">
                      <span className={cn("num font-semibold", s.quantity <= 0 ? "text-danger" : "text-warning")}>
                        {qty(s.quantity)} {unitShort(s.unit)}
                      </span>{" "}
                      <span className="text-muted-foreground">restant(s) · minimum {qty(s.minimum_stock)}</span>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-subtle p-3 text-[0.75rem]">
                      <div>
                        <dt className="text-muted-foreground">Stock estimé</dt>
                        <dd className="font-medium">{premium ? coverageLabel(e.days) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Ventes / jour</dt>
                        <dd className="num font-medium">{premium ? qty(Math.round(e.avg * 10) / 10) : "—"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Fournisseur</dt>
                        <dd className="truncate font-medium">{s.supplier_name ?? "Non défini"}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Quantité recommandée</dt>
                        <dd className="num text-[0.875rem] font-bold text-primary">
                          {qty(e.rec)} {unitShort(s.unit)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex gap-2">
                      {can("manage_purchases") && (
                        <Button size="sm" className="flex-1" onClick={() => navigate(`/purchases/new?product=${s.id}&qty=${e.rec}${s.supplier_id ? `&supplier=${s.supplier_id}` : ""}`)}>
                          <ShoppingBag /> Créer commande
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" className="flex-1" disabled={!s.supplier_id} onClick={() => contact(s, e.rec)}>
                        <MessageCircle /> Contacter sur WhatsApp
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon={<CalendarClock />} title="Expirations" description="Lots et produits expirés ou proches de leur date limite." />
        {expiring.length === 0 ? (
          <EmptyState compact title="Aucune expiration proche" />
        ) : (
          <table className="mt-3 w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2">Produit</th>
                <th className="px-3 py-2">Lot</th>
                <th className="px-3 py-2">Expiration</th>
                <th className="px-3 py-2">État</th>
                <th className="px-5 py-2 text-right">Quantité</th>
              </tr>
            </thead>
            <tbody>
              {expiring.map((x, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
                    <Link to={`/products/${x.product_id}`} className="font-medium hover:text-primary">
                      {x.name}
                    </Link>
                  </td>
                  <td className="px-3 text-muted-foreground">{x.batch_number ?? "—"}</td>
                  <td className="num px-3">{date(x.expiration_date)}</td>
                  <td className="px-3">
                    <ExpiryBadge date={x.expiration_date} />
                  </td>
                  <td className="num px-5 text-right">
                    {qty(x.quantity)} {unitShort(x.unit)}
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
