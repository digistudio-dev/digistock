import { useQuery } from "@tanstack/react-query";
import { Ban, FileDown, MessageCircle, PackageCheck, Pencil, Wallet } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { ErrorState, InfoRow, LoadingRows, Page, PageHeader } from "@/components/common/page";
import { PurchaseStatusBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Card, CardHeader, Checkbox } from "@/components/ui/misc";
import { SupplierPaymentDialog } from "@/features/suppliers/payment-dialog";
import { useWhatsApp } from "@/features/whatsapp/composer";
import { useAction } from "@/hooks/use-action";
import { paymentLabel } from "@/i18n";
import { one, select } from "@/lib/db";
import { savePdf } from "@/lib/files";
import { date, dateTime, money, qty } from "@/lib/format";
import { purchasePdf } from "@/lib/pdf/documents-pdf";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import type { Purchase, PurchaseItem } from "@/types";

export function PurchaseDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const company = useApp((s) => s.company);
  const whatsapp = useWhatsApp();
  const { run, pending } = useAction();
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [updatePrice, setUpdatePrice] = useState(true);
  const [payOpen, setPayOpen] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["purchase", id],
    queryFn: async () => {
      const p = await one<Purchase & { supplier_name: string; supplier_phone: string | null; supplier_whatsapp: string | null; user_name: string | null; warehouse_name: string }>(
        `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, s.whatsapp AS supplier_whatsapp, u.name AS user_name, w.name AS warehouse_name
         FROM purchases p JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id JOIN warehouses w ON w.id = p.warehouse_id WHERE p.id = ?`,
        [id],
      );
      const items = await select<PurchaseItem>("SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY id", [id]);
      const payments = await select<{ id: number; number: string; amount: number; method: string; reference: string | null; created_at: string }>("SELECT * FROM supplier_payments WHERE purchase_id = ? ORDER BY id", [id]);
      return { p, items, payments };
    },
  });

  if (isLoading) return <LoadingRows />;
  if (error || !data?.p) return <ErrorState error={error ?? new Error("Achat introuvable.")} onRetry={refetch} />;
  const { p, items, payments } = data;
  const due = Math.max(0, p.total - p.paid_amount);

  const pdf = async () => {
    try {
      const { base64, filename } = await purchasePdf(id);
      const path = await savePdf(filename, base64);
      if (path) toast.success("PDF enregistré.", { description: path });
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  const receive = async () => {
    const ok = await run(() => call("purchase_receive", { id, updatePurchasePrice: updatePrice }), { success: "Commande réceptionnée. Stock mis à jour." });
    if (ok !== undefined) setReceiveOpen(false);
  };

  const cancel = async () => {
    const reason = await confirm({
      title: p.status === "received" ? "Annuler cet achat réceptionné ?" : "Annuler cette commande ?",
      description: p.status === "received" ? "Les quantités reçues seront retirées du stock (si disponibles) et la dette fournisseur ajustée." : "La commande sera marquée comme annulée.",
      confirmLabel: "Confirmer l'annulation",
      danger: true,
      reason: { label: "Motif" },
    });
    if (reason === false) return;
    await run(() => call("purchase_cancel", { id, reason }), { success: "Achat annulé." });
  };

  const sendWa = () =>
    whatsapp({
      title: "Envoyer au fournisseur",
      recipientName: p.supplier_name,
      phone: p.supplier_whatsapp ?? p.supplier_phone,
      message: `Bonjour ${p.supplier_name},\n\nVeuillez trouver ci-joint notre ${p.status === "ordered" ? "bon de commande" : "bon de réception"} ${p.number}.\n\nMerci de nous confirmer la disponibilité et le délai de livraison.\n\n${company?.name ?? ""}`,
      kind: "purchase_order",
      entity: "purchase",
      entityId: id,
      attachment: async () => {
        const r = await purchasePdf(id);
        return { base64: r.base64, mimetype: "application/pdf", filename: r.filename };
      },
      attachmentLabel: `${p.number}.pdf`,
    });

  return (
    <Page>
      <PageHeader
        back="/purchases"
        title={`${p.status === "ordered" ? "Commande" : "Achat"} ${p.number}`}
        meta={<PurchaseStatusBadge status={p.status} />}
        description={`${p.supplier_name} · ${date(p.purchase_date)}${p.reference ? ` · Réf. ${p.reference}` : ""}`}
        actions={
          <>
            <Button variant="secondary" onClick={pdf}>
              <FileDown /> PDF
            </Button>
            <Button variant="secondary" onClick={sendWa}>
              <MessageCircle /> WhatsApp
            </Button>
            {p.status !== "cancelled" && (
              <Button variant="secondary" onClick={cancel}>
                <Ban /> Annuler
              </Button>
            )}
            {p.status === "ordered" && (
              <Button variant="secondary" onClick={() => navigate(`/purchases/${id}/edit`)}>
                <Pencil /> Modifier
              </Button>
            )}
            {p.status !== "cancelled" && due > 0 && (
              <Button variant="secondary" onClick={() => setPayOpen(true)}>
                <Wallet /> Payer
              </Button>
            )}
            {p.status === "ordered" && (
              <Button onClick={() => setReceiveOpen(true)}>
                <PackageCheck /> Réceptionner
              </Button>
            )}
          </>
        }
      />
      {p.status === "cancelled" && (
        <div className="mb-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-[0.8125rem]">
          <span className="font-semibold text-danger">Annulé.</span> Motif : {p.cancel_reason}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_330px]">
        <Card className="overflow-hidden">
          <CardHeader title="Produits" description={`${items.length} ligne(s)`} className="pb-3" />
          <table className="w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y bg-subtle text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2 text-left">Produit</th>
                <th className="px-3 py-2 text-right">Qté</th>
                <th className="px-3 py-2 text-right">P.U. HT</th>
                <th className="px-3 py-2 text-right">TVA</th>
                <th className="px-3 py-2 text-left">Lot / Exp.</th>
                <th className="px-5 py-2 text-right">Total TTC</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-b last:border-0">
                  <td className="px-5 py-2.5">
                    <Link to={`/products/${i.product_id}`} className="font-medium hover:text-primary">
                      {i.product_name}
                    </Link>
                  </td>
                  <td className="num px-3 text-right">{qty(i.quantity)}</td>
                  <td className="num px-3 text-right">{money(i.unit_cost)}</td>
                  <td className="num px-3 text-right text-muted-foreground">{i.tax_rate} %</td>
                  <td className="px-3 text-muted-foreground">{[i.batch_number, i.expiration_date && date(i.expiration_date)].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="num px-5 text-right font-semibold">{money(i.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <Card className="p-5">
            <div className="eyebrow mb-2">Montants</div>
            <InfoRow label="Total HT">{money(p.subtotal)}</InfoRow>
            <InfoRow label="TVA">{money(p.tax_total)}</InfoRow>
            <div className="mt-1 flex items-baseline justify-between border-t pt-3">
              <span className="font-semibold">Total TTC</span>
              <span className="num text-[1.375rem] font-bold">{money(p.total)}</span>
            </div>
            <InfoRow label="Payé">{money(p.paid_amount)}</InfoRow>
            <InfoRow label="Reste dû">
              <span className={due > 0 && p.status !== "cancelled" ? "text-warning" : ""}>{money(p.status === "cancelled" ? 0 : due)}</span>
            </InfoRow>
          </Card>
          <Card className="p-5">
            <div className="eyebrow mb-2">Informations</div>
            <InfoRow label="Fournisseur">
              <Link to={`/suppliers/${p.supplier_id}`} className="hover:text-primary">
                {p.supplier_name}
              </Link>
            </InfoRow>
            <InfoRow label="Entrepôt">{p.warehouse_name}</InfoRow>
            <InfoRow label="Créé par">{p.user_name ?? "—"}</InfoRow>
            <InfoRow label="Créé le">{dateTime(p.created_at)}</InfoRow>
            {p.received_at && <InfoRow label="Réceptionné le">{dateTime(p.received_at)}</InfoRow>}
            {p.note && <p className="mt-2 border-t pt-2 text-[0.8125rem] text-muted-foreground">{p.note}</p>}
          </Card>
          {payments.length > 0 && (
            <Card className="p-5">
              <div className="eyebrow mb-2">Paiements</div>
              {payments.map((pay) => (
                <InfoRow key={pay.id} label={`${pay.number} · ${paymentLabel(pay.method)}`}>
                  {money(pay.amount)}
                </InfoRow>
              ))}
            </Card>
          )}
        </div>
      </div>
      <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}>
        <DialogContent size="sm" title="Réceptionner la commande" description="Les quantités commandées seront ajoutées au stock." icon={<PackageCheck />}>
          <DialogBody>
            <label className="flex items-start gap-2.5 text-[0.8125rem]">
              <Checkbox checked={updatePrice} onCheckedChange={setUpdatePrice} />
              <span>Mettre à jour les prix d'achat des produits avec ceux de la commande</span>
            </label>
            <p className="mt-3 text-[0.75rem] text-muted-foreground">Quantités différentes ? Modifiez d'abord la commande, puis réceptionnez.</p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setReceiveOpen(false)}>
              Annuler
            </Button>
            <Button onClick={receive} loading={pending}>
              Confirmer la réception
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SupplierPaymentDialog open={payOpen} onOpenChange={setPayOpen} supplierId={p.supplier_id} supplierName={p.supplier_name} due={due} purchaseId={id} />
    </Page>
  );
}
