import { BadgeCheck, Check, KeyRound, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card } from "@/components/ui/misc";
import { dateTime } from "@/lib/format";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import type { PremiumStatus, Session } from "@/types";

const BENEFITS = [
  "WhatsApp : reçus, factures, relances, commandes fournisseurs",
  "Utilisateurs multiples, rôles et permissions",
  "Journal d'activité de l'équipe",
  "Entrepôts multiples et transferts de stock",
  "Sauvegardes automatiques",
  "Rapports avancés et exports PDF détaillés",
  "Suggestions de réapprovisionnement avancées",
  "Gestion avancée des expirations",
];

export function PremiumSection() {
  const premium = useApp((s) => s.premium);
  const session = useApp((s) => s.session);
  const setPremium = useApp((s) => s.setPremium);
  const setSession = useApp((s) => s.setSession);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const activate = async () => {
    setError(null);
    if (code.replace(/[^a-z0-9]/gi, "").length < 8) return setError("Saisissez un code d'activation valide.");
    setLoading(true);
    try {
      const res = await call<{ premium: PremiumStatus; session: Session }>("premium_activate", { code });
      setPremium(res.premium);
      setSession(res.session);
      setCode("");
      toast.success("DigiStock Premium est maintenant activé.");
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };

  const deactivate = async () => {
    const ok = await confirm({ title: "Désactiver Premium ?", description: "Les fonctionnalités Premium seront masquées. Vos données sont conservées et Premium pourra être réactivé avec un code valide.", confirmLabel: "Désactiver", danger: true });
    if (ok === false) return;
    try {
      const res = await call<{ premium: PremiumStatus; session: Session }>("premium_deactivate");
      setPremium(res.premium);
      setSession(res.session);
      toast.success("Premium désactivé.");
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-hidden bg-[hsl(222_45%_10%)] px-8 py-8 text-white">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[hsl(221_75%_60%/0.35)] blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider ring-1 ring-white/15">
            <Sparkles className="size-3.5" /> DigiStock Premium
          </div>
          <h2 className="mt-4 text-[1.5rem] font-semibold">{premium.active ? "Premium activé" : "Activez toutes les fonctionnalités de DigiStock."}</h2>
          <p className="mt-1.5 max-w-lg text-[0.875rem] text-white/65">
            {premium.active ? `Activé le ${dateTime(premium.activated_at)}. Merci pour votre confiance.` : "Activation hors ligne, immédiate, avec votre code d'activation."}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-8 p-8 md:grid-cols-2">
        <ul className="space-y-2.5">
          {BENEFITS.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[0.8125rem]">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {b}
            </li>
          ))}
        </ul>
        {premium.active ? (
          <div className="flex flex-col items-start justify-center gap-4 rounded-xl border bg-subtle p-6">
            <div className="flex items-center gap-3">
              <BadgeCheck className="size-8 text-success" />
              <div>
                <div className="font-semibold">Premium activé</div>
                <div className="text-[0.8125rem] text-muted-foreground">Date d'activation : {dateTime(premium.activated_at)}</div>
              </div>
            </div>
            {session?.role_id === 1 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={deactivate}>
                Désactiver Premium
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex flex-col justify-center gap-4 rounded-xl border bg-subtle p-6"
            onSubmit={(e) => {
              e.preventDefault();
              activate();
            }}
          >
            <Field label="Code d'activation" error={error ?? undefined}>
              <Input inputSize="lg" leading={<KeyRound />} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DGS-XXXX-XXXX-XXXX-XXXX" className="font-mono [&_input]:tracking-wider" aria-invalid={!!error} autoComplete="off" spellCheck={false} />
            </Field>
            <Button type="submit" size="lg" loading={loading}>
              <Sparkles /> Activer DigiStock Premium
            </Button>
            <p className="text-[0.75rem] text-muted-foreground">Aucune connexion Internet requise. Le code est vérifié localement de façon sécurisée.</p>
          </form>
        )}
      </div>
    </Card>
  );
}
