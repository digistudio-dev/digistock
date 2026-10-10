import { Archive, Download, Eye, HandCoins, Pencil, Plus, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EntityDialog, type EntityField } from "@/components/common/entity-dialog";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/menu";
import { Switch } from "@/components/ui/misc";
import { useAction } from "@/hooks/use-action";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { toCsv } from "@/lib/csv";
import { like, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { date, int, money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { call } from "@/lib/tauri";
import { useCan } from "@/stores/app";
import type { Customer } from "@/types";
import { CustomerPaymentDialog } from "./payment-dialog";

export const CUSTOMER_FIELDS: EntityField[] = [
  { name: "name", label: "Nom", required: true },
  { name: "phone", label: "Téléphone", type: "phone", placeholder: "06 12 34 56 78" },
  { name: "whatsapp", label: "WhatsApp", type: "phone" },
  { name: "email", label: "Email", type: "email" },
  { name: "city", label: "Ville" },
  { name: "ice", label: "ICE (entreprise)", pattern: { regex: /^\d{15}$/, message: "L'ICE comporte 15 chiffres." } },
  { name: "address", label: "Adresse", span: 2 },
  { name: "credit_limit", label: "Plafond de crédit", type: "money", hint: "0 = pas de plafond." },
  { name: "notes", label: "Notes", type: "textarea" },
];

type Row = Customer & { purchases_count: number; purchases_total: number; last_purchase: string | null };
const SORTS = { name: "c.name COLLATE NOCASE", balance: "c.balance", purchases_total: "purchases_total", last_purchase: "last_purchase" };

export function CustomersPage() {
  const navigate = useNavigate();
  const can = useCan();
  const manage = can("manage_customers");
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const { run } = useAction();
  const t = useTableState([{ id: "name", desc: false }], { debt: false });

  useEffect(() => {
    if (params.get("new") === "1") {
      setEditing(null);
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const sql = `SELECT c.*,
      (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed') AS purchases_count,
      COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id AND status = 'completed'), 0) AS purchases_total,
      (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id AND status = 'completed') AS last_purchase
    FROM customers c WHERE c.archived = 0 AND (?1 = '' OR c.name LIKE ?2 ESCAPE '\\' OR c.phone LIKE ?2 ESCAPE '\\' OR c.city LIKE ?2 ESCAPE '\\')
      ${t.filters.debt ? "AND c.balance > 0" : ""}`;
  const sqlParams = [t.search.trim(), like(t.search)];
  const { data, isLoading } = usePagedQuery(["customers", t.search, t.filters, t.page, t.pageSize, t.sort], () =>
    paged<Row>(sql, sqlParams, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "c.name") }),
  );

  const archive = async (c: Row) => {
    const ok = await confirm({
      title: `Archiver « ${c.name} » ?`,
      description: c.balance > 0 ? `Attention : ce client a encore ${money(c.balance)} de crédit. L'historique est conservé.` : "Le client sera masqué. Son historique est conservé.",
      confirmLabel: "Archiver",
    });
    if (ok === false) return;
    await run(() => call("entity_archive", { table: "customers", id: c.id, archived: true }), { success: "Client archivé." });
  };

  const exportCsv = async () => {
    const rows = await select<Row>(sql + " ORDER BY c.name", sqlParams);
    const csv = toCsv(rows as never, [
      { key: "name", label: "Nom" },
      { key: "phone", label: "Téléphone" },
      { key: "whatsapp", label: "WhatsApp" },
      { key: "email", label: "Email" },
      { key: "city", label: "Ville" },
      { key: "address", label: "Adresse" },
      { key: "purchases_count", label: "Nombre d'achats" },
      { key: "purchases_total", label: "Total achats" },
      { key: "balance", label: "Crédit dû" },
      { key: "credit_limit", label: "Plafond" },
    ]);
    const path = await saveCsv(`clients-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        header: "Client",
        cell: ({ row: { original: c } }) => (
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[0.6875rem] font-bold text-muted-foreground">{c.name.slice(0, 2).toUpperCase()}</span>
            <div>
              <div className="font-medium">{c.name}</div>
              {c.city && <div className="text-[0.75rem] text-muted-foreground">{c.city}</div>}
            </div>
          </div>
        ),
      },
      { id: "phone", header: "Téléphone", enableSorting: false, meta: { label: "Téléphone" }, cell: ({ row }) => <span className="num">{formatPhone(row.original.phone)}</span> },
      { id: "count", header: "Achats", enableSorting: false, meta: { align: "right", label: "Nombre d'achats" }, cell: ({ row }) => int(row.original.purchases_count) },
      { id: "purchases_total", header: "Total achats", meta: { align: "right", label: "Total achats" }, cell: ({ row }) => money(row.original.purchases_total) },
      { id: "last_purchase", header: "Dernier achat", meta: { label: "Dernier achat" }, cell: ({ row }) => <span className="num text-muted-foreground">{date(row.original.last_purchase)}</span> },
      {
        id: "balance",
        header: "Crédit dû",
        meta: { align: "right" },
        cell: ({ row: { original: c } }) => (c.balance > 0 ? <span className="font-semibold text-warning">{money(c.balance)}</span> : <span className="text-muted-foreground">—</span>),
      },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="Clients"
        description="Historique d'achats et crédits de vos clients."
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv}>
              <Download /> Exporter CSV
            </Button>
            {manage && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus /> Nouveau client
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
        visibilityKey="customers"
        onRowClick={(r) => navigate(`/customers/${r.id}`)}
        toolbar={<SearchInput value={t.search} onChange={t.setSearch} placeholder="Nom, téléphone, ville…" />}
        toolbarRight={
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Switch checked={t.filters.debt} onCheckedChange={(v) => t.setFilter("debt", v)} /> Avec crédit
          </label>
        }
        contextMenu={(c) => (
          <>
            <ContextMenuItem onSelect={() => navigate(`/customers/${c.id}`)}>
              <Eye /> Voir
            </ContextMenuItem>
            {manage && (
              <ContextMenuItem
                onSelect={() => {
                  setEditing(c);
                  setOpen(true);
                }}
              >
                <Pencil /> Modifier
              </ContextMenuItem>
            )}
            {manage && c.balance > 0 && (
              <ContextMenuItem onSelect={() => setPaying(c)}>
                <HandCoins /> Ajouter un paiement
              </ContextMenuItem>
            )}
            {manage && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem danger onSelect={() => archive(c)}>
                  <Archive /> Archiver
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        empty={
          <EmptyState
            icon={<Users />}
            title={t.search ? "Aucun client trouvé" : "Aucun client"}
            description="Ajoutez vos clients réguliers pour suivre leurs achats et leurs crédits."
            actions={
              manage &&
              !t.search && (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Nouveau client
                </Button>
              )
            }
          />
        }
      />
      <EntityDialog
        open={open}
        onOpenChange={setOpen}
        table="customers"
        title={editing ? "Modifier le client" : "Nouveau client"}
        icon={<Users />}
        fields={CUSTOMER_FIELDS}
        initial={editing}
        id={editing?.id}
        successMessage={editing ? "Client modifié." : "Client ajouté."}
      />
      {paying && <CustomerPaymentDialog open={!!paying} onOpenChange={(o) => !o && setPaying(null)} customerId={paying.id} customerName={paying.name} balance={paying.balance} />}
    </Page>
  );
}
