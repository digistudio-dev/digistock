import { useQuery, useQueryClient } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ArchiveRestore, DatabaseBackup, FolderOpen, HardDriveDownload, History, Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { confirm } from "@/components/common/confirm";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { PremiumBadge } from "@/components/common/status";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { Badge, Card, CardHeader, Switch } from "@/components/ui/misc";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { dateTime, fileSize, relative } from "@/lib/format";
import { call, toAppError } from "@/lib/tauri";
import { useApp, usePremium, useSettings } from "@/stores/app";
import type { BackupInfo } from "@/types";

const KIND: Record<BackupInfo["kind"], { label: string; tone: "neutral" | "primary" | "warning" }> = {
  manual: { label: "Manuelle", tone: "neutral" },
  automatic: { label: "Automatique", tone: "primary" },
  pre_restore: { label: "Avant restauration", tone: "warning" },
};

export function BackupPage() {
  const premium = usePremium();
  const gate = usePremiumGate();
  const settings = useSettings();
  const saveSettings = useApp((s) => s.saveSettings);
  const init = useApp((s) => s.init);
  const backupsDir = useApp((s) => s.bootstrap?.backups_dir);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const { data: backups = [], isLoading } = useQuery({ queryKey: ["backups"], queryFn: () => call<BackupInfo[]>("backup_list") });

  const create = async (exportTo: boolean) => {
    setBusy(exportTo ? "export" : "create");
    try {
      const info = await call<BackupInfo | null>("backup_create", { export: exportTo });
      if (info) {
        toast.success("Sauvegarde terminée.", { description: info.file_name });
        qc.invalidateQueries({ queryKey: ["backups"] });
        useApp.getState().refreshSettings();
      }
    } catch (e) {
      toast.error("La sauvegarde a échoué.", { description: toAppError(e).message });
    } finally {
      setBusy(null);
    }
  };

  const restore = async (fileName: string | null) => {
    const ok = await confirm({
      title: "Restaurer une sauvegarde ?",
      description: "Les données actuelles seront remplacées par celles de la sauvegarde. Une copie de sécurité de la base actuelle sera créée automatiquement avant la restauration.",
      confirmLabel: "Restaurer",
      danger: true,
    });
    if (ok === false) return;
    setBusy("restore");
    try {
      const done = await call<boolean>("backup_restore", { fileName });
      if (done) {
        toast.success("Sauvegarde restaurée.", { description: "Veuillez vous reconnecter." });
        qc.clear();
        await init();
      }
    } catch (e) {
      toast.error("La restauration a échoué.", { description: toAppError(e).message });
    } finally {
      setBusy(null);
    }
  };

  const setAuto = async (patch: Partial<{ "backup.auto_enabled": boolean; "backup.frequency": string; "backup.keep": number }>) => {
    if (!premium) return gate.open("auto_backup");
    try {
      await saveSettings(patch as never);
      toast.success("Paramètres de sauvegarde enregistrés.");
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  // La date la plus fiable est celle des fichiers présents (le paramètre est remplacé lors d'une restauration).
  const newestFile = backups.find((b) => b.kind !== "pre_restore")?.created_at;
  const last = [newestFile, settings["backup.last_at"]].filter(Boolean).sort().at(-1) ?? "";
  const stale = !last || Date.now() - new Date(String(last).replace(" ", "T")).getTime() > 7 * 86_400_000;

  return (
    <Page>
      <PageHeader
        title="Sauvegarde"
        description="Protégez vos données : une sauvegarde contient tous vos produits, ventes, clients et paramètres."
        actions={
          <>
            <Button variant="secondary" onClick={() => restore(null)} loading={busy === "restore"}>
              <ArchiveRestore /> Restaurer une sauvegarde
            </Button>
            <Button variant="secondary" onClick={() => create(true)} loading={busy === "export"}>
              <HardDriveDownload /> Exporter vers…
            </Button>
            <Button onClick={() => create(false)} loading={busy === "create"}>
              <DatabaseBackup /> Créer une sauvegarde
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex items-center gap-4 p-5">
          <span className={"flex size-11 items-center justify-center rounded-xl " + (stale ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <div className="text-[0.8125rem] text-muted-foreground">Dernière sauvegarde</div>
            <div className="text-[1.0625rem] font-semibold">{last ? dateTime(String(last)) : "Aucune sauvegarde"}</div>
            <div className="text-[0.75rem] text-muted-foreground">{last ? (stale ? "Pensez à sauvegarder régulièrement." : relative(String(last))) : "Créez votre première sauvegarde maintenant."}</div>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <History className="size-4 text-muted-foreground" /> Sauvegardes automatiques {!premium && <PremiumBadge />}
            </div>
            <Switch checked={premium && !!settings["backup.auto_enabled"]} onCheckedChange={(v) => setAuto({ "backup.auto_enabled": v })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fréquence">
              <Select inputSize="sm" disabled={!premium} value={String(settings["backup.frequency"])} onChange={(e) => setAuto({ "backup.frequency": e.target.value })}>
                <option value="daily">Chaque jour</option>
                <option value="weekly">Chaque semaine</option>
              </Select>
            </Field>
            <Field label="Conserver">
              <Select inputSize="sm" disabled={!premium} value={String(settings["backup.keep"])} onChange={(e) => setAuto({ "backup.keep": Number(e.target.value) })}>
                {[3, 7, 14, 30, 60, 90].map((n) => (
                  <option key={n} value={n}>
                    Les {n} dernières
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {!premium && (
            <button onClick={() => gate.open("auto_backup")} className="mt-3 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground hover:text-foreground">
              <Lock className="size-3" /> Activez Premium pour des sauvegardes sans y penser.
            </button>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Sauvegardes locales"
          description={backupsDir}
          actions={
            backupsDir && (
              <Button variant="ghost" size="sm" onClick={() => revealItemInDir(backups[0]?.path ?? backupsDir).catch(() => toast.error("Dossier introuvable. Créez d'abord une sauvegarde."))}>
                <FolderOpen /> Ouvrir le dossier
              </Button>
            )
          }
        />
        {isLoading ? null : backups.length === 0 ? (
          <EmptyState compact icon={<DatabaseBackup />} title="Aucune sauvegarde" description="Cliquez sur « Créer une sauvegarde » pour enregistrer une copie complète de vos données." />
        ) : (
          <table className="mt-3 w-full text-[0.8125rem]">
            <thead>
              <tr className="border-y bg-subtle text-left text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-5 py-2">Fichier</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2 text-right">Taille</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.file_name} className="border-b last:border-0">
                  <td className="px-5 py-2.5 font-medium">{b.file_name}</td>
                  <td className="px-3">
                    <Badge tone={KIND[b.kind].tone}>{KIND[b.kind].label}</Badge>
                  </td>
                  <td className="num px-3 text-muted-foreground">{dateTime(b.created_at)}</td>
                  <td className="num px-3 text-right text-muted-foreground">{fileSize(b.size)}</td>
                  <td className="px-5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => restore(b.file_name)} disabled={!!busy}>
                      <RotateCcw /> Restaurer
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </Page>
  );
}
