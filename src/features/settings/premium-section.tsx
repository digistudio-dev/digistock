import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertTriangle, BadgeCheck, Check, ExternalLink, KeyRound, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card } from "@/components/ui/misc";
import { dateTime, date } from "@/lib/format";
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

const RENEWAL_URL = "https://digistudio.dev";

const DENIED: Record<string, string> = {
  revoked: "Cette licence a été révoquée. Contactez DigiStudio.",
  suspended: "Cette licence est suspendue. Contactez DigiStudio.",
  expired: "Cette licence annuelle est expirée. Renouvelez-la pour retrouver Premium.",
  not_activated: "Cet appareil n'est plus activé pour cette licence. Saisissez votre clé pour le réactiver.",
};

/** Message d'état à afficher quand Premium n'est pas (ou plus) disponible pour une licence connue. */
function problem(p: PremiumStatus): { title: string; text: string } | null {
  switch (p.state) {
    case "expired":
      return { title: "Licence expirée", text: `Votre licence annuelle a expiré${p.expires_at ? ` le ${date(p.expires_at)}` : ""}. Les fonctions Premium sont suspendues ; toutes vos données (produits, ventes, stock, clients) restent intactes et la version gratuite continue de fonctionner. Renouvelez votre licence, puis cliquez sur « Vérifier maintenant ».` };
    case "clock_rollback":
      return { title: "Horloge de l'ordinateur incorrecte", text: "La date de cet ordinateur est antérieure à une date déjà constatée. Corrigez la date et l'heure, puis connectez-vous à Internet et cliquez sur « Vérifier maintenant »." };
    case "offline_expired":
      return { title: "Vérification en ligne requise", text: "Cet appareil est resté hors ligne plus longtemps que la durée prévue par la licence. Connectez-vous à Internet puis cliquez sur « Vérifier maintenant »." };
    case "denied":
      return { title: "Licence refusée par le serveur", text: DENIED[p.denied_code ?? ""] ?? "Le serveur de licences a refusé cette licence. Contactez DigiStudio." };
    case "invalid":
      return { title: "Licence invalide sur cet appareil", text: "Le certificat de licence ne correspond pas à cet appareil. Saisissez à nouveau votre clé d'activation." };
    default:
      return null;
  }
}

