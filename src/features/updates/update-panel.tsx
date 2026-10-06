import { CheckCircle2, Download, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { useApp } from "@/stores/app";
import { useUpdater } from "./updater";

/** Bloc « Mises à jour » de Paramètres › À propos. */
export function UpdatePanel() {
  const version = useApp((s) => s.bootstrap?.version);
  const { phase, update, progress, error, checkedAt, checkNow, install } = useUpdater();
  const busy = phase === "checking" || phase === "downloading" || phase === "installing";

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-muted-foreground" /> Mises à jour
          </div>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Version installée : <span className="font-medium text-foreground">{version}</span>
            {checkedAt && <> · vérifié {relative(checkedAt)}</>}
          </p>
        </div>
        {phase !== "available" && (
          <Button variant="secondary" size="sm" onClick={() => checkNow()} disabled={busy}>
            {phase === "checking" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Rechercher une mise à jour
          </Button>
        )}
      </div>

      {phase === "uptodate" && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-[0.8125rem] font-medium text-success">
          <CheckCircle2 className="size-4" /> DigiStock est à jour.
        </div>
      )}
      {phase === "error" && error && <div className="mt-4 rounded-lg bg-danger-soft px-4 py-3 text-[0.8125rem] text-danger">{error}</div>}

      {update && (phase === "available" || phase === "downloading" || phase === "installing") && (
        <div className="mt-4 rounded-lg border border-primary/25 bg-primary-soft/50 p-4">
          <div className="text-[0.875rem] font-semibold">DigiStock {update.version} est disponible</div>
          {update.body && <p className="mt-1 whitespace-pre-line text-[0.8125rem] text-muted-foreground">{update.body}</p>}
          {phase === "available" ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button onClick={install}>
                <Download /> Installer la mise à jour
              </Button>
              <span className="text-[0.75rem] text-muted-foreground">Une sauvegarde est créée automatiquement. Vos données sont conservées.</span>
            </div>
          ) : (
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between text-[0.75rem] text-muted-foreground">
                <span>{phase === "installing" ? "Installation… DigiStock va redémarrer." : "Téléchargement…"}</span>
                <span className="num">{progress} %</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
