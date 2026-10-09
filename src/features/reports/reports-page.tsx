import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, FileDown, Lock, Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SimpleBars } from "@/components/common/charts";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { Kpi } from "@/components/common/stat";
import { PremiumBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Card, CardHeader, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { toCsv } from "@/lib/csv";
import { saveCsv, savePdf } from "@/lib/files";
import { int, money, percent } from "@/lib/format";
import { reportPdf, toBase64 } from "@/lib/pdf/common";
import { escapeHtml, printHtml } from "@/lib/print";
import { useApp, useCan, usePremium } from "@/stores/app";
import { customerSections, fmtCell, paymentsSection, productSections, resolvePeriod, salesByPeriod, salesSummary, supplierSections, type Grouping, type PeriodKey, type Section } from "./report-data";

type Tab = "sales" | "products" | "customers" | "suppliers";

function SectionTable({ s }: { s: Section }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader title={s.title} description={`${s.rows.length} ligne(s)`} className="pb-3" />
      {s.rows.length === 0 ? (
        <EmptyState compact title="Aucune donnée sur la période" />
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-[0.8125rem]">
            <thead className="sticky top-0">
              <tr className="border-y bg-subtle text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.columns.map((c) => (
                  <th key={c.key} className={"px-4 py-2 " + (c.align === "right" ? "text-right" : "text-left")}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i} className="border-b last:border-0">
                  {s.columns.map((c, j) => (
                    <td key={c.key} className={"px-4 py-2 " + (c.align === "right" ? "num text-right" : "") + (j === 0 ? " font-medium" : "")}>
                      {fmtCell(c, r[c.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function LockedSection({ title, onUnlock }: { title: string; onUnlock: () => void }) {
  return (
    <Card className="flex items-center justify-between gap-4 p-5">
      <div className="flex items-center gap-3">
        <Lock className="size-4 text-muted-foreground" />
        <div>
          <div className="text-[0.875rem] font-semibold">{title}</div>
          <div className="text-[0.75rem] text-muted-foreground">Disponible avec les rapports avancés.</div>
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={onUnlock}>
        Découvrir <PremiumBadge />
      </Button>
    </Card>
  );
}

export function ReportsPage() {
  const premium = usePremium();
  const gate = usePremiumGate();
  const can = useCan();
  const company = useApp((s) => s.company);
  const showProfit = can("view_profit");
  const [tab, setTab] = useState<Tab>("sales");
  const [periodKey, setPeriodKey] = useState<PeriodKey>("30d");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const [grouping, setGrouping] = useState<Grouping>("day");
  const period = resolvePeriod(periodKey, custom);

  const { data: summary, isLoading: loadingSummary } = useQuery({ queryKey: ["reports", "summary", period], queryFn: () => salesSummary(period) });
  const { data: byPeriod } = useQuery({ queryKey: ["reports", "period", period, grouping], queryFn: () => salesByPeriod(period, grouping) });
  const { data: payments } = useQuery({ queryKey: ["reports", "payments", period], queryFn: () => paymentsSection(period), enabled: tab === "sales" });
  const { data: products } = useQuery({ queryKey: ["reports", "products", period, premium], queryFn: () => productSections(period, premium), enabled: tab === "products" });
  const { data: customers } = useQuery({ queryKey: ["reports", "customers", period], queryFn: () => customerSections(period), enabled: tab === "customers" && premium });
  const { data: suppliers } = useQuery({ queryKey: ["reports", "suppliers", period], queryFn: () => supplierSections(period), enabled: tab === "suppliers" && premium });

  const stripProfit = (s: Section): Section => (showProfit ? s : { ...s, columns: s.columns.filter((c) => c.key !== "profit") });
  const currentSections = (): Section[] => {
    const list =
      tab === "sales" ? [byPeriod, payments] : tab === "products" ? (products ?? []).filter((s) => !s.premium || premium) : tab === "customers" ? customers ?? [] : suppliers ?? [];
    return (list.filter(Boolean) as Section[]).map(stripProfit);
  };
  const kpis = () => [
    { label: "Chiffre d'affaires", value: money(summary?.revenue) },
    ...(showProfit ? [{ label: "Bénéfice", value: money(summary?.profit) }] : []),
    { label: "Ventes", value: int(summary?.count) },
    { label: "Panier moyen", value: money(summary && summary.count ? summary.revenue / summary.count : 0) },
    { label: "Remises", value: money(summary?.discounts) },
    { label: "TVA", value: money(summary?.tax) },
  ];
  const TITLES: Record<Tab, string> = { sales: "Rapport des ventes", products: "Rapport produits", customers: "Rapport clients", suppliers: "Rapport fournisseurs" };

  const exportPdf = async () => {
    if (tab !== "sales" && !premium && tab !== "products") return gate.open("advanced_reports");
    try {
      const doc = await reportPdf({
        company: company ?? { name: "DigiStock" },
        title: TITLES[tab].toUpperCase(),
        subtitle: period.label,
        kpis: tab === "sales" ? kpis() : undefined,
        sections: currentSections().map((s) => ({
          title: s.title,
          head: s.columns.map((c) => c.label),
          rows: s.rows.map((r) => s.columns.map((c) => fmtCell(c, r[c.key]))),
          rightCols: s.columns.map((c, i) => (c.align === "right" ? i : -1)).filter((i) => i >= 0),
        })),
      });
      const path = await savePdf(`${TITLES[tab].toLowerCase().replace(/\s+/g, "-")}-${period.from}-${period.to}.pdf`, toBase64(doc));
      if (path) toast.success("Rapport PDF enregistré.", { description: path });
    } catch (e) {
      toast.error("Génération du PDF impossible.", { description: e instanceof Error ? e.message : undefined });
    }
  };

  const exportCsv = async () => {
    const sections = currentSections();
    if (!sections.length) return;
    const csv = sections
      .map((s) => `${s.title}\r\n` + toCsv(s.rows.map((r) => Object.fromEntries(s.columns.map((c) => [c.key, c.format ? c.format(r[c.key]) : r[c.key]]))), s.columns).replace(/^﻿/, ""))
      .join("\r\n\r\n");
    const path = await saveCsv(`${TITLES[tab].toLowerCase().replace(/\s+/g, "-")}-${period.from}-${period.to}.csv`, "﻿" + csv);
    if (path) toast.success("Export CSV terminé.", { description: path });
  };

  const print = () => {
    const sections = currentSections();
    const html = `
      <style>
        h1 { font-size: 18px; margin: 0; } .sub { color: #666; font-size: 11px; margin: 4px 0 16px; }
        .k { display: inline-block; border: 1px solid #ddd; border-radius: 6px; padding: 6px 10px; margin: 0 6px 6px 0; font-size: 11px; }
        .k b { display: block; font-size: 14px; }
        h2 { font-size: 13px; margin: 18px 0 6px; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        th { text-align: left; background: #f3f4f6; padding: 5px; } td { padding: 5px; border-bottom: 1px solid #eee; }
        .r { text-align: right; }
      </style>
      <h1>${escapeHtml(company?.name ?? "")} — ${escapeHtml(TITLES[tab])}</h1>
      <div class="sub">${escapeHtml(period.label)} · DigiStock par DigiStudio</div>
      ${tab === "sales" ? kpis().map((k) => `<span class="k">${escapeHtml(k.label)}<b>${escapeHtml(k.value)}</b></span>`).join("") : ""}
      ${sections
        .map(
          (s) => `<h2>${escapeHtml(s.title)}</h2><table><thead><tr>${s.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${escapeHtml(c.label)}</th>`).join("")}</tr></thead>
          <tbody>${s.rows.map((r) => `<tr>${s.columns.map((c) => `<td class="${c.align === "right" ? "r" : ""}">${escapeHtml(fmtCell(c, r[c.key]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
        )
        .join("")}`;
    printHtml(html);
  };

  useShortcuts({ "ctrl+p": print });

  const chartData = (byPeriod?.rows ?? []).map((r) => ({ label: byPeriod?.columns[0].format?.(r.period) ?? String(r.period), value: Number(r.revenue) }));
  const margin = summary && summary.revenue ? (summary.profit / (summary.revenue - summary.tax)) * 100 : 0;

  return (
    <Page wide>
      <PageHeader
        title="Rapports"
        description="Analysez vos ventes, vos produits, vos clients et vos fournisseurs."
        actions={
          <>
            <Button variant="secondary" onClick={print}>
              <Printer /> Imprimer
            </Button>
            <Button variant="secondary" onClick={exportCsv}>
              <Download /> CSV
            </Button>
            <Button onClick={exportPdf}>
              <FileDown /> Exporter PDF
            </Button>
          </>
        }
      />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <Select inputSize="sm" className="w-48" value={periodKey} onChange={(e) => setPeriodKey(e.target.value as PeriodKey)}>
          <option value="today">Aujourd'hui</option>
          <option value="7d">7 derniers jours</option>
          <option value="30d">30 derniers jours</option>
          <option value="month">Ce mois-ci</option>
          <option value="last_month">Mois dernier</option>
          <option value="year">Cette année</option>
          <option value="custom">Période personnalisée</option>
        </Select>
        {periodKey === "custom" && (
          <>
            <Input inputSize="sm" type="date" className="w-[150px]" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="text-muted-foreground">→</span>
            <Input inputSize="sm" type="date" className="w-[150px]" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
        <span className="ml-2 text-[0.8125rem] text-muted-foreground">{period.label}</span>
      </Card>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-4">
          <TabsTrigger value="sales">Ventes</TabsTrigger>
          <TabsTrigger value="products">Produits</TabsTrigger>
          <TabsTrigger value="customers">Clients {!premium && <Lock />}</TabsTrigger>
          <TabsTrigger value="suppliers">Fournisseurs {!premium && <Lock />}</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="space-y-4">
          <div className={"grid gap-3 " + (showProfit ? "grid-cols-2 lg:grid-cols-6" : "grid-cols-2 lg:grid-cols-5")}>
            {loadingSummary
              ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[84px] rounded-lg" />)
              : [
                  <Kpi key="r" label="Chiffre d'affaires" value={money(summary?.revenue)} />,
                  showProfit && <Kpi key="p" label="Bénéfice" value={money(summary?.profit)} hint={`Marge ${percent(margin)}`} tone="success" />,
                  <Kpi key="c" label="Nombre de ventes" value={int(summary?.count)} hint={summary?.cancelled ? `${summary.cancelled} annulée(s)` : undefined} />,
                  <Kpi key="a" label="Panier moyen" value={money(summary && summary.count ? summary.revenue / summary.count : 0)} />,
                  <Kpi key="d" label="Remises" value={money(summary?.discounts)} />,
                  <Kpi key="t" label="TVA collectée" value={money(summary?.tax)} />,
                ]}
          </div>
          <Card className="pb-3">
            <CardHeader
              icon={<BarChart3 />}
              title="Chiffre d'affaires"
              actions={
                <Select inputSize="sm" className="w-36" value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
                  <option value="day">Par jour</option>
                  <option value="week">Par semaine</option>
                  <option value="month">Par mois</option>
                </Select>
              }
            />
            <div className="px-3 pt-4">{chartData.length ? <SimpleBars data={chartData} height={260} /> : <EmptyState compact title="Aucune vente sur la période" />}</div>
          </Card>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_420px]">
            {byPeriod && <SectionTable s={stripProfit(byPeriod)} />}
            {payments && <SectionTable s={payments} />}
          </div>
        </TabsContent>

        <TabsContent value="products" className="space-y-4">
          {(products ?? []).map((s) => (s.premium && !premium ? <LockedSection key={s.id} title={s.title} onUnlock={() => gate.open("advanced_reports")} /> : <SectionTable key={s.id} s={stripProfit(s)} />))}
          {!products && <Skeleton className="h-64 rounded-lg" />}
        </TabsContent>

        <TabsContent value="customers" className="space-y-4">
          {premium ? (customers ?? []).map((s) => <SectionTable key={s.id} s={stripProfit(s)} />) : <LockedSection title="Meilleurs clients et crédits" onUnlock={() => gate.open("advanced_reports")} />}
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          {premium ? (suppliers ?? []).map((s) => <SectionTable key={s.id} s={s} />) : <LockedSection title="Achats par fournisseur et soldes à payer" onUnlock={() => gate.open("advanced_reports")} />}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
