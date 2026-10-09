import { useQuery } from "@tanstack/react-query";
import { Archive, ArrowLeftRight, MapPin, MoreHorizontal, Pencil, Plus, User, Warehouse as WarehouseIcon } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { confirm } from "@/components/common/confirm";
import { EntityDialog, type EntityField } from "@/components/common/entity-dialog";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { PremiumBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/menu";
import { Badge, Card, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { useAction } from "@/hooks/use-action";
import { select } from "@/lib/db";
import { dateTime, int, money, qty } from "@/lib/format";
import { call } from "@/lib/tauri";
import { useCan, usePremium } from "@/stores/app";
import type { Warehouse } from "@/types";

const FIELDS: EntityField[] = [
  { name: "name", label: "Nom", required: true, span: 2, placeholder: "Ex. Entrepôt Aïn Sebaâ" },
  { name: "address", label: "Adresse", span: 2 },
  { name: "manager", label: "Responsable" },
  { name: "notes", label: "Notes", type: "textarea" },
];

type Row = Warehouse & { products: number; units: number; value: number };

export function WarehousesPage() {
  const navigate = useNavigate();
  const premium = usePremium();
  const gate = usePremiumGate();
  const can = useCan();
  const { run } = useAction();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ["warehouses", "overview"],
    queryFn: () =>
      select<Row>(
        `SELECT w.*, COUNT(CASE WHEN ws.quantity > 0 THEN 1 END) AS products, COALESCE(SUM(ws.quantity), 0) AS units,
                COALESCE(SUM(ws.quantity * p.purchase_price), 0) AS value
         FROM warehouses w LEFT JOIN warehouse_stock ws ON ws.warehouse_id = w.id LEFT JOIN products p ON p.id = ws.product_id AND p.archived = 0
         WHERE w.archived = 0 GROUP BY w.id ORDER BY w.is_default DESC, w.name`,
      ),
  });
  const { data: transfers = [] } = useQuery({
    queryKey: ["transfers"],
    queryFn: () =>
      select<{ id: number; number: string; source: string; destination: string; items: number; units: number; reference: string | null; user_name: string | null; created_at: string }>(
        `SELECT t.*, s.name AS source, d.name AS destination, u.name AS user_name,
           (SELECT COUNT(*) FROM stock_transfer_items WHERE transfer_id = t.id) AS items,
           (SELECT SUM(quantity) FROM stock_transfer_items WHERE transfer_id = t.id) AS units
         FROM stock_transfers t JOIN warehouses s ON s.id = t.source_warehouse_id JOIN warehouses d ON d.id = t.destination_warehouse_id
         LEFT JOIN users u ON u.id = t.user_id ORDER BY t.id DESC LIMIT 200`,
      ),
  });

  const add = () => {
    if (data.length >= 1 && !gate.check("warehouses")) return;
    setEditing(null);
    setOpen(true);
  };

  const archive = async (w: Row) => {
    const ok = await confirm({ title: `Archiver « ${w.name} » ?`, description: "Un entrepôt ne peut être archivé que s'il est vide.", confirmLabel: "Archiver" });
    if (ok === false) return;
    await run(() => call("entity_archive", { table: "warehouses", id: w.id, archived: true }), { success: "Entrepôt archivé." });
  };

  return (
    <Page>
      <PageHeader
        title="Entrepôts"
        description="Stock par magasin et par entrepôt, et transferts entre emplacements."
        meta={!premium ? <PremiumBadge /> : undefined}
        actions={
          can("manage_stock") && (
            <>
              <Button variant="secondary" onClick={() => (gate.check("transfers") ? navigate("/transfers/new") : undefined)} disabled={premium && data.length < 2}>
                <ArrowLeftRight /> Nouveau transfert
              </Button>
              <Button onClick={add}>
                <Plus /> Nouvel entrepôt
              </Button>
            </>
          )
        }
      />
      <Tabs defaultValue="warehouses">
        <TabsList className="mb-4">
          <TabsTrigger value="warehouses">Entrepôts ({data.length})</TabsTrigger>
          <TabsTrigger value="transfers">Transferts ({transfers.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="warehouses">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-40 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.map((w) => (
                <Card key={w.id} className="group p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                        <WarehouseIcon className="size-5" />
                      </span>
                      <div>
                        <div className="flex items-center gap-2 font-semibold">
                          {w.name} {w.is_default ? <Badge tone="primary">Principal</Badge> : null}
                        </div>
                        {w.address && (
                          <div className="mt-0.5 flex items-center gap-1 text-[0.75rem] text-muted-foreground">
                            <MapPin className="size-3" /> {w.address}
                          </div>
                        )}
                      </div>
                    </div>
                    {can("manage_stock") && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-xs" className="opacity-60 group-hover:opacity-100" aria-label="Actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(w);
                              setOpen(true);
                            }}
                          >
                            <Pencil /> Modifier
                          </DropdownMenuItem>
                          {!w.is_default && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem danger onSelect={() => archive(w)}>
                                <Archive /> Archiver
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t pt-3 text-[0.75rem]">
                    <div>
                      <div className="text-muted-foreground">Produits</div>
                      <div className="num text-[0.9375rem] font-semibold">{int(w.products)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Unités</div>
                      <div className="num text-[0.9375rem] font-semibold">{qty(w.units)}</div>
                    </div>
                    {can("view_purchase_price") && (
                      <div>
                        <div className="text-muted-foreground">Valeur</div>
                        <div className="num text-[0.9375rem] font-semibold">{money(w.value)}</div>
                      </div>
                    )}
                  </div>
                  {w.manager && (
                    <div className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
                      <User className="size-3.5" /> {w.manager}
                    </div>
                  )}
                </Card>
              ))}
              {!premium && (
                <button onClick={() => gate.open("warehouses")} className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed text-center text-[0.8125rem] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground">
                  <Plus className="mb-2 size-5" />
                  Ajouter un entrepôt
                  <PremiumBadge className="mt-2" />
                </button>
              )}
            </div>
          )}
        </TabsContent>
        <TabsContent value="transfers">
          <Card className="overflow-hidden">
            {transfers.length === 0 ? (
              <EmptyState
                icon={<ArrowLeftRight />}
                title="Aucun transfert"
                description="Déplacez de la marchandise d'un entrepôt à l'autre : DigiStock enregistre la sortie et l'entrée."
                actions={
                  <Button variant="secondary" onClick={() => gate.check("transfers") && navigate("/transfers/new")}>
                    <ArrowLeftRight /> Nouveau transfert
                  </Button>
                }
              />
            ) : (
              <table className="w-full text-[0.8125rem]">
                <thead>
                  <tr className="border-b bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-2.5">N°</th>
                    <th className="px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">De → Vers</th>
                    <th className="px-3 py-2.5 text-right">Produits</th>
                    <th className="px-3 py-2.5 text-right">Unités</th>
                    <th className="px-3 py-2.5">Référence</th>
                    <th className="px-4 py-2.5">Par</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-semibold">{t.number}</td>
                      <td className="num px-3 text-muted-foreground">{dateTime(t.created_at)}</td>
                      <td className="px-3">
                        {t.source} <span className="text-muted-foreground">→</span> {t.destination}
                      </td>
                      <td className="num px-3 text-right">{t.items}</td>
                      <td className="num px-3 text-right">{qty(t.units)}</td>
                      <td className="px-3 text-muted-foreground">{t.reference ?? "—"}</td>
                      <td className="px-4 text-muted-foreground">{t.user_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>
      <EntityDialog
        open={open}
        onOpenChange={setOpen}
        table="warehouses"
        title={editing ? "Modifier l'entrepôt" : "Nouvel entrepôt"}
        icon={<WarehouseIcon />}
        fields={FIELDS}
        initial={editing}
        id={editing?.id}
        successMessage={editing ? "Entrepôt modifié." : "Entrepôt créé."}
      />
    </Page>
  );
}
