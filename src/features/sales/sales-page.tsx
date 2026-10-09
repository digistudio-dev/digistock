import { Ban, Download, Eye, FileDown, Printer, ReceiptText, ShoppingCart } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { SaleStatusBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/menu";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { useAction } from "@/hooks/use-action";
import { confirm } from "@/components/common/confirm";
import { paymentLabel } from "@/i18n";
import { toCsv } from "@/lib/csv";
import { like, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { dateTime, money } from "@/lib/format";
import { printSaleReceipt, saveSaleReceiptPdf } from "@/lib/receipts";
import { call } from "@/lib/tauri";
import { useCan } from "@/stores/app";
import type { Sale } from "@/types";
import { toast } from "sonner";

type Row = Sale & { customer_name: string | null; user_name: string | null; items: number };

const SORTS = { number: "s.id", created_at: "s.created_at", total: "s.total", profit: "s.profit", customer_name: "c.name" };

function buildQuery(search: string, f: { status: string; method: string; from: string; to: string }) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (search) {
    where.push("(s.number LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')");
    params.push(like(search), like(search));
  }
  if (f.status) {
    where.push("s.status = ?");
    params.push(f.status);
  }
  if (f.method) {
    where.push("s.payment_method = ?");
    params.push(f.method);
  }
  if (f.from) {
    where.push("date(s.created_at) >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("date(s.created_at) <= ?");
    params.push(f.to);
  }
  return {
    sql: `SELECT s.*, c.name AS customer_name, u.name AS user_name, (SELECT COUNT(*) FROM sale_items WHERE sale_id = s.id) AS items
          FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
          WHERE ${where.join(" AND ")}`,
    params,
  };
}

export function SalesPage() {
  const navigate = useNavigate();
  const can = useCan();
  const showProfit = can("view_profit");
  const { run } = useAction();
  const t = useTableState([{ id: "created_at", desc: true }], { status: "", method: "", from: "", to: "" });
  const q = buildQuery(t.search, t.filters);
  const { data, isLoading } = usePagedQuery(["sales", t.search, t.filters, t.page, t.pageSize, t.sort], () =>
    paged<Row>(q.sql, q.params, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "s.id DESC") }),
  );

  const cancelSale = async (s: Row) => {
    const reason = await confirm({
      title: "Annuler cette vente ?",
      description: `${s.number} — ${money(s.total)}. Le stock associé sera automatiquement restauré.`,
      confirmLabel: "Confirmer l'annulation",
      danger: true,
      reason: { label: "Motif de l'annulation", placeholder: "Ex. erreur de saisie, retour client…" },
    });
    if (reason === false) return;
    await run(() => call("sale_cancel", { id: s.id, reason }), { success: "Vente annulée. Le stock a été restauré." });
  };

  const exportCsv = async () => {
    const rows = await select<Row>(q.sql + " ORDER BY s.id DESC", q.params);
    const csv = toCsv(
      rows.map((r) => ({ ...r, payment_method: paymentLabel(r.payment_method), status: r.status === "cancelled" ? "Annulée" : "Validée" })),
      [
        { key: "number", label: "Numéro" },
        { key: "created_at", label: "Date" },
        { key: "customer_name", label: "Client" },
        { key: "user_name", label: "Vendeur" },
        { key: "payment_method", label: "Paiement" },
        { key: "subtotal", label: "Sous-total" },
        { key: "discount_total", label: "Remise" },
        { key: "tax_total", label: "TVA" },
        { key: "total", label: "Total" },
        ...(showProfit ? [{ key: "profit", label: "Bénéfice" }] : []),
        { key: "status", label: "Statut" },
      ],
    );
    const path = await saveCsv(`ventes-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "number",
        header: "N° vente",
        cell: ({ row }) => <span className="font-semibold">{row.original.number}</span>,
      },
      { id: "created_at", header: "Date", cell: ({ row }) => <span className="num text-muted-foreground">{dateTime(row.original.created_at)}</span> },
      { id: "customer_name", header: "Client", meta: { label: "Client" }, cell: ({ row }) => row.original.customer_name ?? <span className="text-muted-foreground">Client de passage</span> },
      { id: "items", header: "Articles", enableSorting: false, meta: { align: "right", label: "Articles" }, cell: ({ row }) => row.original.items },
      { id: "payment", header: "Paiement", enableSorting: false, meta: { label: "Paiement" }, cell: ({ row }) => paymentLabel(row.original.payment_method) },
      { id: "user_name", header: "Vendeur", enableSorting: false, meta: { label: "Vendeur" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.user_name ?? "—"}</span> },
      { id: "status", header: "Statut", enableSorting: false, cell: ({ row }) => <SaleStatusBadge status={row.original.status} /> },
      ...(showProfit
        ? [{ id: "profit", header: "Bénéfice", meta: { align: "right" as const, label: "Bénéfice" }, cell: ({ row }: { row: { original: Row } }) => <span className="text-success">{money(row.original.profit)}</span> }]
        : []),
      {
        id: "total",
        header: "Total",
        meta: { align: "right" },
        cell: ({ row }) => <span className={row.original.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold"}>{money(row.original.total)}</span>,
      },
    ],
    [showProfit],
  );

  return (
    <Page>
      <PageHeader
        title="Historique des ventes"
        description="Toutes les ventes enregistrées, avec reçus et annulations."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download /> Exporter CSV
            </Button>
            {can("create_sales") && (
              <Button onClick={() => navigate("/pos")}>
                <ShoppingCart /> Nouvelle vente
              </Button>
            )}
          </>
        }
      />
      <DataTable
        columns={columns}
        data={data?.rows ?? []}
        total={data?.total}
        loading={isLoading}
        page={t.page}
        pageSize={t.pageSize}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        sorting={t.sorting}
        onSortingChange={t.setSorting}
        visibilityKey="sales"
        onRowClick={(r) => navigate(`/sales/${r.id}`)}
        rowClassName={(r) => (r.status === "cancelled" ? "opacity-70" : undefined)}
        toolbar={
          <>
            <SearchInput value={t.search} onChange={t.setSearch} placeholder="N° de vente ou client…" />
            <Select inputSize="sm" className="w-36" value={t.filters.status} onChange={(e) => t.setFilter("status", e.target.value)}>
              <option value="">Tous statuts</option>
              <option value="completed">Validées</option>
              <option value="cancelled">Annulées</option>
            </Select>
            <Select inputSize="sm" className="w-40" value={t.filters.method} onChange={(e) => t.setFilter("method", e.target.value)}>
              <option value="">Tous paiements</option>
              {["cash", "card", "transfer", "credit", "other"].map((m) => (
                <option key={m} value={m}>
                  {paymentLabel(m)}
                </option>
              ))}
            </Select>
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.from} onChange={(e) => t.setFilter("from", e.target.value)} aria-label="Du" />
            <span className="text-muted-foreground">→</span>
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.to} onChange={(e) => t.setFilter("to", e.target.value)} aria-label="Au" />
          </>
        }
        contextMenu={(r) => (
          <>
            <ContextMenuItem onSelect={() => navigate(`/sales/${r.id}`)}>
              <Eye /> Voir
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => printSaleReceipt(r.id)}>
              <Printer /> Imprimer le ticket
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => saveSaleReceiptPdf(r.id, "a4")}>
              <FileDown /> Facture PDF
            </ContextMenuItem>
            {can("cancel_sales") && r.status === "completed" && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem danger onSelect={() => cancelSale(r)}>
                  <Ban /> Annuler la vente
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        empty={
          <EmptyState
            icon={<ReceiptText />}
            title={t.search || Object.values(t.filters).some(Boolean) ? "Aucune vente trouvée" : "Aucune vente"}
            description={t.search ? "Modifiez votre recherche ou vos filtres." : "Vos ventes apparaîtront ici dès votre premier encaissement."}
            actions={
              can("create_sales") && (
                <Button onClick={() => navigate("/pos")}>
                  <ShoppingCart /> Nouvelle vente
                </Button>
              )
            }
          />
        }
      />
    </Page>
  );
}
