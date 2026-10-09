import { CheckCircle2, FileDown, MessageCircle, Printer, X } from "lucide-react";
import { useEffect } from "react";
import * as D from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { useWhatsApp } from "@/features/whatsapp/composer";
import { money } from "@/lib/format";
import { fillTemplate } from "@/lib/phone";
import { printSaleReceipt, saleReceiptAttachment, saveSaleReceiptPdf } from "@/lib/receipts";
import { useApp, useSettings } from "@/stores/app";

export interface CompletedSale {
  id: number;
  number: string;
  total: number;
  change_amount: number;
  credit_amount: number;
  customer: { name: string; phone: string | null; whatsapp?: string | null } | null;
}

export function SaleSuccessDialog({ sale, onClose }: { sale: CompletedSale | null; onClose: () => void }) {
  const settings = useSettings();
  const company = useApp((s) => s.company);
  const whatsapp = useWhatsApp();

  useEffect(() => {
    if (!sale) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "p" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
        e.preventDefault();
        printSaleReceipt(sale.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sale]);

  if (!sale) return null;

  const sendWa = () =>
    whatsapp({
      title: "Envoyer le reçu sur WhatsApp",
      recipientName: sale.customer?.name ?? "Client",
      phone: sale.customer?.whatsapp ?? sale.customer?.phone ?? null,
      message: fillTemplate(settings["whatsapp.template_receipt"], {
        customer_name: sale.customer?.name ?? "",
        number: sale.number,
        amount: money(sale.total, false),
        company_name: company?.name ?? "",
      }),
      kind: "receipt",
      entity: "sale",
      entityId: sale.id,
      attachment: () => saleReceiptAttachment(sale.id),
      attachmentLabel: `Reçu ${sale.number}.pdf`,
    });

  return (
    <D.Root open onOpenChange={(o) => !o && onClose()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[hsl(228_30%_6%/0.5)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (document.getElementById("sale-success-new") as HTMLButtonElement | null)?.focus();
          }}
          className="fixed left-1/2 top-1/2 z-50 w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border bg-popover shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <D.Title className="sr-only">Vente enregistrée</D.Title>
          <D.Description className="sr-only">Choisissez comment remettre le reçu.</D.Description>
          <button onClick={onClose} className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-accent" aria-label="Fermer">
            <X className="size-4" />
          </button>
          <div className="flex flex-col items-center px-8 pb-6 pt-8 text-center">
            <div className="relative mb-4">
              <div className="absolute inset-0 animate-ping rounded-full bg-success/20 [animation-iteration-count:1]" />
              <div className="relative flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="size-8" strokeWidth={2.2} />
              </div>
            </div>
            <h2 className="text-[1.25rem] font-semibold">Vente enregistrée</h2>
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{sale.number}</p>
            <div className="num mt-4 text-[2.25rem] font-bold leading-none tracking-tight">{money(sale.total)}</div>
            {sale.change_amount > 0 && (
              <div className="mt-4 w-full rounded-xl bg-success-soft px-4 py-3">
                <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-success">Monnaie à rendre</div>
                <div className="num text-[1.625rem] font-bold text-success">{money(sale.change_amount)}</div>
              </div>
            )}
            {sale.credit_amount > 0 && (
              <div className="mt-4 w-full rounded-xl bg-warning-soft px-4 py-3 text-warning">
                <div className="text-[0.75rem] font-semibold uppercase tracking-wide">Ajouté au crédit de {sale.customer?.name}</div>
                <div className="num text-[1.375rem] font-bold">{money(sale.credit_amount)}</div>
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2 border-t bg-subtle px-5 py-4">
            <Button variant="secondary" className="h-[64px] flex-col gap-1 text-[0.75rem]" onClick={() => printSaleReceipt(sale.id)}>
              <Printer className="!size-5" /> Imprimer ticket
            </Button>
            <Button variant="secondary" className="h-[64px] flex-col gap-1 text-[0.75rem]" onClick={() => saveSaleReceiptPdf(sale.id)}>
              <FileDown className="!size-5" /> Générer PDF
            </Button>
            <Button variant="secondary" className="h-[64px] flex-col gap-1 text-[0.75rem]" onClick={sendWa}>
              <MessageCircle className="!size-5" /> WhatsApp
            </Button>
          </div>
          <div className="px-5 pb-5 pt-1">
            <Button id="sale-success-new" size="lg" className="w-full" onClick={onClose}>
              Aucun reçu — Nouvelle vente <span className="ml-1 rounded bg-white/15 px-1.5 text-[0.6875rem]">Entrée</span>
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
