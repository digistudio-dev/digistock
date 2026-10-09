import { ArrowLeftRight, Download } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Delta } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Badge, type BadgeTone } from "@/components/ui/misc";
import { useWarehouses } from "@/features/warehouses/api";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { movementLabel, section } from "@/i18n";
import { toCsv } from "@/lib/csv";
import { like, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { dateTime, qty } from "@/lib/format";

interface Row {
  id: number;
  product_id: number;
  product_name: string;
  warehouse_name: string;
  type: string;
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference: string | null;
  reference_type: string | null;
  reference_id: number | null;
  reason: string | null;
  user_name: string | null;
  created_at: string;
}

const TONES: Record<string, BadgeTone> = {
  PURCHASE: "success",
  SALE: "primary",
  RETURN: "info",
  ADJUSTMENT: "neutral",
  DAMAGED: "danger",
  TRANSFER: "info",
  PRODUCTION: "info",
  INITIAL: "neutral",
  CANCELLED_SALE: "warning",
};

const SORTS = { created_at: "m.id", product_name: "p.name", quantity: "m.quantity" };

function query(search: string, f: { type: string; warehouse: string; from: string; to: string; direction: string }) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (search) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.barcode = ? OR m.reference LIKE ? ESCAPE '\\')");
    params.push(like(search), search.trim(), like(search));
  }
  if (f.type) {
    where.push("m.type = ?");
    params.push(f.type);
  }
  if (f.warehouse) {
    where.push("m.warehouse_id = ?");
    params.push(Number(f.warehouse));
  }
  if (f.direction === "in") where.push("m.quantity > 0");
  if (f.direction === "out") where.push("m.quantity < 0");
  if (f.from) {
    where.push("m.created_at >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("date(m.created_at) <= ?");
    params.push(f.to);
  }
  return {
    sql: `SELECT m.*, p.name AS product_name, w.name AS warehouse_name, u.name AS user_name
          FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN warehouses w ON w.id = m.warehouse_id LEFT JOIN users u ON u.id = m.user_id
          WHERE ${where.join(" AND ")}`,
    params,
  };
}

function refLink(r: Row) {
  if (!r.reference) return <span className="text-muted-foreground">—</span>;
  const base = r.reference_type === "sale" ? "/sales/" : r.reference_type === "purchase" ? "/purchases/" : r.reference_type === "inventory" ? "/inventory/" : null;
  return base && r.reference_id ? (
    <Link to={base + r.reference_id} onClick={(e) => e.stopPropagation()} className="font-medium text-primary hover:underline">
      {r.reference}
    </Link>
  ) : (
    r.reference
  );
}

export function MovementsPage() {
  const { data: warehouses = [] } = useWarehouses();
  const t = useTableState([{ id: "created_at", desc: true }], { type: "", warehouse: "", from: "", to: "", direction: "" });
  const q = query(t.search, t.filters);
  const { data, isLoading } = usePagedQuery(["movements", t.search, t.filters, t.page, t.pageSize, t.sort], () =>
    paged<Row>(q.sql, q.params, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "m.id DESC") }),
  );
  const types = section("movement") as Record<string, string>;

  const exportCsv = async () => {
    const rows = await select<Row>(q.sql + " ORDER BY m.id DESC LIMIT 100000", q.params);
    const csv = toCsv(
      rows.map((r) => ({ ...r, type: movementLabel(r.type) })),
      [
        { key: "created_at", label: "Date" },
        { key: "product_name", label: "Produit" },
        { key: "type", label: "Type" },
        { key: "quantity", label: "Quantité" },
        { key: "quantity_before", label: "Avant" },
        { key: "quantity_after", label: "Après" },
        { key: "warehouse_name", label: "Entrepôt" },
        { key: "reference", label: "Référence" },
        { key: "reason", label: "Motif" },
        { key: "user_name", label: "Utilisateur" },
      ],
    );
    const path = await saveCsv(`mouvements-stock-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "created_at", header: "Date", cell: ({ row }) => <span className="num whitespace-nowrap text-muted-foreground">{dateTime(row.original.created_at)}</span> },
      {
        id: "product_name",
        header: "Produit",
        cell: ({ row }) => (
          <Link to={`/products/${row.original.product_id}`} className="font-medium hover:text-primary">
            {row.original.product_name}
          </Link>
        ),
      },
      { id: "type", header: "Type", enableSorting: false, cell: ({ row }) => <Badge tone={TONES[row.original.type]}>{movementLabel(row.original.type)}</Badge> },
      { id: "quantity", header: "Quantité", meta: { align: "right" }, cell: ({ row }) => <Delta value={row.original.quantity} /> },
      {
        id: "stock",
        header: "Avant → Après",
        enableSorting: false,
        meta: { align: "right", label: "Avant → Après" },
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {qty(row.original.quantity_before)} → <span className="font-medium text-foreground">{qty(row.original.quantity_after)}</span>
          </span>
        ),
      },
      ...(warehouses.length > 1 ? [{ id: "warehouse", header: "Entrepôt", enableSorting: false, meta: { label: "Entrepôt" }, cell: ({ row }: { row: { original: Row } }) => row.original.warehouse_name }] : []),
      { id: "reference", header: "Référence", enableSorting: false, meta: { label: "Référence" }, cell: ({ row }) => refLink(row.original) },
      { id: "reason", header: "Motif", enableSorting: false, meta: { label: "Motif" }, cell: ({ row }) => <span className="line-clamp-1 max-w-[260px] text-muted-foreground">{row.original.reason ?? "—"}</span> },
      { id: "user", header: "Utilisateur", enableSorting: false, meta: { label: "Utilisateur" }, cell: ({ row }) => <span className="text-muted-foreground">{row.original.user_name ?? "—"}</span> },
    ],
    [warehouses.length],
  );

  return (
    <Page wide>
      <PageHeader
        title="Mouvements de stock"
        description="Chaque entrée et sortie de stock est enregistrée ici, avec sa référence et son auteur."
        actions={
          <Button variant="secondary" onClick={exportCsv}>
            <Download /> Exporter CSV
          </Button>
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
        visibilityKey="movements"
        dense
        toolbar={
          <>
            <SearchInput value={t.search} onChange={t.setSearch} placeholder="Produit, code-barres, référence…" />
            <Select inputSize="sm" className="w-44" value={t.filters.type} onChange={(e) => t.setFilter("type", e.target.value)}>
              <option value="">Tous les types</option>
              {Object.entries(types).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Select inputSize="sm" className="w-32" value={t.filters.direction} onChange={(e) => t.setFilter("direction", e.target.value)}>
              <option value="">Entrées et sorties</option>
              <option value="in">Entrées</option>
              <option value="out">Sorties</option>
            </Select>
            {warehouses.length > 1 && (
              <Select inputSize="sm" className="w-44" value={t.filters.warehouse} onChange={(e) => t.setFilter("warehouse", e.target.value)}>
                <option value="">Tous les entrepôts</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            )}
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.from} onChange={(e) => t.setFilter("from", e.target.value)} aria-label="Du" />
            <Input inputSize="sm" type="date" className="w-[140px]" value={t.filters.to} onChange={(e) => t.setFilter("to", e.target.value)} aria-label="Au" />
          </>
        }
        empty={<EmptyState compact icon={<ArrowLeftRight />} title="Aucun mouvement" description="Les achats, ventes et ajustements apparaîtront ici." />}
      />
    </Page>
  );
}
