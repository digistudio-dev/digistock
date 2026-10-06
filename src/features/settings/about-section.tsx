import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, Keyboard } from "lucide-react";
import { toast } from "sonner";
import { AppMark, BrandLogo } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { Badge, Card } from "@/components/ui/misc";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import { UpdatePanel } from "@/features/updates/update-panel";

const SHORTCUTS = [
  ["Ctrl + K", "Recherche globale"],
  ["F2", "Nouvelle vente"],
  ["F3", "Produits"],
  ["F4", "Clients"],
  ["F5", "Actualiser"],
  ["Ctrl + P", "Imprimer le document courant"],
  ["Ctrl + S", "Enregistrer le formulaire"],
  ["Échap", "Fermer une fenêtre"],
  ["F9 / Entrée", "Caisse : valider la vente"],
  ["F6 / F7 / F8", "Caisse : espèces / carte / crédit"],
  ["3*", "Caisse : quantité avant scan"],
];

export function AboutSection() {
  const version = useApp((s) => s.bootstrap?.version);
  const premium = useApp((s) => s.premium.active);

  const exportLogs = async () => {
    try {
      const path = await call<string | null>("logs_export");
      if (path) toast.success("Journal technique exporté.", { description: path });
    } catch (e) {
      toast.error(toAppError(e).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="flex flex-col items-center bg-[hsl(222_47%_7%)] px-8 py-10 text-center text-white">
          <AppMark className="size-20" />
          <BrandLogo inverted className="mt-5 h-14" />
          <div className="mt-2 flex items-center gap-2 text-[0.8125rem] text-white/60">
            Version {version} <Badge tone={premium ? "primary" : "neutral"}>{premium ? "Premium" : "Free"}</Badge>
          </div>
          <p className="mt-5 text-[0.8125rem] text-white/60">DigiStock par DigiStudio</p>
          <Button variant="link" className="mt-2 text-[hsl(221_90%_80%)]" onClick={() => openUrl("https://digistudio.dev").catch(() => undefined)}>
            digistudio.dev <ExternalLink />
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 text-[0.8125rem]">
          <span className="text-muted-foreground">Besoin d'aide ? Exportez le journal technique et envoyez-le au support DigiStudio.</span>
          <Button variant="secondary" size="sm" onClick={exportLogs}>
            <FileText /> Exporter le journal technique
          </Button>
        </div>
      </Card>
      <UpdatePanel />
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2 font-semibold">
          <Keyboard className="size-4 text-muted-foreground" /> Raccourcis clavier
        </div>
        <div className="grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
          {SHORTCUTS.map(([k, l]) => (
            <div key={k} className="flex items-center justify-between border-b py-1.5 text-[0.8125rem] last:border-0">
              <span className="text-muted-foreground">{l}</span>
              <span className="kbd">{k}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
