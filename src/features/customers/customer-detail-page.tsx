import { useQuery } from "@tanstack/react-query";
import { BellRing, FileDown, FileText, HandCoins, Pencil, ShoppingCart, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { EntityDialog } from "@/components/common/entity-dialog";
import { EmptyState, ErrorState, InfoRow, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { Kpi } from "@/components/common/stat";
import { SaleStatusBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Badge, Card, Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from "@/components/ui/misc";
import { usePos } from "@/features/sales/pos-store";
import { paymentLabel } from "@/i18n";
import { one, select } from "@/lib/db";
import { savePdf } from "@/lib/files";
import { date, dateTime, int, money } from "@/lib/format";
import { customerStatementPdf } from "@/lib/pdf/documents-pdf";
import { formatPhone } from "@/lib/phone";
import { toAppError } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useCan } from "@/stores/app";
import type { Customer } from "@/types";
import { CUSTOMER_FIELDS } from "./customers-page";
import { CustomerPaymentDialog, saveCustomerPaymentReceipt } from "./payment-dialog";
import { usePaymentReminder } from "./reminder";

const TX_LABEL: Record<string, string> = { SALE: "Vente à crédit", PAYMENT: "Paiement", SALE_CANCELLED: "Vente annulée", ADJUSTMENT: "Ajustement" };

export function CustomerDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const can = useCan();
  const remind = usePaymentReminder();
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);

  const { data: c, isLoading, error, refetch } = useQuery({
    queryKey: ["customer", id],
    queryFn: () =>
      one<Customer & { purchases_count: number; purchases_total: number; last_purchase: string | null }>(
        `SELECT c.*, (SELECT COUNT(*) FROM sales WHERE customer_id = c.id AND status = 'completed') AS purchases_count,
           COALESCE((SELECT SUM(total) FROM sales WHERE customer_id = c.id AND status = 'completed'), 0) AS purchases_total,
           (SELECT MAX(created_at) FROM sales WHERE customer_id = c.id AND status = 'completed') AS last_purchase
         FROM customers c WHERE c.id = ?`,
        [id],
      ),
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["customer", id, "sales"],
    queryFn: () => select<{ id: number; number: string; created_at: string; total: number; status: string; payment_method: string; credit_amount: number }>("SELECT id, number, created_at, total, status, payment_method, credit_amount FROM sales WHERE customer_id = ? ORDER BY id DESC LIMIT 300", [id]),
  });
  const { data: txs = [] } = useQuery({
    queryKey: ["customer", id, "credit"],
    queryFn: () =>
      select<{ id: number; type: string; amount: number; balance_after: number; number: string | null; method: string | null; note: string | null; sale_id: number | null; created_at: string }>(
        "SELECT * FROM customer_credit_transactions WHERE customer_id = ? ORDER BY id DESC",
        [id],
      ),
  });

  if (isLoading) return <LoadingRows />;
  if (error || !c) return <ErrorState error={error ?? new Error("Client introuvable.")} onRetry={refetch} />;

  const statement = async () => {
    try {
      const { base64, filename } = await customerStatementPdf(id);
      const path = await savePdf(filename, base64);
      if (path) toast.success("Relevé enregistré.", { description: path });
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  return (
    <Page>
      <PageHeader
        back="/customers"
        title={c.name}
        meta={c.balance > 0 ? <Badge tone="warning">Crédit {money(c.balance)}</Badge> : undefined}
        description={[formatPhone(c.phone), c.city].filter((x) => x && x !== "—").join(" · ") || undefined}
        actions={
          <>
            {c.balance > 0 && (
              <Button variant="secondary" onClick={() => remind(c)}>
                <BellRing /> Relance WhatsApp
              </Button>
            )}
            <Button variant="secondary" onClick={statement}>
              <FileText /> Relevé PDF
            </Button>
            {can("manage_customers") && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                <Pencil /> Modifier
              </Button>
            )}
            {can("create_sales") && (
              <Button
                variant="secondary"
                onClick={() => {
                  usePos.getState().set({ customerId: id });
                  navigate("/pos");
                }}
              >
                <ShoppingCart /> Nouvelle vente
              </Button>
            )}
            {can("manage_customers") && c.balance > 0 && (
              <Button onClick={() => setPay(true)}>
                <HandCoins /> Ajouter paiement
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total des achats" value={money(c.purchases_total)} />
        <Kpi label="Nombre d'achats" value={int(c.purchases_count)} />
        <Kpi label="Crédit impayé" value={money(c.balance)} tone={c.balance > 0 ? "warning" : undefined} hint={c.credit_limit ? `Plafond ${money(c.credit_limit)}` : "Sans plafond"} />
        <Kpi label="Dernier achat" value={date(c.last_purchase)} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <Tabs defaultValue={c.balance > 0 ? "credit" : "sales"}>
            <UnderlineTabsList>
              <UnderlineTabsTrigger value="sales">Historique des achats</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="credit">Crédit ({txs.length})</UnderlineTabsTrigger>
            </UnderlineTabsList>
            <TabsContent value="sales" className="pt-2">
              {sales.length === 0 ? (
                <EmptyState compact icon={<Users />} title="Aucun achat" description="Les ventes associées à ce client apparaîtront ici." />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <tbody>
                    {sales.map((s) => (
                      <tr key={s.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => navigate(`/sales/${s.id}`)}>
                        <td className="py-2.5 font-medium">{s.number}</td>
                        <td className="num text-muted-foreground">{dateTime(s.created_at)}</td>
                        <td>{paymentLabel(s.payment_method)}</td>
                        <td>
                          <SaleStatusBadge status={s.status} />
                        </td>
                        <td className="num text-right font-semibold">{money(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
            <TabsContent value="credit" className="pt-3">
              <div className="mb-3 flex items-center justify-between rounded-lg bg-subtle px-4 py-3">
                <span className="text-[0.8125rem] text-muted-foreground">Solde actuel</span>
                <span className={cn("num text-[1.25rem] font-bold", c.balance > 0 ? "text-warning" : "text-success")}>{money(c.balance)}</span>
              </div>
              {txs.length === 0 ? (
                <EmptyState compact title="Aucune opération de crédit" description="Les ventes à crédit et paiements apparaîtront ici." />
              ) : (
                <ol className="space-y-0">
                  {txs.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 border-b py-2.5 text-[0.8125rem] last:border-0">
                      <span className={cn("num w-28 shrink-0 font-semibold", t.amount > 0 ? "text-warning" : "text-success")}>
                        {t.amount > 0 ? "+" : "−"}
                        {money(Math.abs(t.amount))}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {TX_LABEL[t.type] ?? t.type}
                          {t.method && <span className="font-normal text-muted-foreground"> · {paymentLabel(t.method)}</span>}
                        </div>
                        <div className="truncate text-[0.75rem] text-muted-foreground">
                          {dateTime(t.created_at)} · {t.number ?? t.note ?? ""}
                        </div>
                      </div>
                      <span className="num text-[0.75rem] text-muted-foreground">Solde {money(t.balance_after)}</span>
                      {t.type === "PAYMENT" && (
                        <Button variant="ghost" size="icon-xs" onClick={() => saveCustomerPaymentReceipt(t.id)} aria-label="Reçu PDF">
                          <FileDown />
                        </Button>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </TabsContent>
          </Tabs>
        </Card>
        <Card className="h-fit p-5">
          <div className="eyebrow mb-1">Coordonnées</div>
          <InfoRow label="Téléphone">{formatPhone(c.phone)}</InfoRow>
          <InfoRow label="WhatsApp">{formatPhone(c.whatsapp)}</InfoRow>
          <InfoRow label="Email">{c.email ?? "—"}</InfoRow>
          <InfoRow label="Adresse">{c.address ?? "—"}</InfoRow>
          <InfoRow label="ICE">{c.ice ?? "—"}</InfoRow>
          <InfoRow label="Client depuis">{date(c.created_at)}</InfoRow>
          {c.notes && <p className="mt-2 border-t pt-2 text-[0.8125rem] text-muted-foreground">{c.notes}</p>}
        </Card>
      </div>
      <EntityDialog open={edit} onOpenChange={setEdit} table="customers" title="Modifier le client" icon={<Users />} fields={CUSTOMER_FIELDS} initial={c} id={id} successMessage="Client modifié." />
      <CustomerPaymentDialog open={pay} onOpenChange={setPay} customerId={id} customerName={c.name} balance={c.balance} />
    </Page>
  );
}
