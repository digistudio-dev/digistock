import { Archive, Download, Eye, Pencil, Plus, Truck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EntityDialog, type EntityField } from "@/components/common/entity-dialog";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/menu";
import { useAction } from "@/hooks/use-action";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { toCsv } from "@/lib/csv";
import { like, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { money } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { call } from "@/lib/tauri";
import { useCan } from "@/stores/app";
import type { Supplier } from "@/types";

export const SUPPLIER_FIELDS: EntityField[] = [
  { name: "name", label: "Nom du contact / fournisseur", required: true },
  { name: "company_name", label: "Raison sociale" },
  { name: "phone", label: "Téléphone", type: "phone" },
  { name: "whatsapp", label: "WhatsApp", type: "phone", placeholder: "06 12 34 56 78" },
  { name: "email", label: "Email", type: "email" },
  { name: "city", label: "Ville" },
  { name: "address", label: "Adresse", span: 2 },
  { name: "ice", label: "ICE", pattern: { regex: /^\d{15}$/, message: "L'ICE comporte 15 chiffres." } },
  { name: "payment_terms", label: "Conditions de paiement", placeholder: "Ex. 30 jours" },
  { name: "lead_time_days", label: "Délai de livraison (jours)", type: "number", hint: "Utilisé pour les suggestions de réapprovisionnement." },
  { name: "notes", label: "Notes", type: "textarea" },
];

type Row = Supplier & { products: number; purchases_total: number };
const SORTS = { name: "s.name COLLATE NOCASE", balance: "s.balance", purchases_total: "purchases_total" };

export function SuppliersPage() {
  const navigate = useNavigate();
  const can = useCan();
  const manage = can("manage_suppliers");
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const { run } = useAction();
  const t = useTableState([{ id: "name", desc: false }], {});

  useEffect(() => {
    if (params.get("new") === "1") {
      setEditing(null);
      setOpen(true);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const sql = `SELECT s.*, (SELECT COUNT(*) FROM products WHERE supplier_id = s.id AND archived = 0) AS products,
                 COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id AND status = 'received'), 0) AS purchases_total
               FROM suppliers s WHERE s.archived = 0 AND (?1 = '' OR s.name LIKE ?2 ESCAPE '\\' OR s.company_name LIKE ?2 ESCAPE '\\' OR s.phone LIKE ?2 ESCAPE '\\')`;
  const params2 = [t.search.trim(), like(t.search)];
  const { data, isLoading } = usePagedQuery(["suppliers", t.search, t.page, t.pageSize, t.sort], () =>
    paged<Row>(sql, params2, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "s.name") }),
  );

  const archive = async (s: Row) => {
    const ok = await confirm({ title: `Archiver « ${s.name} » ?`, description: "Le fournisseur sera masqué. Son historique d'achats est conservé.", confirmLabel: "Archiver" });
    if (ok === false) return;
    await run(() => call("entity_archive", { table: "suppliers", id: s.id, archived: true }), { success: "Fournisseur archivé." });
  };

  const exportCsv = async () => {
    const rows = await select<Row>(sql + " ORDER BY s.name", params2);
    const csv = toCsv(rows as never, [
      { key: "name", label: "Nom" },
      { key: "company_name", label: "Raison sociale" },
      { key: "phone", label: "Téléphone" },
      { key: "whatsapp", label: "WhatsApp" },
      { key: "email", label: "Email" },
      { key: "city", label: "Ville" },
      { key: "ice", label: "ICE" },
      { key: "purchases_total", label: "Total achats" },
      { key: "balance", label: "Solde dû" },
    ]);
    const path = await saveCsv(`fournisseurs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        header: "Fournisseur",
        cell: ({ row: { original: s } }) => (
          <div>
            <div className="font-medium">{s.name}</div>
            {s.company_name && <div className="text-[0.75rem] text-muted-foreground">{s.company_name}</div>}
          </div>
        ),
      },
      { id: "phone", header: "Téléphone", enableSorting: false, meta: { label: "Téléphone" }, cell: ({ row }) => <span className="num">{formatPhone(row.original.phone)}</span> },
      { id: "city", header: "Ville", enableSorting: false, meta: { label: "Ville" }, cell: ({ row }) => row.original.city ?? <span className="text-muted-foreground">—</span> },
      { id: "products", header: "Produits", enableSorting: false, meta: { align: "right", label: "Produits" }, cell: ({ row }) => row.original.products },
      { id: "purchases_total", header: "Total achats", meta: { align: "right", label: "Total achats" }, cell: ({ row }) => money(row.original.purchases_total) },
      {
        id: "balance",
        header: "Solde dû",
        meta: { align: "right" },
        cell: ({ row }) => (row.original.balance > 0 ? <span className="font-semibold text-warning">{money(row.original.balance)}</span> : <span className="text-muted-foreground">{money(row.original.balance)}</span>),
      },
    ],
    [],
  );

  return (
    <Page>
      <PageHeader
        title="Fournisseurs"
        description="Vos fournisseurs, leurs produits et ce que vous leur devez."
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
                <Plus /> Nouveau fournisseur
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
        visibilityKey="suppliers"
        onRowClick={(r) => navigate(`/suppliers/${r.id}`)}
        toolbar={<SearchInput value={t.search} onChange={t.setSearch} placeholder="Nom, société, téléphone…" />}
        contextMenu={(s) => (
          <>
            <ContextMenuItem onSelect={() => navigate(`/suppliers/${s.id}`)}>
              <Eye /> Voir
            </ContextMenuItem>
            {manage && (
              <ContextMenuItem
                onSelect={() => {
                  setEditing(s);
                  setOpen(true);
                }}
              >
                <Pencil /> Modifier
              </ContextMenuItem>
            )}
            {manage && (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem danger onSelect={() => archive(s)}>
                  <Archive /> Archiver
                </ContextMenuItem>
              </>
            )}
          </>
        )}
        empty={
          <EmptyState
            icon={<Truck />}
            title={t.search ? "Aucun fournisseur trouvé" : "Aucun fournisseur"}
            description="Ajoutez vos fournisseurs pour suivre vos achats, vos dettes et commander plus vite."
            actions={
              manage &&
              !t.search && (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Nouveau fournisseur
                </Button>
              )
            }
          />
        }
      />
      <EntityDialog
        open={open}
        onOpenChange={setOpen}
        table="suppliers"
        title={editing ? "Modifier le fournisseur" : "Nouveau fournisseur"}
        icon={<Truck />}
        fields={SUPPLIER_FIELDS}
        initial={editing}
        id={editing?.id}
        successMessage={editing ? "Fournisseur modifié." : "Fournisseur ajouté."}
        onSaved={(id) => !editing && navigate(`/suppliers/${id}`)}
      />
    </Page>
  );
}
