import { useQuery } from "@tanstack/react-query";
import { Lock, PanelLeftClose, PanelLeftOpen, Sparkles } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { AppMark, Wordmark } from "@/components/common/brand";
import { Tooltip } from "@/components/ui/menu";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { t } from "@/i18n";
import { scalar } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { useUi } from "@/stores/ui";
import { NAV, type NavItem } from "./nav";

function useAlertCount() {
  return useQuery({
    queryKey: ["sidebar", "alerts"],
    queryFn: () => scalar<number>("SELECT COUNT(*) FROM products WHERE archived = 0 AND product_type <> 'service' AND (quantity <= 0 OR (minimum_stock > 0 AND quantity <= minimum_stock))"),
    refetchInterval: 60_000,
  });
}

function Item({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const premium = useApp((s) => s.premium.active);
  const gate = usePremiumGate();
  const navigate = useNavigate();
  const location = useLocation();
  const locked = !!item.premium && !premium;
  const active = item.to === "/" ? location.pathname === "/" : location.pathname === item.to || (location.pathname.startsWith(item.to + "/") && item.to !== "/purchases") || (item.to === "/purchases" && /^\/purchases\/\d+/.test(location.pathname)) || (item.to.startsWith("/settings") && location.pathname.startsWith("/settings"));
  const Icon = item.icon;
  const content = (
    <NavLink
      to={item.to}
      onClick={(e) => {
        if (locked) {
          e.preventDefault();
          gate.open(item.premium!);
        } else if (active) {
          e.preventDefault();
          navigate(item.to);
        }
      }}
      className={cn(
        "group relative flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] font-medium transition-colors",
        active ? "bg-sidebar-active font-semibold text-sidebar-active-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-hover hover:text-sidebar-foreground",
        collapsed && "justify-center px-0",
      )}
    >
      {active && <span className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r-full bg-sidebar-accent" />}
      <Icon className={cn("size-[17px] shrink-0", active ? "text-sidebar-accent" : "text-sidebar-muted group-hover:text-sidebar-foreground")} strokeWidth={1.9} />
      {!collapsed && <span className="truncate">{t(item.label)}</span>}
      {!collapsed && locked && <Lock className="ml-auto size-3 text-sidebar-muted" />}
      {!collapsed && !locked && !!badge && (
        <span className="num ml-auto rounded-full bg-warning-soft px-1.5 text-[0.6875rem] font-semibold text-warning">{badge}</span>
      )}
      {collapsed && !!badge && <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-warning" />}
    </NavLink>
  );
  return collapsed ? (
    <Tooltip content={t(item.label)} side="right">
      {content}
    </Tooltip>
  ) : (
    content
  );
}

export function Sidebar() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggle = useUi((s) => s.toggleSidebar);
  const perms = useApp((s) => s.session?.permissions);
  const premium = useApp((s) => s.premium.active);
  const navigate = useNavigate();
  const { data: alerts } = useAlertCount();

  return (
    <aside className={cn("flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150", collapsed ? "w-[60px]" : "w-[232px]")}>
      <div className={cn("flex h-14 shrink-0 items-center", collapsed ? "justify-center" : "justify-between px-4")}>
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5" aria-label="Tableau de bord">
          {collapsed ? <AppMark className="size-8" /> : <Wordmark className="h-[22px]" />}
        </button>
        {!collapsed && (
          <button onClick={toggle} className="rounded-md p-1 text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-foreground" aria-label="Réduire le menu">
            <PanelLeftClose className="size-4" />
          </button>
        )}
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 pt-1 [scrollbar-width:thin]">
        {NAV.map((section, i) => {
          const items = section.items.filter((it) => hasPermission(perms, it.perm));
          if (!items.length) return null;
          return (
            <div key={i}>
              {section.title && !collapsed && <div className="mb-1 px-2.5 text-[0.625rem] font-semibold uppercase tracking-[0.09em] text-sidebar-muted/80">{t(section.title)}</div>}
              {section.title && collapsed && <div className="mx-auto mb-2 h-px w-6 bg-sidebar-border" />}
              <div className="space-y-0.5">
                {items.map((it) => (
                  <Item key={it.to} item={it} collapsed={collapsed} badge={it.to === "/actions" ? alerts ?? 0 : undefined} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="shrink-0 border-t border-sidebar-border p-3">
        {collapsed ? (
          <button onClick={toggle} className="mx-auto flex rounded-md p-1.5 text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground" aria-label="Déplier le menu">
            <PanelLeftOpen className="size-4" />
          </button>
        ) : (
          <button
            onClick={() => navigate("/settings/premium")}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors",
              premium ? "bg-sidebar-active hover:bg-sidebar-active/80" : "bg-sidebar-hover hover:bg-sidebar-hover/70",
            )}
          >
            <Sparkles className={cn("size-4", premium ? "text-sidebar-accent" : "text-sidebar-muted")} />
            <div className="min-w-0">
              <div className="text-[0.75rem] font-bold tracking-wide text-sidebar-foreground">{premium ? t("app.premium") : t("app.free")}</div>
              <div className="truncate text-[0.6875rem] text-sidebar-muted">{premium ? "Toutes les fonctionnalités" : "Passer à Premium"}</div>
            </div>
          </button>
        )}
      </div>
    </aside>
  );
}
