import { create } from "zustand";

/** Préférences d'affichage propres au poste (stockées localement). */
export type Theme = "light" | "dark" | "system";
export type Density = "comfortable" | "compact";
export type FontSize = "small" | "medium" | "large";

interface UiState {
  theme: Theme;
  density: Density;
  fontSize: FontSize;
  sidebarCollapsed: boolean;
  setTheme: (t: Theme) => void;
  setDensity: (d: Density) => void;
  setFontSize: (f: FontSize) => void;
  toggleSidebar: () => void;
}

const KEY = "digistock.ui";

function load(): Partial<UiState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function persist(s: UiState) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ theme: s.theme, density: s.density, fontSize: s.fontSize, sidebarCollapsed: s.sidebarCollapsed }),
    );
  } catch {
    /* stockage indisponible : préférences non mémorisées */
  }
}

const initial = load();

export const useUi = create<UiState>((set, get) => ({
  theme: initial.theme ?? "system",
  density: initial.density ?? "comfortable",
  fontSize: initial.fontSize ?? "medium",
  sidebarCollapsed: initial.sidebarCollapsed ?? false,
  setTheme: (theme) => {
    set({ theme });
    persist(get());
    applyUi();
  },
  setDensity: (density) => {
    set({ density });
    persist(get());
    applyUi();
  },
  setFontSize: (fontSize) => {
    set({ fontSize });
    persist(get());
    applyUi();
  },
  toggleSidebar: () => {
    set({ sidebarCollapsed: !get().sidebarCollapsed });
    persist(get());
  },
}));

const FONT_PX: Record<FontSize, string> = { small: "13px", medium: "14px", large: "15.5px" };
const media = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

export function applyUi() {
  const { theme, density, fontSize } = useUi.getState();
  const dark = theme === "dark" || (theme === "system" && !!media?.matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.density = density;
  root.style.setProperty("--app-font-size", FONT_PX[fontSize]);
}

media?.addEventListener("change", () => applyUi());

export const isDark = () => document.documentElement.classList.contains("dark");
