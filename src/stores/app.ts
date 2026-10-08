import { create } from "zustand";
import { select, one } from "@/lib/db";
import { setImagesDir } from "@/lib/files";
import { hasPermission, type Permission } from "@/lib/permissions";
import { mergeSettings, type Settings, DEFAULT_SETTINGS } from "@/lib/settings";
import { call } from "@/lib/tauri";
import type { Bootstrap, Company, PremiumStatus, Session } from "@/types";

interface AppState {
  ready: boolean;
  bootstrap: Bootstrap | null;
  session: Session | null;
  premium: PremiumStatus;
  company: Company | null;
  settings: Settings;
  locked: boolean;
  init: () => Promise<void>;
  loadContext: () => Promise<void>;
  setSession: (s: Session | null) => void;
  setPremium: (p: PremiumStatus) => void;
  refreshCompany: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  saveSettings: (values: Partial<Settings>) => Promise<void>;
  logout: () => Promise<void>;
  lock: () => void;
  unlock: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  bootstrap: null,
  session: null,
  premium: { active: false, activated_at: null },
  company: null,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  locked: false,

  init: async () => {
    const b = await call<Bootstrap>("app_bootstrap");
    setImagesDir(b.images_dir);
    set({ bootstrap: b, premium: b.premium, session: b.session });
    if (b.session) await get().loadContext();
    set({ ready: true });
  },

  loadContext: async () => {
    await Promise.all([get().refreshCompany(), get().refreshSettings()]);
  },

  setSession: (s) => set({ session: s, locked: false }),
  setPremium: (p) => set({ premium: p }),

  refreshCompany: async () => {
    const c = await one<Company>("SELECT * FROM companies WHERE id = 1");
    set({ company: c });
  },

  refreshSettings: async () => {
    const rows = await select<{ key: string; value: string }>("SELECT key, value FROM settings");
    set({ settings: mergeSettings(rows) });
  },

  saveSettings: async (values) => {
    await call("settings_set", { values });
    await get().refreshSettings();
  },

  logout: async () => {
    await call("auth_logout").catch(() => undefined);
    set({ session: null, locked: false });
  },

  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));

/** Vérifie une permission de l'utilisateur courant. */
export function useCan() {
  const perms = useApp((s) => s.session?.permissions);
  return (p: Permission | Permission[]) => hasPermission(perms, p);
}

export const usePremium = () => useApp((s) => s.premium.active);
export const useSettings = () => useApp((s) => s.settings);
