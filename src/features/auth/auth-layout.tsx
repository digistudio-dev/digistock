import type { ReactNode } from "react";
import { DigiStudioLogo, Wordmark } from "@/components/common/brand";

/** Mise en page des écrans d'accueil : panneau de marque à gauche, contenu à droite. */
export function AuthLayout({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex h-screen bg-background">
      <div className="relative hidden w-[42%] max-w-[560px] flex-col justify-between overflow-hidden bg-[hsl(222_47%_7%)] p-10 text-white lg:flex">
        <div className="pointer-events-none absolute -left-24 top-1/3 size-[420px] rounded-full bg-[hsl(221_70%_55%/0.22)] blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-32 right-0 size-[360px] rounded-full bg-[hsl(250_70%_55%/0.14)] blur-[90px]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.07] [background-image:linear-gradient(hsl(0_0%_100%)_1px,transparent_1px),linear-gradient(90deg,hsl(0_0%_100%)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
        <Wordmark inverted className="relative h-8" />
        <div className="relative">{aside}</div>
        <div className="relative flex items-center justify-between">
          <span className="text-[0.75rem] text-white/50">DigiStock par DigiStudio</span>
          <DigiStudioLogo className="h-9 opacity-90" />
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}

export function BrandAside() {
  return (
    <div className="max-w-sm">
      <h2 className="text-[1.75rem] font-semibold leading-[1.15] tracking-tight">
        Votre stock, vos ventes,
        <br />
        <span className="text-[hsl(221_90%_80%)]">sous contrôle.</span>
      </h2>
      <p className="mt-4 text-[0.875rem] leading-relaxed text-white/60">
        Caisse rapide, gestion de stock, crédits clients et fournisseurs. Conçu pour les commerces et entreprises au Maroc — et 100 % hors ligne.
      </p>
      <div className="mt-8 grid grid-cols-3 gap-3">
        {[
          ["Caisse", "rapide"],
          ["Stock", "tracé"],
          ["Données", "locales"],
        ].map(([a, b]) => (
          <div key={a} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5">
            <div className="text-[0.8125rem] font-semibold">{a}</div>
            <div className="text-[0.75rem] text-white/50">{b}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
