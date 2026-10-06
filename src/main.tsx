import "@fontsource-variable/inter";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { attachConsole } from "@tauri-apps/plugin-log";
import { App } from "./app/App";
import { setLocale } from "./i18n";
import { isTauri } from "./lib/tauri";
import { applyUi } from "./stores/ui";

setLocale("fr-MA");
applyUi();
if (import.meta.env.DEV && isTauri()) attachConsole().catch(() => undefined);

// Bloque le menu contextuel natif du navigateur (les menus DigiStock le remplacent).
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!["INPUT", "TEXTAREA"].includes(t.tagName)) e.preventDefault();
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
