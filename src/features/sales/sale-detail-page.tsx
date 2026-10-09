import { useQuery } from "@tanstack/react-query";
import { Ban, FileDown, FileText, MessageCircle, Printer } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { confirm } from "@/components/common/confirm";
import { ErrorState, InfoRow, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { SaleStatusBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/misc";
import { useWhatsApp } from "@/features/whatsapp/composer";
import { useAction } from "@/hooks/use-action";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { paymentLabel, unitShort } from "@/i18n";
import { loadSaleDocument } from "@/lib/documents";
import { dateTime, money, qty } from "@/lib/format";
import { fillTemplate } from "@/lib/phone";
import { printSaleReceipt, saleReceiptAttachment, saveSaleReceiptPdf } from "@/lib/receipts";
import { call } from "@/lib/tauri";
import { useApp, useCan } from "@/stores/app";

export function SaleDetailPage() {
  const id = Number(useParams().id);
  const can = useCan();
  const company = useApp((s) => s.company);
  const settings = useApp((s) => s.settings);
  const whatsapp = useWhatsApp();
  const { run, pending } = useAction();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["sale", id], queryFn: () => loadSaleDocument(id) });
  useShortcuts({ "ctrl+p": () => printSaleReceipt(id) });

  if (isLoading) return <LoadingRows />;
  if (error || !data) return <ErrorState error={error} onRetry={refetch} />;
  const { sale, items, customer, payments } = data;
  const showProfit = can("view_profit");

  const cancel = async () => {
    const reason = await confirm({
      title: "Annuler cette vente ?",
      description: "Le stock associé sera automatiquement restauré" + (sale.credit_amount > 0 ? " et le crédit client sera annulé." : "."),
      confirmLabel: "Confirmer l'annulation",
      danger: true,
      reason: { label: "Motif de l'annulation", placeholder: "Ex. erreur de saisie, retour client…" },
    });
    if (reason === false) return;
    await run(() => call("sale_cancel", { id, reason }), { success: "Vente annulée. Le stock a été restauré." });
  };

  return (
    <Page>
      <PageHeader
        back="/sales"
        title={`Vente ${sale.number}`}
        meta={<SaleStatusBadge status={sale.status} />}
        description={`${dateTime(sale.created_at)} · ${sale.user_name ?? "—"}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => printSaleReceipt(id)}>
              <Printer /> Imprimer
            </Button>
            <Button variant="secondary" onClick={() => saveSaleReceiptPdf(id)}>
              <FileDown /> Ticket PDF
            </Button>
            <Button variant="secondary" onClick={() => saveSaleReceiptPdf(id, "a4")}>
              <FileText /> Facture A4
            </Button>
            <Button
              variant="secondary"
              onClick={() =>
                whatsapp({
                  title: "Envoyer la facture sur WhatsApp",
                  recipientName: customer?.name ?? "Client",
                  phone: customer?.whatsapp ?? customer?.phone ?? null,
                  message: fillTemplate(settings["whatsapp.template_receipt"], { customer_name: customer?.name ?? "", number: sale.number, amount: money(sale.total, false), company_name: company?.name ?? "" }),
                  kind: "invoice",
                  entity: "sale",
                  entityId: id,
                  attachment: () => saleReceiptAttachment(id, "a4"),
                  attachmentLabel: `Facture ${sale.number.replace(/^V-/, "FAC-")}.pdf`,
                })
              }
            >
              <MessageCircle /> WhatsApp
            </Button>
            {can("cancel_sales") && sale.status === "completed" && (
              <Button variant="danger" onClick={cancel} loading={pending}>
                <Ban /> Annuler la vente
              </Button>
            )}
          </>
        }
      />
      {sale.status === "cancelled" && (
        <div className="mb-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-[0.8125rem]">
          <span className="font-semibold text-danger">Vente annulée le {dateTime(sale.cancelled_at)}.</span> Motif : {sale.cancel_reason}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="overflow-hidden">
          <CardHeader title="Articles" description={`${items.length} ligne(s)`} className="pb-3" />
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y bg-subtle text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 text-left">Produit</th>
                <th className="px-3 py-2 text-right">Qté</th>
                <th className="px-3 py-2 text-right">Prix</th>
                <th className="px-3 py-2 text-right">Remise</th>
                {showProfit && <th className="px-3 py-2 text-right">Coût</th>}
                {showProfit && <th className="px-3 py-2 text-right">Bénéfice</th>}
                <th className="px-5 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
                    <Link to={`/products/${i.product_id}`} className="font-medium hover:text-primary">
                      {i.product_name}
                    </Link>
                    {i.barcode && <div className="text-[0.6875rem] text-muted-foreground">{i.barcode}</div>}
                  </td>
                  <td className="num px-3 text-right">
                    {qty(i.quantity)} {unitShort(i.unit ?? "piece")}
                  </td>
                  <td className="num px-3 text-right">{money(i.unit_price)}</td>
                  <td className="num px-3 text-right text-muted-foreground">{i.discount > 0 ? `−${money(i.discount)}` : "—"}</td>
                  {showProfit && <td className="num px-3 text-right text-muted-foreground">{money(i.unit_cost * i.quantity)}</td>}
                  {showProfit && <td className="num px-3 text-right text-success">{money(i.profit)}</td>}
                  <td className="num px-5 text-right font-semibold">{money(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="eyebrow mb-2">Récapitulatif</div>
            <InfoRow label="Sous-total">{money(sale.subtotal)}</InfoRow>
            <InfoRow label="Remise">{sale.discount_total > 0 ? `−${money(sale.discount_total)}` : "—"}</InfoRow>
            <InfoRow label="TVA">{money(sale.tax_total)}</InfoRow>
            <div className="mt-2 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">Total</span>
              <span className="num text-[1.5rem] font-bold">{money(sale.total)}</span>
            </div>
            {showProfit && (
              <div className="mt-2 flex justify-between text-[0.8125rem]">
                <span className="text-muted-foreground">Bénéfice</span>
                <span className="num font-semibold text-success">{money(sale.profit)}</span>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <div className="eyebrow mb-2">Paiement</div>
            {payments.map((p, i) => (
              <InfoRow key={i} label={paymentLabel(p.method)}>
                {money(p.amount)}
              </InfoRow>
            ))}
            {sale.change_amount > 0 && <InfoRow label="Monnaie rendue">{money(sale.change_amount)}</InfoRow>}
          </Card>
          <Card className="p-5">
            <div className="eyebrow mb-2">Client</div>
            {customer ? (
              <>
                <Link to={`/customers/${customer.id}`} className="font-semibold hover:text-primary">
                  {customer.name}
                </Link>
                <div className="text-[0.8125rem] text-muted-foreground">{customer.phone}</div>
              </>
            ) : (
              <div className="text-[0.8125rem] text-muted-foreground">Client de passage</div>
            )}
          </Card>
        </div>
      </div>
    </Page>
  );
}
