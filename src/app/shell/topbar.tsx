import { KeyRound, Lock, LogOut, Monitor, Moon, Search, ShoppingCart, Sun } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Tooltip } from "@/components/ui/menu";
import { Kbd } from "@/components/ui/misc";
import { ChangePasswordDialog } from "@/features/auth/change-password";
import { dateLong } from "@/lib/format";
import { initials } from "@/lib/utils";
import { useApp, useCan } from "@/stores/app";
import { useUi, type Theme } from "@/stores/ui";
import { usePalette } from "./command-palette";
import { NotificationCenter } from "./notifications";

const THEMES: { value: Theme; icon: typeof Sun; label: string }[] = [
  { value: "light", icon: Sun, label: "Clair" },
  { value: "dark", icon: Moon, label: "Sombre" },
  { value: "system", icon: Monitor, label: "Système" },
];

export function Topbar() {
  const session = useApp((s) => s.session);
  const company = useApp((s) => s.company);
  const logout = useApp((s) => s.logout);
  const lock = useApp((s) => s.lock);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const openPalette = usePalette((s) => s.setOpen);
  const navigate = useNavigate();
  const can = useCan();
  const [pwd, setPwd] = useState(false);
  const current = THEMES.find((t) => t.value === theme) ?? THEMES[2];
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-surface px-4">
      <button
        onClick={() => openPalette(true)}
        className="flex h-9 w-full max-w-[420px] items-center gap-2.5 rounded-md border bg-background/60 px-3 text-[0.8125rem] text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-background"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">Rechercher produits, clients, ventes…</span>
        <span className="flex items-center gap-0.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>
      <div className="hidden min-w-0 flex-1 truncate text-[0.8125rem] text-muted-foreground xl:block">
        <span className="font-medium text-foreground/80">{company?.name}</span>
        <span className="mx-2 opacity-40">·</span>
        <span className="inline-block first-letter:uppercase">{dateLong(new Date())}</span>
      </div>
      <div className="ml-auto flex items-center gap-1">
        {can("create_sales") && (
          <Button size="sm" onClick={() => navigate("/pos")} className="mr-1">
            <ShoppingCart /> Nouvelle vente <span className="ml-1 rounded bg-white/15 px-1 text-[0.6875rem] font-semibold">F2</span>
          </Button>
        )}
        <Tooltip content={`Thème : ${current.label}`}>
          <Button variant="ghost" size="icon" onClick={() => setTheme(next.value)} aria-label="Changer de thème">
            <current.icon className="!size-[18px]" />
          </Button>
        </Tooltip>
        <NotificationCenter />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="ml-1 flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 transition-colors hover:bg-accent">
              <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-[0.75rem] font-bold text-primary">{initials(session?.name ?? "?")}</span>
              <span className="hidden text-left leading-tight lg:block">
                <span className="block text-[0.8125rem] font-semibold">{session?.name}</span>
                <span className="block text-[0.6875rem] text-muted-foreground">{session?.role_name}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            <DropdownMenuLabel>{session?.username}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setPwd(true)}>
              <KeyRound /> Changer le mot de passe
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={lock}>
              <Lock /> Verrouiller l'application
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => logout()}>
              <LogOut /> Se déconnecter
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={pwd} onOpenChange={setPwd} />
    </header>
  );
}
