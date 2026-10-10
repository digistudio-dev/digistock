import { useWhatsApp } from "@/features/whatsapp/composer";
import { money } from "@/lib/format";
import { fillTemplate } from "@/lib/phone";
import { useApp } from "@/stores/app";

/** Relance de paiement WhatsApp (Premium) — toujours soumise à validation de l'utilisateur. */
export function usePaymentReminder() {
  const whatsapp = useWhatsApp();
  return (c: { id: number; name: string; phone: string | null; whatsapp: string | null; balance: number }) => {
    const { settings, company } = useApp.getState();
    whatsapp({
      title: "Rappel de paiement",
      recipientName: c.name,
      phone: c.whatsapp ?? c.phone,
      message: fillTemplate(settings["whatsapp.template_reminder"], { customer_name: c.name, amount: money(c.balance, false), company_name: company?.name ?? "" }),
      kind: "payment_reminder",
      entity: "customer",
      entityId: c.id,
    });
  };
}
