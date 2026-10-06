import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";
import { call, isTauri } from "@/lib/tauri";

/**
 * Mises à jour automatiques (tauri-plugin-updater).
 * Les paquets sont signés : seule une mise à jour signée par la clé DigiStudio est acceptée.
 * Source : https://github.com/digistudio-dev/digistock/releases/latest/download/latest.json
 */
type Phase = "idle" | "checking" | "available" | "uptodate" | "downloading" | "installing" | "error";

interface UpdateState {
  phase: Phase;
  update: Update | null;
  progress: number;
  error: string | null;
  checkedAt: Date | null;
  checkNow: () => Promise<Update | null>;
  install: () => Promise<void>;
}

export const useUpdater = create<UpdateState>((set, get) => ({
  phase: "idle",
  update: null,
  progress: 0,
  error: null,
  checkedAt: null,

  checkNow: async () => {
    if (!isTauri()) return null;
    set({ phase: "checking", error: null });
    try {
      const update = await check({ timeout: 20_000 });
      set({ update, phase: update ? "available" : "uptodate", checkedAt: new Date() });
      return update;
    } catch (e) {
      set({ phase: "error", error: "Impossible de vérifier les mises à jour. Vérifiez votre connexion Internet.", checkedAt: new Date() });
      console.warn("updater", e);
      return null;
    }
  },

  install: async () => {
    const update = get().update;
    if (!update) return;
    // Sauvegarde de sécurité avant mise à jour (ignorée si l'utilisateur n'a pas le droit).
    await call("backup_create", { export: false }).catch(() => undefined);
    set({ phase: "downloading", progress: 0, error: null });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          received += event.data.chunkLength;
          set({ progress: total ? Math.min(99, Math.round((received / total) * 100)) : 0 });
        } else if (event.event === "Finished") set({ phase: "installing", progress: 100 });
      });
      // Sous Windows l'installateur ferme puis relance l'application ; ailleurs on relance nous-mêmes.
      await relaunch();
    } catch (e) {
      console.error("updater install", e);
      set({ phase: "error", error: "Le téléchargement de la mise à jour a échoué. Réessayez plus tard." });
    }
  },
}));
