import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, PackageX } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { select } from "@/lib/db";
import { relative } from "@/lib/format";
import { call } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import type { Notification } from "@/types";

const ICONS = {
  danger: <PackageX className="size-4 text-danger" />,
  warning: <AlertTriangle className="size-4 text-warning" />,
  success: <CheckCircle2 className="size-4 text-success" />,
  info: <Info className="size-4 text-info" />,
};

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data = [] } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => select<Notification>("SELECT * FROM notifications ORDER BY id DESC LIMIT 40"),
    refetchInterval: 30_000,
  });
  const unread = data.filter((n) => !n.read_at).length;

  const markAll = async () => {
    await call("notifications_mark_read", { ids: null });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const openItem = async (n: Notification) => {
    if (!n.read_at) {
      await call("notifications_mark_read", { ids: [n.id] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    }
    setOpen(false);
    if (n.entity === "product" && n.entity_id) navigate(`/products/${n.entity_id}`);
    else if (n.type === "backup") navigate("/backup");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="!size-[18px]" />
          {unread > 0 && (
            <span className="num absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[0.625rem] font-bold text-white ring-2 ring-surface">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px]">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <div className="text-[0.875rem] font-semibold">Notifications</div>
            <div className="text-[0.75rem] text-muted-foreground">{unread ? `${unread} non lue(s)` : "Tout est à jour"}</div>
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAll}>
              <CheckCheck /> Tout marquer lu
            </Button>
          )}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {data.length === 0 ? (
            <div className="px-6 py-10 text-center text-[0.8125rem] text-muted-foreground">
              <Bell className="mx-auto mb-2 size-5 opacity-50" />
              Aucune notification pour le moment.
            </div>
          ) : (
            data.map((n) => (
              <button key={n.id} onClick={() => openItem(n)} className={cn("flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-0 hover:bg-accent/60", !n.read_at && "bg-primary-soft/40")}>
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">{ICONS[n.level]}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[0.8125rem] font-semibold">{n.title}</span>
                    {!n.read_at && <span className="size-1.5 rounded-full bg-primary" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-[0.75rem] leading-snug text-muted-foreground">{n.body}</p>}
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground/80">{relative(n.created_at)}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
