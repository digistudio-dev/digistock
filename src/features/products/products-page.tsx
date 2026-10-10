import { useQuery } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Download, Eye, FileUp, MoreHorizontal, Package, Pencil, Plus, SlidersHorizontal, Tags } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader, SearchInput } from "@/components/common/page";
import { ProductThumb } from "@/components/common/pickers";
import { StockBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { ContextMenuItem, ContextMenuSeparator, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Switch } from "@/components/ui/misc";
import { useAdjust } from "@/features/stock/adjust-dialog";
import { useAction } from "@/hooks/use-action";
import { usePagedQuery, useTableState } from "@/hooks/use-table-state";
import { unitShort } from "@/i18n";
import { margin } from "@/lib/calc";
import { toCsv } from "@/lib/csv";
import { like, orderBy, paged, select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { money, percent, qty } from "@/lib/format";
import { SQL_STOCK_LEVEL, type StockLevel } from "@/lib/stock";
import { call } from "@/lib/tauri";
import { useCan, useSettings } from "@/stores/app";
import type { Product } from "@/types";

type Row = Product & { level: StockLevel };

const SORTS = { name: "p.name COLLATE NOCASE", quantity: "p.quantity", selling_price: "p.selling_price", purchase_price: "p.purchase_price", category: "c.name", updated_at: "p.updated_at" };

export function buildProductQuery(search: string, f: { category: string; level: string; supplier: string; archived: boolean }) {
  const where = [`p.archived = ${f.archived ? 1 : 0}`];
  const params: (string | number)[] = [];
  if (search) {
    where.push("(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.barcode = ? OR p.brand LIKE ? ESCAPE '\\')");
    params.push(like(search), like(search), search.trim(), like(search));
  }
  if (f.category) {
    where.push(f.category === "none" ? "p.category_id IS NULL" : "p.category_id = ?");
    if (f.category !== "none") params.push(Number(f.category));
  }
  if (f.supplier) {
    where.push("p.supplier_id = ?");
    params.push(Number(f.supplier));
  }
  if (f.level === "alert") where.push("(p.quantity <= 0 OR (p.minimum_stock > 0 AND p.quantity <= p.minimum_stock))");
  else if (f.level) where.push(`(${SQL_STOCK_LEVEL}) = '${f.level.replace(/[^a-z]/g, "")}'`);
  return {
    sql: `SELECT p.*, c.name AS category_name, c.color AS category_color, s.name AS supplier_name, ${SQL_STOCK_LEVEL} AS level
          FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
          WHERE ${where.join(" AND ")}`,
    params,
  };
}

export function ProductsPage() {
  const navigate = useNavigate();
  const can = useCan();
  const settings = useSettings();
  const showCost = can("view_purchase_price");
  const manage = can("manage_products");
  const openAdjust = useAdjust((s) => s.open);
  const { run } = useAction();
  const [selected, setSelected] = useState<Row[]>([]);
  const [params] = useSearchParams();
  const t = useTableState([{ id: "name", desc: false }], { category: params.get("category") ?? "", level: params.get("level") ?? "", supplier: params.get("supplier") ?? "", archived: false });
  const q = buildProductQuery(t.search, t.filters);
  const { data, isLoading } = usePagedQuery(["products", t.search, t.filters, t.page, t.pageSize, t.sort], () =>
    paged<Row>(q.sql, q.params, { page: t.page, pageSize: t.pageSize, orderBy: orderBy(t.sort, SORTS, "p.name") }),
  );
  const { data: categories = [] } = useQuery({ queryKey: ["categories", "options"], queryFn: () => select<{ id: number; name: string }>("SELECT id, name FROM categories WHERE archived = 0 ORDER BY name") });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers", "options"], queryFn: () => select<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE archived = 0 ORDER BY name") });
  const { data: totalCount } = useQuery({ queryKey: ["products", "count"], queryFn: () => select<{ n: number }>("SELECT COUNT(*) AS n FROM products WHERE archived = 0").then((r) => r[0]?.n ?? 0) });

  const archive = async (p: Row, archived: boolean) => {
    if (archived) {
      const ok = await confirm({ title: `Archiver « ${p.name} » ?`, description: "Le produit n'apparaîtra plus dans la caisse ni dans les listes. L'historique est conservé et vous pourrez le restaurer.", confirmLabel: "Archiver" });
      if (ok === false) return;
    }
    await run(() => call("entity_archive", { table: "products", id: p.id, archived }), { success: archived ? "Produit archivé." : "Produit restauré." });
  };

  const archiveSelected = async () => {
    const ok = await confirm({ title: `Archiver ${selected.length} produit(s) ?`, description: "Les produits archivés sont masqués mais leur historique est conservé.", confirmLabel: "Archiver" });
    if (ok === false) return;
    await run(async () => {
      for (const p of selected) await call("entity_archive", { table: "products", id: p.id, archived: true });
    }, { success: `${selected.length} produit(s) archivé(s).` });
  };

  const duplicate = async (p: Row) => {
    const id = await run(() => call<number>("product_duplicate", { id: p.id }), { success: "Produit dupliqué." });
    if (id) navigate(`/products/${id}/edit`);
  };

  const exportCsv = async () => {
    const rows = await select<Row>(q.sql + " ORDER BY p.name", q.params);
    const csv = toCsv(rows as never, [
      { key: "name", label: "name" },
      { key: "sku", label: "sku" },
      { key: "barcode", label: "barcode" },
      { key: "category_name", label: "category" },
      ...(showCost ? [{ key: "purchase_price", label: "purchase_price" }] : []),
      { key: "selling_price", label: "selling_price" },
      { key: "tax_rate", label: "tax_rate" },
      { key: "quantity", label: "quantity" },
      { key: "minimum_stock", label: "minimum_stock" },
      { key: "unit", label: "unit" },
      { key: "supplier_name", label: "supplier" },
      { key: "location", label: "location" },
    ]);
    const path = await saveCsv(`produits-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    if (path) toast.success("Export terminé.", { description: path });
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        id: "name",
        header: "Produit",
        cell: ({ row: { original: p } }) => (
          <div className="flex min-w-[220px] items-center gap-3">
            <ProductThumb image={p.image} className="size-9" />
            <div className="min-w-0">
              <div className="truncate font-medium">{p.name}</div>
              <div className="truncate text-[0.75rem] text-muted-foreground">{[p.sku, p.barcode].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          </div>
        ),
      },
      {
        id: "category",
        header: "Catégorie",
        meta: { label: "Catégorie" },
        cell: ({ row: { original: p } }) =>
          p.category_name ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: p.category_color ?? "hsl(var(--muted-foreground))" }} />
              {p.category_name}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "quantity",
        header: "Stock",
        meta: { align: "right" },
        cell: ({ row: { original: p } }) => (
          <span className="font-semibold">
            {qty(p.quantity)} <span className="text-[0.75rem] font-normal text-muted-foreground">{unitShort(p.unit)}</span>
          </span>
        ),
      },
      { id: "level", header: "État", enableSorting: false, meta: { label: "État du stock" }, cell: ({ row: { original: p } }) => (p.product_type === "service" ? <span className="text-muted-foreground">Service</span> : <StockBadge level={p.level} />) },
      ...(showCost ? [{ id: "purchase_price", header: "Prix d'achat", meta: { align: "right" as const, label: "Prix d'achat" }, cell: ({ row }: { row: { original: Row } }) => <span className="text-muted-foreground">{money(row.original.purchase_price)}</span> }] : []),
      { id: "selling_price", header: "Prix de vente", meta: { align: "right" }, cell: ({ row: { original: p } }) => <span className="font-semibold">{money(p.selling_price)}</span> },
      ...(showCost
        ? [
            {
              id: "margin",
              header: "Marge",
              enableSorting: false,
              meta: { align: "right" as const, label: "Marge" },
              cell: ({ row: { original: p } }: { row: { original: Row } }) => {
                const m = margin(p.selling_price, p.purchase_price, p.tax_rate, settings["sales.prices_include_tax"]);
                return <span className={m.value < 0 ? "text-danger" : "text-success"}>{percent(m.rate)}</span>;
              },
            },
          ]
        : []),
      { id: "supplier", header: "Fournisseur", enableSorting: false, meta: { label: "Fournisseur" }, cell: ({ row: { original: p } }) => <span className="text-muted-foreground">{p.supplier_name ?? "—"}</span> },
      {
        id: "actions",
        header: "",
        enableSorting: false,
        enableHiding: false,
        size: 44,
        cell: ({ row: { original: p } }) => (
          <div onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="opacity-60 group-hover:opacity-100" aria-label="Actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>{menuItems(p, DropdownMenuItem, DropdownMenuSeparator)}</DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showCost, settings],
  );

  function menuItems(p: Row, Item: typeof ContextMenuItem, Sep: typeof ContextMenuSeparator) {
    return (
      <>
        <Item onSelect={() => navigate(`/products/${p.id}`)}>
          <Eye /> Voir
        </Item>
        {manage && (
          <Item onSelect={() => navigate(`/products/${p.id}/edit`)}>
            <Pencil /> Modifier
          </Item>
        )}
        {manage && (
          <Item onSelect={() => duplicate(p)}>
            <Copy /> Dupliquer
          </Item>
        )}
        {can("manage_stock") && !p.archived && (
          <Item onSelect={() => openAdjust(p.id)}>
            <SlidersHorizontal /> Ajuster le stock
          </Item>
        )}
        <Item onSelect={() => navigate(`/products/labels?ids=${p.id}`)}>
          <Tags /> Imprimer des étiquettes
        </Item>
        {manage && (
          <>
            <Sep />
            {p.archived ? (
              <Item onSelect={() => archive(p, false)}>
                <ArchiveRestore /> Restaurer
              </Item>
            ) : (
              <Item danger onSelect={() => archive(p, true)}>
                <Archive /> Archiver
              </Item>
            )}
          </>
        )}
      </>
    );
  }

  const filtered = !!t.search || t.filters.category || t.filters.level || t.filters.supplier;

  return (
    <Page wide>
      <PageHeader
        title="Produits"
        description={totalCount !== undefined ? `${qty(totalCount)} produit(s) actif(s) dans votre catalogue.` : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate("/products/labels")}>
              <Tags /> Étiquettes
            </Button>
            <Button variant="secondary" onClick={exportCsv}>
              <Download /> Exporter
            </Button>
            {manage && (
              <Button variant="secondary" onClick={() => navigate("/products/import")}>
                <FileUp /> Importer CSV
              </Button>
            )}
            {manage && (
              <Button onClick={() => navigate("/products/new")}>
                <Plus /> Ajouter un produit
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
        getRowId={(r) => String(r.id)}
        selectable={manage}
        onSelectionChange={setSelected}
        visibilityKey="products"
        onRowClick={(r) => navigate(`/products/${r.id}`)}
        contextMenu={(r) => menuItems(r, ContextMenuItem, ContextMenuSeparator)}
        toolbar={
          selected.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-[0.8125rem] font-medium">{selected.length} sélectionné(s)</span>
              <Button size="sm" variant="secondary" onClick={() => navigate(`/products/labels?ids=${selected.map((s) => s.id).join(",")}`)}>
                <Tags /> Étiquettes
              </Button>
              {!t.filters.archived && (
                <Button size="sm" variant="secondary" onClick={archiveSelected}>
                  <Archive /> Archiver
                </Button>
              )}
            </div>
          ) : (
            <>
              <SearchInput value={t.search} onChange={t.setSearch} placeholder="Nom, SKU, code-barres…" />
              <Select inputSize="sm" className="w-44" value={t.filters.category} onChange={(e) => t.setFilter("category", e.target.value)}>
                <option value="">Toutes catégories</option>
                <option value="none">Sans catégorie</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select inputSize="sm" className="w-40" value={t.filters.level} onChange={(e) => t.setFilter("level", e.target.value)}>
                <option value="">Tous niveaux</option>
                <option value="alert">À réapprovisionner</option>
                <option value="normal">Normal</option>
                <option value="low">Faible</option>
                <option value="critical">Critique</option>
                <option value="out">Rupture</option>
              </Select>
              <Select inputSize="sm" className="w-44" value={t.filters.supplier} onChange={(e) => t.setFilter("supplier", e.target.value)}>
                <option value="">Tous fournisseurs</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </>
          )
        }
        toolbarRight={
          <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
            <Switch checked={t.filters.archived} onCheckedChange={(v) => t.setFilter("archived", v)} /> Archivés
          </label>
        }
        empty={
          filtered || t.filters.archived ? (
            <EmptyState compact icon={<Package />} title="Aucun produit trouvé" description="Modifiez votre recherche ou vos filtres." />
          ) : (
            <EmptyState
              icon={<Package />}
              title="Aucun produit"
              description="Ajoutez votre premier produit ou importez votre catalogue."
              actions={
                manage && (
                  <>
                    <Button onClick={() => navigate("/products/new")}>
                      <Plus /> Ajouter un produit
                    </Button>
                    <Button variant="secondary" onClick={() => navigate("/products/import")}>
                      <FileUp /> Importer CSV
                    </Button>
                  </>
                )
              }
            />
          )
        }
      />
    </Page>
  );
}
