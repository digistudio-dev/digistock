import { Badge, type BadgeTone } from "@/components/ui/misc";
import { section } from "@/i18n";
import { EXPIRY_LABEL, STOCK_LEVEL_LABEL, expiryStatus, stockLevel, type ExpiryStatus, type StockLevel } from "@/lib/stock";

const LEVEL_TONE: Record<StockLevel, BadgeTone> = { normal: "success", low: "warning", critical: "danger", out: "danger" };

export function StockBadge({ quantity, minimum, level }: { quantity?: number; minimum?: number; level?: StockLevel }) {
  const l = level ?? stockLevel(quantity ?? 0, minimum ?? 0);
  return (
    <Badge tone={LEVEL_TONE[l]} dot>
      {STOCK_LEVEL_LABEL[l]}
    </Badge>
  );
}

const EXPIRY_TONE: Record<ExpiryStatus, BadgeTone> = { expired: "danger", "7d": "danger", "30d": "warning", ok: "neutral" };

export function ExpiryBadge({ date }: { date: string | null | undefined }) {
  const s = expiryStatus(date);
  if (!s || s === "ok") return null;
  return <Badge tone={EXPIRY_TONE[s]}>{EXPIRY_LABEL[s]}</Badge>;
}

export function SaleStatusBadge({ status }: { status: string }) {
  const labels = section("saleStatus") as Record<string, string>;
  return (
    <Badge tone={status === "cancelled" ? "danger" : "success"} dot>
      {labels[status] ?? status}
    </Badge>
  );
}

export function PurchaseStatusBadge({ status }: { status: string }) {
  const labels = section("purchaseStatus") as Record<string, string>;
  const tone: BadgeTone = status === "received" ? "success" : status === "ordered" ? "info" : "danger";
  return (
    <Badge tone={tone} dot>
      {labels[status] ?? status}
    </Badge>
  );
}

export function PremiumBadge({ className }: { className?: string }) {
  return (
    <span className={"inline-flex h-[18px] items-center rounded px-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-primary ring-1 ring-inset ring-primary/30 " + (className ?? "")}>
      Premium
    </span>
  );
}

/** Variation de quantité signée et colorée : +50 / −3 */
export function Delta({ value, unit }: { value: number; unit?: string }) {
  const positive = value > 0;
  const s = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(Math.abs(value));
  return (
    <span className={"num font-semibold " + (positive ? "text-success" : "text-danger")}>
      {positive ? "+" : "−"}
      {s}
      {unit ? <span className="ml-0.5 text-[0.75rem] font-normal text-muted-foreground">{unit}</span> : null}
    </span>
  );
}
