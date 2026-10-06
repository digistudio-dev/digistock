import { ChevronLeft, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto w-full px-6 pb-10 pt-5 animate-in fade-in-0 duration-150", wide ? "max-w-[1680px]" : "max-w-[1440px]", className)}>{children}</div>;
}

export function PageHeader({
  title,
  description,
  actions,
  back,
  meta,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: string | boolean;
  meta?: ReactNode;
  className?: string;
}) {
  const navigate = useNavigate();
  return (
    <div className={cn("mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        {back && (
          <button
            onClick={() => (typeof back === "string" ? navigate(back) : navigate(-1))}
            className="mb-1.5 -ml-1 inline-flex items-center gap-0.5 rounded px-1 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft className="size-4" /> Retour
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="truncate text-[1.375rem] font-semibold leading-tight">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-1 text-[0.8125rem] text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center", compact ? "px-6 py-8" : "px-6 py-16", className)}>
      {icon && (
        <div className="relative mb-4">
          <div className="absolute inset-0 -m-3 rounded-full bg-primary/5" />
          <div className="relative flex size-12 items-center justify-center rounded-xl border bg-surface text-muted-foreground shadow-card [&_svg]:size-5">{icon}</div>
        </div>
      )}
      <h3 className="text-[0.9375rem] font-semibold">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-[0.8125rem] leading-relaxed text-muted-foreground">{description}</p>}
      {actions && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{actions}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Une erreur inattendue s'est produite.";
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-danger-soft text-danger">!</div>
      <h3 className="text-[0.9375rem] font-semibold">Impossible de charger les données</h3>
      <p className="mt-1 max-w-md text-[0.8125rem] text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          Réessayer
        </Button>
      )}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
  className,
  delay = 220,
  autoFocus,
  inputSize,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  delay?: number;
  autoFocus?: boolean;
  inputSize?: "sm" | "md" | "lg";
}) {
  const [local, setLocal] = useState(value);
  const first = useRef(true);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => local !== value && onChange(local), delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local]);
  return (
    <Input
      className={cn("w-72", className)}
      inputSize={inputSize}
      autoFocus={autoFocus}
      leading={<Search />}
      trailing={
        local ? (
          <button
            type="button"
            className="pointer-events-auto rounded p-0.5 hover:bg-accent"
            onClick={() => {
              setLocal("");
              onChange("");
            }}
          >
            <X className="size-3.5" />
          </button>
        ) : undefined
      }
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
    />
  );
}

export function LoadingRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/** Ligne « libellé : valeur » des panneaux de détail. */
export function InfoRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2 text-[0.8125rem]", className)}>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{children}</span>
    </div>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mb-3 flex flex-wrap items-center gap-2", className)}>{children}</div>;
}
