import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DataTable, type ColumnDef } from "@/components/common/data-table";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { useWarehouses } from "@/features/warehouses/api";
import { useAction } from "@/hooks/use-action";
import { section } from "@/i18n";
import { select } from "@/lib/db";
import { dateTime, int } from "@/lib/format";
import { call } from "@/lib/tauri";

interface Row {
  id: number;
  number: string;
  warehouse_name: string;
  status: "open" | "validated" | "cancelled";
  notes: string | null;
  user_name: string | null;
  items: number;
  differences: number;
  created_at: string;
  validated_at: string | null;
}

export function InventoryPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get("new") === "1");
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const { data: warehouses = [] } = useWarehouses();
  const { run, pending } = useAction();
  const labels = section("inventoryStatus") as Record<string, string>;

  useEffect(() => {
    if (params.get("new")) setParams({}, { replace: true });
  }, [params, setParams]);

  const { data = [], isLoading } = useQuery({
    queryKey: ["inventory", "sessions"],
    queryFn: () =>
      select<Row>(
        `SELECT s.*, w.name AS warehouse_name, u.name AS user_name,
           (SELECT COUNT(*) FROM inventory_items WHERE session_id = s.id) AS items,
           (SELECT COUNT(*) FROM inventory_items WHERE session_id = s.id AND difference <> 0) AS differences
         FROM inventory_sessions s JOIN warehouses w ON w.id = s.warehouse_id LEFT JOIN users u ON u.id = s.user_id ORDER BY s.id DESC LIMIT 500`,
      ),
  });

  const start = async () => {
    const res = await run(() => call<{ id: number; number: string }>("inventory_start", { warehouseId: warehouseId ?? warehouses[0]?.id ?? null, notes: notes || null }), { success: "Inventaire démarré." });
    if (res) navigate(`/inventory/${res.id}`);
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      { id: "number", header: "N°", cell: ({ row }) => <span className="font-semibold">{row.original.number}</span> },
      { id: "date", header: "Date", cell: ({ row }) => <span className="num text-muted-foreground">{dateTime(row.original.created_at)}</span> },
      { id: "warehouse", header: "Entrepôt", cell: ({ row }) => row.original.warehouse_name },
      {
        id: "status",
        header: "Statut",
        cell: ({ row }) => (
          <Badge tone={row.original.status === "validated" ? "success" : row.original.status === "open" ? "info" : "neutral"} dot>
            {labels[row.original.status]}
          </Badge>
        ),
      },
      { id: "items", header: "Produits comptés", meta: { align: "right" }, cell: ({ row }) => int(row.original.items) },
      { id: "diff", header: "Écarts", meta: { align: "right" }, cell: ({ row }) => <span className={row.original.differences ? "font-semibold text-warning" : "text-muted-foreground"}>{int(row.original.differences)}</span> },
      { id: "user", header: "Par", cell: ({ row }) => <span className="text-muted-foreground">{row.original.user_name ?? "—"}</span> },
    ],
    [labels],
  );

  return (
    <Page>
      <PageHeader
        title="Inventaire"
        description="Comptez votre stock physique : DigiStock calcule les écarts et génère les ajustements."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> Nouvel inventaire
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={data}
        loading={isLoading}
        onRowClick={(r) => navigate(`/inventory/${r.id}`)}
        empty={
          <EmptyState
            icon={<ClipboardCheck />}
            title="Aucun inventaire"
            description="Lancez un inventaire puis scannez vos produits un à un. Le stock n'est modifié qu'à la validation."
            actions={
              <Button onClick={() => setOpen(true)}>
                <Plus /> Nouvel inventaire
              </Button>
            }
          />
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm" title="Nouvel inventaire" description="Le stock ne sera ajusté qu'au moment de la validation." icon={<ClipboardCheck />}>
          <DialogBody className="space-y-3.5">
            {warehouses.length > 1 && (
              <Field label="Entrepôt">
                <Select value={warehouseId ?? warehouses[0]?.id} onChange={(e) => setWarehouseId(Number(e.target.value))}>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex. inventaire de fin de mois" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Annuler
            </Button>
            <Button onClick={start} loading={pending}>
              Démarrer l'inventaire
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
