import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Pencil, Plus, Truck, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { EntityDialog } from "@/components/common/entity-dialog";
import { EmptyState, ErrorState, InfoRow, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { Kpi } from "@/components/common/stat";
import { PurchaseStatusBadge, StockBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Card, Tabs, TabsContent, UnderlineTabsList, UnderlineTabsTrigger } from "@/components/ui/misc";
import { useWhatsApp } from "@/features/whatsapp/composer";
import { paymentLabel, unitShort } from "@/i18n";
import { one, select } from "@/lib/db";
import { date, dateTime, int, money, qty } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { useApp, useCan } from "@/stores/app";
import type { Supplier } from "@/types";
import { SupplierPaymentDialog } from "./payment-dialog";
import { SUPPLIER_FIELDS } from "./suppliers-page";

export function SupplierDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const can = useCan();
  const company = useApp((s) => s.company);
  const whatsapp = useWhatsApp();
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);

  const { data: s, isLoading, error, refetch } = useQuery({
    queryKey: ["supplier", id],
    queryFn: () =>
      one<Supplier & { purchases_total: number; purchases_count: number; pending: number; products: number }>(
        `SELECT s.*, COALESCE((SELECT SUM(total) FROM purchases WHERE supplier_id = s.id AND status = 'received'), 0) AS purchases_total,
           (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id AND status = 'received') AS purchases_count,
           (SELECT COUNT(*) FROM purchases WHERE supplier_id = s.id AND status = 'ordered') AS pending,
           (SELECT COUNT(*) FROM products WHERE supplier_id = s.id AND archived = 0) AS products
         FROM suppliers s WHERE s.id = ?`,
        [id],
      ),
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["supplier", id, "purchases"],
    queryFn: () => select<{ id: number; number: string; purchase_date: string; status: string; total: number; paid_amount: number; reference: string | null }>("SELECT id, number, purchase_date, status, total, paid_amount, reference FROM purchases WHERE supplier_id = ? ORDER BY id DESC LIMIT 200", [id]),
  });
  const { data: products = [] } = useQuery({
    queryKey: ["supplier", id, "products"],
    queryFn: () => select<{ id: number; name: string; quantity: number; minimum_stock: number; purchase_price: number; unit: string }>("SELECT id, name, quantity, minimum_stock, purchase_price, unit FROM products WHERE supplier_id = ? AND archived = 0 ORDER BY name", [id]),
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["supplier", id, "payments"],
    queryFn: () => select<{ id: number; number: string; amount: number; method: string; reference: string | null; created_at: string; purchase_number: string | null }>(
      "SELECT sp.*, p.number AS purchase_number FROM supplier_payments sp LEFT JOIN purchases p ON p.id = sp.purchase_id WHERE sp.supplier_id = ? ORDER BY sp.id DESC", [id]),
  });

  if (isLoading) return <LoadingRows />;
  if (error || !s) return <ErrorState error={error ?? new Error("Fournisseur introuvable.")} onRetry={refetch} />;

  return (
    <Page>
      <PageHeader
        back="/suppliers"
        title={s.name}
        description={[s.company_name, s.city].filter(Boolean).join(" · ") || undefined}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                whatsapp({
                  recipientName: s.name,
                  phone: s.whatsapp ?? s.phone,
                  message: `Bonjour ${s.name},\n\n\n\nMerci.\n${company?.name ?? ""}`,
                  kind: "custom",
                  entity: "supplier",
                  entityId: id,
                })
              }
            >
              <MessageCircle /> WhatsApp
            </Button>
            {can("manage_suppliers") && (
              <Button variant="secondary" onClick={() => setEdit(true)}>
                <Pencil /> Modifier
              </Button>
            )}
            {(can("manage_suppliers") || can("manage_purchases")) && (
              <Button variant="secondary" onClick={() => setPay(true)}>
                <Wallet /> Payer
              </Button>
            )}
            {can("manage_purchases") && (
              <Button onClick={() => navigate(`/purchases/new?supplier=${id}`)}>
                <Plus /> Nouvel achat
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total des achats" value={money(s.purchases_total)} hint={`${int(s.purchases_count)} réception(s)`} />
        <Kpi label="Solde dû" value={money(s.balance)} tone={s.balance > 0 ? "warning" : undefined} hint={s.balance < 0 ? "Avance en votre faveur" : undefined} />
        <Kpi label="Produits fournis" value={int(s.products)} />
        <Kpi label="Commandes en attente" value={int(s.pending)} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-5">
          <Tabs defaultValue="purchases">
            <UnderlineTabsList>
              <UnderlineTabsTrigger value="purchases">Historique des achats</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="products">Produits fournis</UnderlineTabsTrigger>
              <UnderlineTabsTrigger value="payments">Paiements</UnderlineTabsTrigger>
            </UnderlineTabsList>
            <TabsContent value="purchases" className="pt-2">
              {purchases.length === 0 ? (
                <EmptyState compact icon={<Truck />} title="Aucun achat" description="Les achats auprès de ce fournisseur apparaîtront ici." />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <tbody>
                    {purchases.map((p) => (
                      <tr key={p.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/50" onClick={() => navigate(`/purchases/${p.id}`)}>
                        <td className="py-2.5 font-medium">{p.number}</td>
                        <td className="num text-muted-foreground">{date(p.purchase_date)}</td>
                        <td className="text-muted-foreground">{p.reference ?? ""}</td>
                        <td>
                          <PurchaseStatusBadge status={p.status} />
                        </td>
                        <td className="num text-right font-semibold">{money(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
            <TabsContent value="products" className="pt-2">
              {products.length === 0 ? (
                <EmptyState compact title="Aucun produit" description="Associez des produits à ce fournisseur depuis leur fiche." />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <tbody>
                    {products.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2.5">
                          <Link to={`/products/${p.id}`} className="font-medium hover:text-primary">
                            {p.name}
                          </Link>
                        </td>
                        <td className="num text-right">
                          {qty(p.quantity)} {unitShort(p.unit)}
                        </td>
                        <td className="pl-3">
                          <StockBadge quantity={p.quantity} minimum={p.minimum_stock} />
                        </td>
                        {can("view_purchase_price") && <td className="num text-right text-muted-foreground">{money(p.purchase_price)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
            <TabsContent value="payments" className="pt-2">
              {payments.length === 0 ? (
                <EmptyState compact title="Aucun paiement" />
              ) : (
                <table className="w-full text-[0.8125rem]">
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-b last:border-0">
                        <td className="py-2.5 font-medium">{p.number}</td>
                        <td className="num text-muted-foreground">{dateTime(p.created_at)}</td>
                        <td>{paymentLabel(p.method)}</td>
                        <td className="text-muted-foreground">{p.purchase_number ?? p.reference ?? ""}</td>
                        <td className="num text-right font-semibold">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TabsContent>
          </Tabs>
        </Card>
        <Card className="h-fit p-5">
          <div className="eyebrow mb-1">Coordonnées</div>
          <InfoRow label="Téléphone">{formatPhone(s.phone)}</InfoRow>
          <InfoRow label="WhatsApp">{formatPhone(s.whatsapp)}</InfoRow>
          <InfoRow label="Email">{s.email ?? "—"}</InfoRow>
          <InfoRow label="Adresse">{s.address ?? "—"}</InfoRow>
          <InfoRow label="ICE">{s.ice ?? "—"}</InfoRow>
          <InfoRow label="Paiement">{s.payment_terms ?? "—"}</InfoRow>
          <InfoRow label="Délai de livraison">{s.lead_time_days} jour(s)</InfoRow>
          {s.notes && <p className="mt-2 border-t pt-2 text-[0.8125rem] text-muted-foreground">{s.notes}</p>}
        </Card>
      </div>
      <EntityDialog open={edit} onOpenChange={setEdit} table="suppliers" title="Modifier le fournisseur" icon={<Truck />} fields={SUPPLIER_FIELDS} initial={s} id={id} successMessage="Fournisseur modifié." />
      <SupplierPaymentDialog open={pay} onOpenChange={setPay} supplierId={id} supplierName={s.name} due={Math.max(0, s.balance)} />
    </Page>
  );
}
