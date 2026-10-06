import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { PackageSearch, Plus } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ConfirmHost } from "@/components/common/confirm";
import { LoadingRows } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { LockScreen } from "@/features/auth/lock-screen";
import { PremiumGateHost } from "@/features/premium/premium-gate";
import { StockAdjustHost } from "@/features/stock/adjust-dialog";
import { WhatsAppComposerHost } from "@/features/whatsapp/composer";
import { useUpdater } from "@/features/updates/updater";
import { useBarcodeScanner } from "@/hooks/use-barcode";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { one } from "@/lib/db";
import { call, isTauri } from "@/lib/tauri";
import { useApp, useCan } from "@/stores/app";
import { dispatchScan } from "@/stores/scan";
import { CommandPalette, usePalette } from "./command-palette";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const can = useCan();
  const locked = useApp((s) => s.locked);
  const setPalette = usePalette((s) => s.setOpen);
  const [notFound, setNotFound] = useState<string | null>(null);

  // Raccourcis globaux
  useShortcuts(
    {
      "ctrl+k": () => setPalette(true),
      f2: () => can("create_sales") && navigate("/pos"),
      f3: () => navigate("/products"),
      f4: () => navigate("/customers"),
      f5: () => {
        qc.invalidateQueries();
        toast.success("Données actualisées.");
      },
      "ctrl+r": () => qc.invalidateQueries(),
    },
    !locked,
  );

  // Scan global : la page active peut l'intercepter, sinon on ouvre la fiche produit.
  useBarcodeScanner(async (code) => {
    if (dispatchScan(code)) return;
    const p = await one<{ id: number }>("SELECT id FROM products WHERE barcode = ? AND archived = 0", [code]);
    if (p) navigate(`/products/${p.id}`);
    else setNotFound(code);
  }, !locked);

  // Événements du backend
  useEffect(() => {
    if (!isTauri()) return;
    const subs = [
      listen("wa://ready", () => {
        toast.success("WhatsApp connecté.");
        qc.invalidateQueries({ queryKey: ["wa"] });
      }),
      listen("backup://done", () => {
        toast.success("Sauvegarde terminée.", { description: "Sauvegarde automatique effectuée." });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      }),
    ];
    // Recherche silencieuse de mise à jour, quelques secondes après l'ouverture.
    const upd = setTimeout(async () => {
      const u = await useUpdater.getState().checkNow();
      if (u) toast.info(`DigiStock ${u.version} est disponible`, { duration: 15_000, action: { label: "Voir", onClick: () => navigate("/settings/about") } });
    }, 4000);
    // Analyse quotidienne des expirations.
    call("notifications_scan").catch(() => undefined);
    const id = setInterval(() => call("notifications_scan").catch(() => undefined), 6 * 60 * 60 * 1000);
    return () => {
      subs.forEach((p) => p.then((un) => un()));
      clearInterval(id);
      clearTimeout(upd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qc]);

  const fullBleed = location.pathname === "/pos";

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className={fullBleed ? "min-h-0 flex-1 overflow-hidden" : "scroll-area min-h-0 flex-1"}>
          <Suspense fallback={<LoadingRows />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <CommandPalette />
      <ConfirmHost />
      <PremiumGateHost />
      <StockAdjustHost />
      <WhatsAppComposerHost />
      {locked && <LockScreen />}
      <Dialog open={!!notFound} onOpenChange={(o) => !o && setNotFound(null)}>
        <DialogContent size="sm" title="Produit introuvable" description={`Aucun produit ne correspond au code-barres ${notFound ?? ""}.`} icon={<PackageSearch />}>
          <div className="h-2" />
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNotFound(null)}>
              Fermer
            </Button>
            {can("manage_products") && (
              <Button
                autoFocus
                onClick={() => {
                  const code = notFound;
                  setNotFound(null);
                  navigate(`/products/new?barcode=${encodeURIComponent(code ?? "")}`);
                }}
              >
                <Plus /> Créer ce produit
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
