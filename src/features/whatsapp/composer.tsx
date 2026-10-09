import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Paperclip, Send, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { normalizePhone } from "@/lib/phone";
import { call, toAppError } from "@/lib/tauri";
import type { WaStatus } from "@/types";

export interface WaAttachment {
  base64: string;
  mimetype: string;
  filename: string;
}

export interface ComposerRequest {
  title?: string;
  recipientName: string;
  phone: string | null;
  message: string;
  kind: "supplier_order" | "payment_reminder" | "receipt" | "invoice" | "purchase_order" | "custom";
  entity?: string;
  entityId?: number;
  attachment?: () => Promise<WaAttachment>;
  attachmentLabel?: string;
  onSent?: () => void;
}

interface ComposerState {
  request: ComposerRequest | null;
  open: (r: ComposerRequest) => void;
  close: () => void;
}

const useComposer = create<ComposerState>((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

/** Ouvre la fenêtre d'envoi WhatsApp (Premium). Le message n'est envoyé qu'après clic sur « Envoyer ». */
export function useWhatsApp() {
  const gate = usePremiumGate();
  const open = useComposer((s) => s.open);
  return (r: ComposerRequest) => {
    if (!gate.check("whatsapp")) return;
    open(r);
  };
}

export function useWaStatus(enabled = true) {
  return useQuery({ queryKey: ["wa", "status"], queryFn: () => call<WaStatus>("wa_status"), enabled, refetchInterval: 5000 });
}

export function WhatsAppComposerHost() {
  const { request, close } = useComposer();
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const { data: status } = useWaStatus(!!request);

  useEffect(() => {
    if (request) {
      setPhone(request.phone ?? "");
      setMessage(request.message);
    }
  }, [request]);

  if (!request) return null;
  const connected = status?.state === "connected";
  const validPhone = !!normalizePhone(phone);

  const send = async () => {
    setSending(true);
    try {
      const attachment = request.attachment ? await request.attachment() : null;
      await call("wa_send", {
        input: {
          phone,
          message,
          recipient_name: request.recipientName,
          kind: request.kind,
          entity: request.entity ?? null,
          entity_id: request.entityId ?? null,
          attachment,
        },
      });
      toast.success("Message WhatsApp envoyé.", { description: request.recipientName });
      request.onSent?.();
      close();
    } catch (e) {
      toast.error("Échec de l'envoi WhatsApp.", { description: toAppError(e).message });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !sending && close()}>
      <DialogContent size="md" title={request.title ?? "Envoyer sur WhatsApp"} description={`Destinataire : ${request.recipientName}`} icon={<MessageCircle />}>
        <DialogBody className="space-y-3.5">
          {!connected && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-[0.8125rem]">
              <span>WhatsApp n'est pas connecté.</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  close();
                  navigate("/whatsapp");
                }}
              >
                Connecter WhatsApp
              </Button>
            </div>
          )}
          <Field label="Numéro WhatsApp" required error={phone && !validPhone ? "Numéro invalide." : undefined}>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="06 12 34 56 78" aria-invalid={!!phone && !validPhone} />
          </Field>
          <Field label="Message" hint="Vous pouvez modifier le message avant l'envoi.">
            <Textarea rows={10} value={message} onChange={(e) => setMessage(e.target.value)} className="font-[inherit] text-[0.8125rem]" />
          </Field>
          {request.attachment && (
            <div className="flex items-center gap-2 rounded-md border bg-subtle px-3 py-2 text-[0.8125rem] text-muted-foreground">
              <Paperclip className="size-4" /> {request.attachmentLabel ?? "Document PDF joint"}
            </div>
          )}
          <p className="flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
            <ShieldCheck className="size-3.5" /> Aucun message n'est envoyé automatiquement. Vérifiez avant d'envoyer.
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close} disabled={sending}>
            Annuler
          </Button>
          <Button onClick={send} loading={sending} disabled={!connected || !validPhone || !message.trim()} className="bg-[#1fa855] hover:bg-[#1a9149]">
            <Send /> Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
