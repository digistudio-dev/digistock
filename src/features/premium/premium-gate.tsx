import { Check, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { useApp } from "@/stores/app";

export type PremiumFeature =
  | "general"
  | "whatsapp"
  | "users"
  | "activity"
  | "warehouses"
  | "transfers"
  | "auto_backup"
  | "advanced_reports"
  | "reorder"
  | "expiration";

const FEATURES: Record<PremiumFeature, { title: string; benefits: string[] }> = {
  general: {
    title: "Fonctionnalité Premium",
    benefits: ["WhatsApp intégré pour clients et fournisseurs", "Utilisateurs multiples et permissions", "Sauvegardes automatiques", "Rapports avancés"],
  },
  whatsapp: {
    title: "WhatsApp intégré",
    benefits: [
      "Envoyez reçus et factures en un clic",
      "Relances de paiement aux clients",
      "Commandes fournisseurs depuis les alertes de stock",
      "Rien n'est envoyé sans votre validation",
    ],
  },
  users: {
    title: "Utilisateurs multiples",
    benefits: ["Comptes séparés pour chaque employé", "Rôles : Gérant, Caissier, Magasinier", "Masquez prix d'achat et bénéfices aux caissiers", "Journal d'activité par utilisateur"],
  },
  activity: {
    title: "Journal d'activité",
    benefits: ["Qui a vendu, annulé ou modifié le stock", "Historique horodaté de chaque action", "Contrôle et traçabilité de votre équipe"],
  },
  warehouses: {
    title: "Entrepôts multiples",
    benefits: ["Stock par magasin et par entrepôt", "Transferts entre emplacements", "Inventaires par entrepôt"],
  },
  transfers: {
    title: "Transferts de stock",
    benefits: ["Déplacez la marchandise entre entrepôts", "Mouvements tracés des deux côtés", "Numérotation TRF automatique"],
  },
  auto_backup: {
    title: "Sauvegardes automatiques",
    benefits: ["Sauvegarde quotidienne ou hebdomadaire", "Conservation des 7, 30 dernières copies ou plus", "Vos données protégées sans y penser"],
  },
  advanced_reports: {
    title: "Rapports avancés",
    benefits: ["Bénéfice par produit et par catégorie", "Meilleurs clients et dettes", "Achats par fournisseur", "Exports PDF détaillés"],
  },
  reorder: {
    title: "Suggestions de réapprovisionnement avancées",
    benefits: ["Basées sur vos ventes réelles", "Tiennent compte du délai fournisseur", "Estimation des jours de stock restants"],
  },
  expiration: {
    title: "Gestion avancée des expirations",
    benefits: ["Suivi par lot et date d'expiration", "Alertes 7 et 30 jours", "Sortie automatique des lots les plus anciens"],
  },
};

interface GateState {
  feature: PremiumFeature | null;
  open: (f: PremiumFeature) => void;
  close: () => void;
}

const useGateStore = create<GateState>((set) => ({
  feature: null,
  open: (feature) => set({ feature }),
  close: () => set({ feature: null }),
}));

/** `gate.check("whatsapp")` : vrai si Premium, sinon ouvre la fenêtre Premium. */
export function usePremiumGate() {
  const open = useGateStore((s) => s.open);
  return {
    open,
    check: (f: PremiumFeature) => {
      if (useApp.getState().premium.active) return true;
      open(f);
      return false;
    },
  };
}

export function PremiumGateHost() {
  const { feature, close } = useGateStore();
  const navigate = useNavigate();
  const info = FEATURES[feature ?? "general"];
  return (
    <Dialog open={!!feature} onOpenChange={(o) => !o && close()}>
      <DialogContent size="sm" hideClose className="overflow-hidden">
        <div className="relative overflow-hidden border-b bg-[hsl(221_45%_12%)] px-6 pb-6 pt-7 text-white">
          <div className="absolute -right-10 -top-16 size-48 rounded-full bg-[hsl(221_70%_60%/0.35)] blur-3xl" />
          <div className="relative">
            <div className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-white/90 ring-1 ring-white/15">
              <Sparkles className="size-3.5" /> Fonctionnalité Premium
            </div>
            <h2 className="text-[1.25rem] font-semibold leading-tight">{info.title}</h2>
            <p className="mt-1.5 text-[0.8125rem] text-white/70">Cette fonctionnalité est disponible avec DigiStock Premium.</p>
          </div>
        </div>
        <ul className="space-y-2.5 px-6 py-5">
          {info.benefits.map((b) => (
            <li key={b} className="flex items-start gap-2.5 text-[0.8125rem]">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                <Check className="size-3" strokeWidth={3} />
              </span>
              {b}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            Plus tard
          </Button>
          <Button
            onClick={() => {
              close();
              navigate("/settings/premium");
            }}
          >
            <Sparkles /> Activer Premium
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
