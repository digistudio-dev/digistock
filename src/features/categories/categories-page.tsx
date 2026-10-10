import { useQuery } from "@tanstack/react-query";
import { Archive, FolderTree, MoreHorizontal, Package, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirm } from "@/components/common/confirm";
import { EntityDialog, type EntityField } from "@/components/common/entity-dialog";
import { EmptyState, LoadingRows, Page, PageHeader, SearchInput } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Card, Skeleton } from "@/components/ui/misc";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { useAction } from "@/hooks/use-action";
import { like, select } from "@/lib/db";
import { int, money } from "@/lib/format";
import { call } from "@/lib/tauri";
import { useCan } from "@/stores/app";
import type { Category } from "@/types";

const FIELDS: EntityField[] = [
  { name: "name", label: "Nom", required: true, span: 2, placeholder: "Ex. Boissons" },
  { name: "description", label: "Description", type: "textarea" },
  { name: "color", label: "Couleur", type: "color", span: 2 },
];

type Row = Category & { products: number; stock_value: number; low: number };

export function CategoriesPage() {
  const can = useCan();
  const navigate = useNavigate();
  const { run } = useAction();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);
  const manage = can("manage_products");
  const showCost = can("view_purchase_price");
  const { data = [], isLoading } = useQuery({
    queryKey: ["categories", "list", search],
    queryFn: () =>
      select<Row>(
        `SELECT c.*, COUNT(p.id) AS products, COALESCE(SUM(p.quantity * p.purchase_price), 0) AS stock_value,
                SUM(CASE WHEN p.id IS NOT NULL AND (p.quantity <= 0 OR (p.minimum_stock > 0 AND p.quantity <= p.minimum_stock)) THEN 1 ELSE 0 END) AS low
         FROM categories c LEFT JOIN products p ON p.category_id = c.id AND p.archived = 0
         WHERE c.archived = 0 AND (? = '' OR c.name LIKE ? ESCAPE '\\') GROUP BY c.id ORDER BY c.name`,
        [search.trim(), like(search)],
      ),
  });

  const archive = async (c: Row) => {
    const ok = await confirm({
      title: `Archiver la catégorie « ${c.name} » ?`,
      description: c.products > 0 ? `${c.products} produit(s) restent liés à cette catégorie et conservent leur classement.` : "La catégorie ne sera plus proposée.",
      confirmLabel: "Archiver",
    });
    if (ok === false) return;
    await run(() => call("entity_archive", { table: "categories", id: c.id, archived: true }), { success: "Catégorie archivée." });
  };

  return (
    <Page>
      <PageHeader
        title="Catégories"
        description="Organisez votre catalogue pour une caisse plus rapide et des rapports plus clairs."
        actions={
          manage && (
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus /> Nouvelle catégorie
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchInput value={search} onChange={setSearch} placeholder="Rechercher une catégorie…" />
      </div>
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-lg" />
          ))}
        </div>
      ) : data.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FolderTree />}
            title={search ? "Aucune catégorie trouvée" : "Aucune catégorie"}
            description="Créez des catégories comme « Boissons » ou « Hygiène » pour filtrer rapidement vos produits."
            actions={
              manage &&
              !search && (
                <Button onClick={() => setOpen(true)}>
                  <Plus /> Nouvelle catégorie
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.map((c) => (
            <Card key={c.id} className="group relative cursor-pointer p-4 transition-shadow hover:shadow-md" onClick={() => navigate(`/products?category=${c.id}`)}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-9 items-center justify-center rounded-lg text-white" style={{ background: c.color ?? "hsl(var(--muted-foreground))" }}>
                    <FolderTree className="size-4" />
                  </span>
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[0.75rem] text-muted-foreground">{int(c.products)} produit(s)</div>
                  </div>
                </div>
                {manage && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" className="opacity-0 group-hover:opacity-100" aria-label="Actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(c);
                            setOpen(true);
                          }}
                        >
                          <Pencil /> Modifier
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => navigate(`/products?category=${c.id}`)}>
                          <Package /> Voir les produits
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger onSelect={() => archive(c)}>
                          <Archive /> Archiver
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
              {c.description && <p className="mt-2 line-clamp-2 text-[0.75rem] text-muted-foreground">{c.description}</p>}
              <div className="mt-3 flex items-center justify-between border-t pt-2.5 text-[0.75rem]">
                {showCost ? <span className="num text-muted-foreground">Valeur : {money(c.stock_value)}</span> : <span />}
                {c.low > 0 && <span className="font-medium text-warning">{c.low} à réapprovisionner</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
      {isLoading && <LoadingRows rows={0} />}
      <EntityDialog
        open={open}
        onOpenChange={setOpen}
        table="categories"
        title={editing ? "Modifier la catégorie" : "Nouvelle catégorie"}
        icon={<FolderTree />}
        fields={FIELDS}
        initial={editing}
        id={editing?.id}
        successMessage={editing ? "Catégorie modifiée." : "Catégorie créée."}
      />
    </Page>
  );
}
