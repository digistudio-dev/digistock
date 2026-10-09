import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { CheckCircle2, Loader2, LogOut, MessageCircle, QrCode, RefreshCw, ShieldCheck, Smartphone, Sparkles, XCircle } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { select } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { call, isTauri, toAppError } from "@/lib/tauri";
import { usePremium } from "@/stores/app";
import type { WaStatus } from "@/types";

const KIND_LABEL: Record<string, string> = {
  supplier_order: "Commande fournisseur",
  payment_reminder: "Rappel de paiement",
  receipt: "Reçu",
  invoice: "Facture",
  purchase_order: "Bon de commande",
  custom: "Message",
};

const STATE: Record<WaStatus["state"], { label: string; tone: "success" | "warning" | "neutral" | "danger" | "info" }> = {
  disconnected: { label: "Non connecté", tone: "neutral" },
  starting: { label: "Connexion…", tone: "info" },
  qr: { label: "En attente du scan", tone: "warning" },
  connecting: { label: "Connexion…", tone: "info" },
  connected: { label: "Connecté", tone: "success" },
  error: { label: "Erreur", tone: "danger" },
};

export function WhatsAppPage() {
  const premium = usePremium();
  const gate = usePremiumGate();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [status, setStatus] = useState<WaStatus | null>(null);
  const [qrImg, setQrImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: initial } = useQuery({ queryKey: ["wa", "status", "page"], queryFn: () => call<WaStatus>("wa_status"), enabled: premium });
  useEffect(() => {
    if (initial) setStatus(initial);
  }, [initial]);

  useEffect(() => {
    if (!isTauri() || !premium) return;
    const un = listen<WaStatus>("wa://status", (e) => {
      setStatus(e.payload);
      qc.invalidateQueries({ queryKey: ["wa"] });
    });
    return () => {
      un.then((f) => f());
    };
  }, [premium, qc]);

  useEffect(() => {
    if (status?.qr) QRCode.toDataURL(status.qr, { width: 260, margin: 1, color: { dark: "#111827", light: "#ffffff" } }).then(setQrImg);
    else setQrImg(null);
  }, [status?.qr]);

  const { data: history = [] } = useQuery({
    queryKey: ["wa", "history"],
    enabled: premium,
    queryFn: () =>
      select<{ id: number; recipient_name: string | null; phone: string; message: string; kind: string; status: string; error: string | null; created_at: string; user_name: string | null }>(
        "SELECT m.*, u.name AS user_name FROM whatsapp_messages m LEFT JOIN users u ON u.id = m.user_id ORDER BY m.id DESC LIMIT 100",
      ),
  });

  const connect = async () => {
    setBusy(true);
    try {
      setStatus(await call<WaStatus>("wa_start"));
    } catch (e) {
      toast.error("Impossible de démarrer WhatsApp.", { description: toAppError(e).message });
    } finally {
      setBusy(false);
    }
  };

  const reconnect = async () => {
    setBusy(true);
    try {
      await call("wa_stop");
      setStatus(await call<WaStatus>("wa_start"));
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    const ok = await confirm({ title: "Déconnecter WhatsApp ?", description: "La session sera supprimée de cet ordinateur. Il faudra scanner à nouveau le QR code.", confirmLabel: "Déconnecter", danger: true });
    if (ok === false) return;
    setBusy(true);
    try {
      await call("wa_logout");
      setStatus({ state: "disconnected", qr: null, number: null, name: null, error: null });
      toast.success("WhatsApp déconnecté.");
    } finally {
      setBusy(false);
    }
  };

  if (!premium) {
    return (
      <Page>
        <PageHeader title="WhatsApp" description="Envoyez reçus, factures, relances et commandes fournisseurs depuis DigiStock." />
        <Card>
          <EmptyState
            icon={<MessageCircle />}
            title="WhatsApp est une fonctionnalité Premium"
            description="Connectez votre WhatsApp une seule fois avec un QR code, puis envoyez vos documents en un clic. Aucun message n'est jamais envoyé sans votre validation."
            actions={
              <Button onClick={() => gate.open("whatsapp")}>
                <Sparkles /> Découvrir Premium
              </Button>
            }
          />
        </Card>
      </Page>
    );
  }

  const st: WaStatus["state"] = status?.state && status.state in STATE ? status.state : "disconnected";
  const info = STATE[st] ?? STATE.disconnected;

  return (
    <Page>
      <PageHeader title="WhatsApp" description="Connexion locale et sécurisée : la session reste sur cet ordinateur." meta={<Badge tone={info.tone} dot>{info.label}</Badge>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        <Card className="p-6">
          {st === "connected" ? (
            <div className="text-center">
              <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-success-soft text-success">
                <CheckCircle2 className="size-8" />
              </div>
              <div className="text-[1.0625rem] font-semibold">WhatsApp connecté</div>
              {status?.number && <div className="num mt-1 text-[0.875rem] text-muted-foreground">+{status.number}</div>}
              {status?.name && <div className="text-[0.8125rem] text-muted-foreground">{status.name}</div>}
              <div className="mt-6 flex justify-center gap-2">
                <Button variant="secondary" onClick={reconnect} loading={busy}>
                  <RefreshCw /> Reconnecter
                </Button>
                <Button variant="danger-ghost" onClick={logout} disabled={busy}>
                  <LogOut /> Déconnecter
                </Button>
              </div>
            </div>
          ) : st === "qr" && qrImg ? (
            <div className="text-center">
              <div className="text-[1rem] font-semibold">Scannez ce QR code</div>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">Ouvrez WhatsApp › Appareils connectés › Connecter un appareil.</p>
              <div className="mx-auto mt-4 w-fit rounded-xl border bg-white p-3">
                <img src={qrImg} alt="QR code WhatsApp" className="size-[240px]" />
              </div>
              <p className="mt-3 text-[0.75rem] text-muted-foreground">Le code se renouvelle automatiquement.</p>
            </div>
          ) : st === "starting" || st === "connecting" ? (
            <div className="py-10 text-center">
              <Loader2 className="mx-auto mb-4 size-8 animate-spin text-primary" />
              <div className="font-semibold">Connexion…</div>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">Le premier démarrage peut prendre quelques secondes.</p>
            </div>
          ) : (
            <div className="text-center">
              <div className={"mx-auto mb-4 flex size-16 items-center justify-center rounded-full " + (st === "error" ? "bg-danger-soft text-danger" : "bg-muted text-muted-foreground")}>
                {st === "error" ? <XCircle className="size-8" /> : <QrCode className="size-8" />}
              </div>
              <div className="text-[1.0625rem] font-semibold">{st === "error" ? "La connexion a échoué" : "WhatsApp non connecté"}</div>
              <p className="mx-auto mt-1 max-w-xs text-[0.8125rem] text-muted-foreground">{status?.error ?? "Connectez votre compte WhatsApp professionnel en scannant un QR code."}</p>
              <Button className="mt-6" onClick={connect} loading={busy}>
                <Smartphone /> Connecter WhatsApp
              </Button>
            </div>
          )}
          <div className="mt-6 flex items-start gap-2 rounded-lg bg-subtle p-3 text-[0.75rem] text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
            Aucun message n'est envoyé automatiquement : chaque envoi doit être confirmé par un clic sur « Envoyer ».
          </div>
          <Button variant="link" className="mt-3 text-[0.8125rem]" onClick={() => navigate("/settings/whatsapp")}>
            Modifier les modèles de messages
          </Button>
        </Card>
        <Card>
          <CardHeader title="Messages envoyés" description="Historique des 100 derniers messages." />
          {history.length === 0 ? (
            <EmptyState compact icon={<MessageCircle />} title="Aucun message" description="Les messages envoyés depuis DigiStock apparaîtront ici." />
          ) : (
            <div className="mt-3 max-h-[560px] divide-y overflow-y-auto border-t">
              {history.map((m) => (
                <div key={m.id} className="px-5 py-3 text-[0.8125rem]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{m.recipient_name ?? formatPhone(m.phone)}</span>
                    <Badge>{KIND_LABEL[m.kind] ?? m.kind}</Badge>
                    {m.status === "failed" ? <Badge tone="danger">Échec</Badge> : <Badge tone="success">Envoyé</Badge>}
                    <span className="ml-auto text-[0.75rem] text-muted-foreground">{dateTime(m.created_at)}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-muted-foreground">{m.message}</p>
                  {m.error && <p className="mt-1 text-[0.75rem] text-danger">{m.error}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
