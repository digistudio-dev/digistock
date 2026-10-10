import { useQuery } from "@tanstack/react-query";
import { Boxes, Download, Plus } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Kpi } from "@/components/common/stat";
import { PurchaseStatusBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { toCsv } from "@/lib/csv";
import { like, one, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { date, int, money } from "@/lib/format";
import type { Purchase } from "@/types";

type Row = Purchase & { supplier_name: string; items: number };
const SORTS = { number: "p.id", purchase_date: "p.purchase_date", total: "p.total", supplier: "s.name" };

function query(search: string, f: { status: string; from: string; to: string }) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (search) {
    where.push("(p.number LIKE ? ESCAPE '\\' OR p.reference LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");
    params.push(like(search), like(search), like(search));
  }
  if (f.status) {
    where.push("p.status = ?");
    params.push(f.status);
  }
  if (f.from) {
    where.push("p.purchase_date >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("p.purchase_date <= ?");
    params.push(f.to);
  }
  return {
    sql: `SELECT p.*, s.name AS supplier_name, (SELECT COUNT(*) FROM purchase_items WHERE purchase_id = p.id) AS items
          FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE ${where.join(" AND ")}`,
    params,
  };
}

export function PurchasesPage() {
  const navigate = useNavigate();
  const t = useTableState([{ id: "number", desc: true }], { status: "", from: "", to: "" });
  const q = query(t.search, t.filters);
  const { data, isLoading } = usePagedQuery(["purchases", t.search, t.filters, t.page, t.pageSize, t.sort], () =>
    paged<Row>(q.sql, q.params, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "p.id DESC") }),
  );
  const { data: stats } = useQuery({
    queryKey: ["purchases", "stats"],
    queryFn: () =>
      one<{ month: number; ordered: number; ordered_total: number; debt: number }>(
        `SELECT
          COALESCE((SELECT SUM(total) FROM purchases WHERE status = 'received' AND purchase_date >= date('now','localtime','start of month')), 0) AS month,
          (SELECT COUNT(*) FROM purchases WHERE status = 'ordered') AS ordered,
          COALESCE((SELECT SUM(total) FROM purchases WHERE status = 'ordered'), 0) AS ordered_total,
          COALESCE((SELECT SUM(balance) FROM suppliers WHERE archived = 0 AND balance > 0), 0) AS debt`,
      ),
  });

  const exportCsv = async () => {
    const rows = await select<Row>(q.sql + " ORDER BY p.id DESC", q.params);
    const csv = toCsv(rows as never, [
      { key: "number", label: "Numéro" },
      { key: "purchase_date", label: "Date" },
      { key: "supplier_name", label: "Fournisseur" },
      { key: "reference", label: "Référence" },
      { key: "status", label: "Statut" },
      { key: "subtotal", label: "Total HT" },
      { key: "tax_total", label: "TVA" },
      { key: "total", label: "Total TTC" },
      { key: "paid_amount", label: "Payé" },
    ]);
    const path = await saveCsv(`achats-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "number", header: "N°", cell: ({ row }) => <span className="font-semibold">{row.original.number}</span> },
      { id: "purchase_date", header: "Date", cell: ({ row }) => <span className="num text-muted-foreground">{date(row.original.purchase_date)}</span> },
      { id: "supplier", header: "Fournisseur", cell: ({ row }) => row.original.supplier_name },
      { id: "reference", header: "Référence", enableSorting: false, meta: { label: "Référence" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.reference ?? "—"}</span> },
      { id: "items", header: "Lignes", enableSorting: false, meta: { align: "right", label: "Lignes" }, cell: ({ row }) => row.original.items },
      { id: "status", header: "Statut", enableSorting: false, cell: ({ row }) => <PurchaseStatusBadge status={row.original.status} /> },
      {
        id: "due",
        header: "Reste dû",
        enableSorting: false,
        meta: { align: "right", label: "Reste dû" },
        cell: ({ row: { original: p } }) => {
          const due = p.status === "cancelled" ? 0 : Math.max(0, p.total - p.paid_amount);
          return due > 0 ? <span className="text-warning">{money(due)}</span> : <span className="text-muted-foreground">—</span>;
        },
      },
      { id: "total", header: "Total TTC", meta: { align: "right" }, cell: ({ row }) => <span className={row.original.status === "cancelled" ? "text-muted-foreground line-through" : "font-semibold"}>{money(row.original.total)}</span> },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="Achats"
        description="Réceptions de marchandise et commandes fournisseurs."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download /> Exporter CSV
            </Button>
            <Button onClick={() => navigate("/purchases/new")}>
              <Plus /> Nouvel achat
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Achats du mois" value={money(stats?.month)} />
        <Kpi label="Commandes en attente" value={int(stats?.ordered)} hint={money(stats?.ordered_total)} />
        <Kpi label="Dettes fournisseurs" value={money(stats?.debt)} tone={stats?.debt ? "warning" : undefined} />
      </div>
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
        visibilityKey="purchases"
        onRowClick={(r) => navigate(`/purchases/${r.id}`)}
        toolbar={
          <>
            <SearchInput value={t.search} onChange={t.setSearch} placeholder="N°, référence, fournisseur…" />
            <Select inputSize="sm" className="w-40" value={t.filters.status} onChange={(e) => t.setFilter("status", e.target.value)}>
              <option value="">Tous statuts</option>
              <option value="ordered">Commandés</option>
              <option value="received">Reçus</option>
              <option value="cancelled">Annulés</option>
            </Select>
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.from} onChange={(e) => t.setFilter("from", e.target.value)} />
            <span className="text-muted-foreground">→</span>
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.to} onChange={(e) => t.setFilter("to", e.target.value)} />
          </>
        }
        empty={
          <EmptyState
            icon={<Boxes />}
            title="Aucun achat"
            description="Enregistrez vos réceptions de marchandise pour alimenter le stock automatiquement."
            actions={
              <Button onClick={() => navigate("/purchases/new")}>
                <Plus /> Nouvel achat
              </Button>
            }
          />
        }
      />
    </Page>
  );
}
