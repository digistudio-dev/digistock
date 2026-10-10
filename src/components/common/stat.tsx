import type { ReactNode } from "react";
import { Card } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function Kpi({ label, value, hint, tone, icon }: { label: string; value: string; hint?: string; tone?: "success" | "danger" | "warning"; icon?: ReactNode }) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[0.75rem] font-medium text-muted-foreground">{label}</div>
        {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      </div>
      <div className={cn("num mt-1 text-[1.25rem] font-semibold tracking-tight", tone === "success" && "text-success", tone === "danger" && "text-danger", tone === "warning" && "text-warning")}>{value}</div>
      {hint && <div className="mt-0.5 text-[0.75rem] text-muted-foreground">{hint}</div>}
    </Card>
  );
}
