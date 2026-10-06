import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, moneyShort } from "@/lib/format";

/**
 * Graphiques à série unique, couleur de marque. Grille et axes discrets,
 * traits fins, info-bulle au survol (spécifications dataviz).
 */
const axis = { stroke: "hsl(var(--muted-foreground))", fontSize: 11, tickLine: false, axisLine: false } as const;

function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: { value: number }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-[0.75rem] shadow-pop">
      <div className="text-muted-foreground">{label}</div>
      <div className="num mt-0.5 text-[0.875rem] font-semibold text-foreground">{format(payload[0].value)}</div>
    </div>
  );
}

export function RevenueArea({ data, height = 260 }: { data: { label: string; value: number }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="rev-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.22} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="0" />
        <XAxis dataKey="label" {...axis} minTickGap={18} dy={6} />
        <YAxis {...axis} width={48} tickFormatter={(v: number) => moneyShort(v)} />
        <Tooltip cursor={{ stroke: "hsl(var(--muted-foreground))", strokeWidth: 1, strokeDasharray: "3 3" }} content={<ChartTooltip format={(v) => money(v)} />} />
        <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#rev-fill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "hsl(var(--card))" }} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleBars({ data, height = 240, format = money }: { data: { label: string; value: number }[]; height?: number; format?: (v: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
        <XAxis dataKey="label" {...axis} minTickGap={8} dy={6} />
        <YAxis {...axis} width={48} tickFormatter={(v: number) => moneyShort(v)} />
        <Tooltip cursor={{ fill: "hsl(var(--muted) / 0.6)" }} content={<ChartTooltip format={format} />} />
        <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
