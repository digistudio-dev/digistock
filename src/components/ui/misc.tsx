import * as Sw from "@radix-ui/react-switch";
import * as Cb from "@radix-ui/react-checkbox";
import * as Tb from "@radix-ui/react-tabs";
import { Check, Minus } from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Switch
export function Switch({ checked, onCheckedChange, disabled, id }: { checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; id?: string }) {
  return (
    <Sw.Root
      id={id}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className="peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary"
    >
      <Sw.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </Sw.Root>
  );
}

// ---------------------------------------------------------------- Checkbox
export function Checkbox({ checked, onCheckedChange, disabled, "aria-label": ariaLabel }: { checked: boolean | "indeterminate"; onCheckedChange: (v: boolean) => void; disabled?: boolean; "aria-label"?: string }) {
  return (
    <Cb.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(v === true)}
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={(e) => e.stopPropagation()}
      className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=indeterminate]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:bg-primary"
    >
      <Cb.Indicator className="text-white">{checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}</Cb.Indicator>
    </Cb.Root>
  );
}

// ---------------------------------------------------------------- Tabs
export const Tabs = Tb.Root;
export const TabsContent = Tb.Content;

export function TabsList({ children, className }: { children: ReactNode; className?: string }) {
  return <Tb.List className={cn("inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-1", className)}>{children}</Tb.List>;
}

export function TabsTrigger({ value, children, disabled }: { value: string; children: ReactNode; disabled?: boolean }) {
  return (
    <Tb.Trigger
      value={value}
      disabled={disabled}
      className="inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[0.8125rem] font-medium text-muted-foreground transition-all hover:text-foreground disabled:opacity-50 data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-sm [&_svg]:size-3.5"
    >
      {children}
    </Tb.Trigger>
  );
}

/** Onglets soulignés pour les en-têtes de pages de détail. */
export function UnderlineTabsList({ children }: { children: ReactNode }) {
  return <Tb.List className="flex gap-5 border-b">{children}</Tb.List>;
}

export function UnderlineTabsTrigger({ value, children }: { value: string; children: ReactNode }) {
  return (
    <Tb.Trigger
      value={value}
      className="-mb-px inline-flex items-center gap-1.5 border-b-2 border-transparent pb-2.5 pt-1 text-[0.8125rem] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
    >
      {children}
    </Tb.Trigger>
  );
}

// ---------------------------------------------------------------- Badge
const BADGE = {
  neutral: "bg-muted text-foreground/75 ring-border",
  primary: "bg-primary-soft text-primary ring-primary/20",
  success: "bg-success-soft text-success ring-success/20",
  warning: "bg-warning-soft text-warning ring-warning/25",
  danger: "bg-danger-soft text-danger ring-danger/20",
  info: "bg-info-soft text-info ring-info/20",
};

export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = "neutral", children, className, dot }: { tone?: BadgeTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[0.6875rem] font-semibold ring-1 ring-inset", BADGE[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- Skeleton & divers
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({ title, description, actions, className, icon }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4", className)}>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon && <span className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{icon}</span>}
        <div className="min-w-0">
          <h3 className="section-title truncate">{title}</h3>
          {description && <p className="mt-0.5 text-[0.75rem] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Separator({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cn(vertical ? "w-px self-stretch" : "h-px w-full", "bg-border", className)} />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent", className)} />;
}
