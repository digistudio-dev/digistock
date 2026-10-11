import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** Saisie d'un code PIN à 4 chiffres (cases masquées, collage et retour arrière gérés). */
export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus,
  invalid,
  dark,
  disabled,
  length = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  invalid?: boolean;
  dark?: boolean;
  disabled?: boolean;
  length?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);
  // Champ vidé de l'extérieur (ex. après une erreur) : on revient à la première case.
  useEffect(() => {
    if (value === "" && document.activeElement && refs.current.includes(document.activeElement as HTMLInputElement)) refs.current[0]?.focus();
  }, [value]);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    else refs.current[clean.length]?.focus();
  };

  return (
    <div className="flex justify-center gap-2.5" role="group" aria-label="Code PIN">
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          disabled={disabled}
          value={value[i] ?? ""}
          aria-label={`Chiffre ${i + 1}`}
          aria-invalid={invalid}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const d = e.target.value.replace(/\D/g, "");
            if (!d) return;
            set(value.slice(0, i) + d);
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              const cut = value[i] ? i : Math.max(0, i - 1);
              onChange(value.slice(0, cut));
              refs.current[cut]?.focus();
            } else if (e.key === "ArrowLeft") refs.current[Math.max(0, i - 1)]?.focus();
            else if (e.key === "ArrowRight") refs.current[Math.min(length - 1, i + 1)]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            set(e.clipboardData.getData("text"));
          }}
          className={cn(
            "size-12 rounded-lg border text-center text-[1.25rem] font-semibold outline-none transition-colors focus:ring-[3px] disabled:opacity-50",
            dark
              ? "border-white/15 bg-white/[0.06] text-white focus:border-white/50 focus:ring-white/10"
              : "border-input bg-surface text-foreground focus:border-primary focus:ring-primary/15",
            invalid && "border-danger focus:border-danger focus:ring-danger/15",
          )}
        />
      ))}
    </div>
  );
}