export function PremiumSection() {
  const premium = useApp((s) => s.premium);
  const session = useApp((s) => s.session);
  const setPremium = useApp((s) => s.setPremium);
  const setSession = useApp((s) => s.setSession);
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [justActivated, setJustActivated] = useState(false);
  const isAdmin = session?.role_id === 1;
  const hasLicense = premium.kind !== null && premium.state !== "unlicensed";
  const issue = problem(premium);

  const apply = (res: { premium: PremiumStatus; session: Session }) => {
    setPremium(res.premium);
    setSession(res.session);
  };

  const activate = async () => {
    if (loading) return;
    setError(null);
    if (code.replace(/[^a-z0-9]/gi, "").length < 12) return setError("Clé invalide. Vérifiez la clé saisie.");
    setLoading(true);
    try {
      apply(await call<{ premium: PremiumStatus; session: Session }>("premium_activate", { code }));
      setCode("");
      setReplacing(false);
      setJustActivated(true);
      toast.success("DigiStock Premium est maintenant activé.");
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };

  const check = async () => {
    setChecking(true);
    try {
      apply(await call<{ premium: PremiumStatus; session: Session }>("premium_validate"));
      toast.success("Licence vérifiée.");
    } catch (e) {
      setPremium(await call<PremiumStatus>("premium_status").catch(() => premium));
      toast.error(toAppError(e).message);
    } finally {
      setChecking(false);
    }
  };

  const deactivate = async () => {
    const ok = await confirm({
      title: "Désactiver Premium sur cet appareil ?",
      description: "L'emplacement de licence sera libéré pour pouvoir activer un autre ordinateur. Vos données sont conservées ; la version gratuite reste disponible.",
      confirmLabel: "Désactiver cet appareil",
      danger: true,
    });
    if (ok === false) return;
    const run = (force: boolean) => call<{ premium: PremiumStatus; session: Session }>("premium_deactivate", { force });
    try {
      apply(await run(false));
      toast.success("Premium désactivé sur cet appareil.");
    } catch (e) {
      const msg = toAppError(e).message;
      if (!/Connexion Internet requise/.test(msg)) return void toast.error(msg);
      const local = await confirm({ title: "Hors ligne", description: msg, confirmLabel: "Désactiver ici seulement", danger: true });
      if (local === false) return;
      try {
        apply(await run(true));
        toast.success("Premium désactivé sur cet ordinateur.");
      } catch (e2) {
        toast.error(toAppError(e2).message);
      }
    }
  };

  const showForm = !premium.active || replacing;
  const kindLabel = premium.kind === "annual" ? "Annuelle" : premium.kind === "lifetime" ? "À vie" : premium.kind === "legacy" ? "Licence historique" : "—";

  return (
    <Card className="overflow-hidden">
      <div className="relative overflow-hidden bg-[hsl(222_45%_10%)] px-8 py-8 text-white">
        <div className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full bg-[hsl(221_75%_60%/0.35)] blur-3xl" />
        <div className="relative">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider ring-1 ring-white/15">
            <Sparkles className="size-3.5" /> DigiStock Premium
          </div>
          <h2 className="mt-4 text-[1.5rem] font-semibold">{premium.active ? "DigiStock Premium activé" : "Activer DigiStock Premium"}</h2>
          <p className="mt-1.5 max-w-lg text-[0.875rem] text-white/65">
            {premium.active ? "Merci pour votre confiance. Vos fonctionnalités Premium sont disponibles, même sans connexion Internet." : "Entrez votre clé de licence pour activer les fonctionnalités Premium de DigiStock."}
          </p>
        </div>
      </div>

      {issue && (
        <div className="flex items-start gap-3 border-b bg-warning-soft px-8 py-4 text-[0.8125rem]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <div className="font-semibold">{issue.title}</div>
            <p className="mt-0.5 text-foreground/80">{issue.text}</p>
          </div>
        </div>
      )}

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

        <div className="space-y-4">
          {premium.active && (
            <div className="rounded-xl border bg-subtle p-6">
              <div className="flex items-center gap-3">
                <BadgeCheck className="size-8 text-success" />
                <div>
                  <div className="font-semibold">{justActivated ? "Activation réussie" : "Premium activé"}</div>
                  <Badge tone="success" dot>{kindLabel}</Badge>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.8125rem]">
                {premium.reference && (<><dt className="text-muted-foreground">Référence</dt><dd className="font-mono">{premium.reference}</dd></>)}
                <dt className="text-muted-foreground">Activée le</dt><dd>{dateTime(premium.activated_at)}</dd>
                {premium.kind === "annual" && (<><dt className="text-muted-foreground">Expire le</dt><dd className="font-medium">{date(premium.expires_at)}</dd></>)}
                {premium.kind === "lifetime" && (<><dt className="text-muted-foreground">Expiration</dt><dd>Aucune (licence à vie)</dd></>)}
                {premium.kind !== "legacy" && (<><dt className="text-muted-foreground">Dernière vérification</dt><dd>{premium.last_validated_at ? dateTime(premium.last_validated_at) : "—"}</dd></>)}
                <dt className="text-muted-foreground">Appareil</dt><dd>{premium.device_label}{premium.installation_short ? ` · ${premium.installation_short}` : ""}</dd>
                <dt className="text-muted-foreground">État</dt><dd>Appareil activé</dd>
              </dl>
              {premium.kind === "legacy" && (
                <p className="mt-3 text-[0.75rem] text-muted-foreground">Cette activation provient d'une ancienne version. Elle reste valable ; vous pouvez la remplacer par une clé de licence DigiStudio.</p>
              )}
            </div>
          )}

          {hasLicense && !premium.active && (
            <div className="rounded-xl border bg-subtle p-5 text-[0.8125rem]">
              <div className="font-semibold">Licence {kindLabel.toLowerCase()} · {premium.reference}</div>
              <p className="mt-1 text-muted-foreground">Édition actuelle : version gratuite. Vos données sont intactes.</p>
            </div>
          )}

          {showForm && (
            <form
              className="flex flex-col justify-center gap-3 rounded-xl border bg-subtle p-6"
              onSubmit={(e) => {
                e.preventDefault();
                void activate();
              }}
            >
              <Field label={premium.active ? "Clé de remplacement" : "Clé d'activation"} error={error ?? undefined}>
                <Input inputSize="lg" leading={<KeyRound />} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="DGS-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" className="font-mono [&_input]:tracking-wider" aria-invalid={!!error} autoComplete="off" spellCheck={false} disabled={loading} />
              </Field>
              <Button type="submit" size="lg" loading={loading} disabled={loading}>
                <Sparkles /> {loading ? "Activation en cours…" : "Activer ma licence"}
              </Button>
              {!premium.active ? (
                <Button type="button" variant="ghost" onClick={() => navigate("/")} disabled={loading}>
                  Continuer avec la version gratuite
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => { setReplacing(false); setError(null); setCode(""); }} disabled={loading}>
                  Annuler
                </Button>
              )}
              <p className="text-[0.75rem] text-muted-foreground">Une connexion Internet est nécessaire pour la première activation uniquement. Ensuite, DigiStock fonctionne hors ligne.</p>
            </form>
          )}

          {hasLicense && (
            <div className="flex flex-wrap gap-2">
              {premium.kind !== "legacy" && (
                <Button variant="secondary" size="sm" onClick={check} loading={checking} disabled={checking}>
                  <RefreshCw /> Vérifier maintenant
                </Button>
              )}
              {(premium.kind === "annual" || premium.state === "expired") && (
                <Button variant="secondary" size="sm" onClick={() => openUrl(RENEWAL_URL)}>
                  <ExternalLink /> Renouveler ma licence
                </Button>
              )}
              {isAdmin && premium.active && !replacing && (
                <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
                  Saisir une clé de remplacement
                </Button>
              )}
              {isAdmin && premium.kind !== "legacy" && (
                <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={deactivate}>
                  Désactiver cet appareil
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
