import digistudioLogo from "@/assets/digistudio-logo-cropped.png";
import iconSrc from "@/assets/digistock-icon.png";
import logoInk from "@/assets/digistock-logo-ink.png";
import logoLight from "@/assets/digistock-logo.png";
import wordmarkInk from "@/assets/digistock-wordmark-ink.png";
import wordmarkLight from "@/assets/digistock-wordmark.png";
import { cn } from "@/lib/utils";

/** Icône DigiStock (carré arrondi « D » + carton). */
export function AppMark({ className }: { className?: string }) {
  return <img src={iconSrc} alt="" aria-hidden draggable={false} className={cn("size-8 shrink-0 select-none", className)} />;
}

/**
 * Logotype « DigiStock » + carton.
 * `inverted` : textes blancs pour fond sombre ; sinon s'adapte au thème (encre sombre en clair).
 */
export function Wordmark({ className, inverted }: { className?: string; inverted?: boolean }) {
  if (inverted) return <img src={wordmarkLight} alt="DigiStock" draggable={false} className={cn("h-7 w-auto max-w-full shrink-0 self-start object-contain select-none", className)} />;
  return (
    <>
      <img src={wordmarkInk} alt="DigiStock" draggable={false} className={cn("h-7 w-auto max-w-full shrink-0 self-start object-contain select-none dark:hidden", className)} />
      <img src={wordmarkLight} alt="DigiStock" draggable={false} className={cn("hidden h-7 w-auto max-w-full shrink-0 self-start object-contain select-none dark:block", className)} />
    </>
  );
}

/** Logo complet « DigiStock — powered by digistudio.dev ». */
export function BrandLogo({ className, inverted }: { className?: string; inverted?: boolean }) {
  if (inverted) return <img src={logoLight} alt="DigiStock — powered by digistudio.dev" draggable={false} className={cn("h-12 w-auto max-w-full shrink-0 object-contain select-none", className)} />;
  return (
    <>
      <img src={logoInk} alt="DigiStock — powered by digistudio.dev" draggable={false} className={cn("h-12 w-auto max-w-full shrink-0 object-contain select-none dark:hidden", className)} />
      <img src={logoLight} alt="DigiStock — powered by digistudio.dev" draggable={false} className={cn("hidden h-12 w-auto max-w-full shrink-0 object-contain select-none dark:block", className)} />
    </>
  );
}

/** Logo DigiStudio fourni (texte blanc, recadré) : à utiliser sur fond sombre. */
export function DigiStudioLogo({ className }: { className?: string }) {
  return <img src={digistudioLogo} alt="DigiStudio" draggable={false} className={cn("h-8 w-auto object-contain", className)} />;
}
