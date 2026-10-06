import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Boxes, CornerDownLeft, Package, Plus, ReceiptText, Search, ShoppingBag, ShoppingCart, Truck, UserPlus, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as D from "@radix-ui/react-dialog";
import { create } from "zustand";
import { t } from "@/i18n";
import { like, select } from "@/lib/db";
import { money, qty } from "@/lib/format";
import { hasPermission, type Permission } from "@/lib/permissions";
import { useApp } from "@/stores/app";
import { NAV } from "./nav";

export const usePalette = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

interface Result {
  kind: "product" | "customer" | "supplier" | "sale" | "purchase";
  id: number;
  title: string;
  subtitle: string;
}

const ACTIONS: { label: string; to: string; icon: LucideIcon; perm?: Permission; keywords: string }[] = [
  { label: "Créer une vente", to: "/pos", icon: ShoppingCart, perm: "create_sales", keywords: "vente caisse pos encaisser" },
  { label: "Ajouter un produit", to: "/products/new", icon: Plus, perm: "manage_products", keywords: "produit article nouveau" },
  { label: "Nouvel achat", to: "/purchases/new", icon: ShoppingBag, perm: "manage_purchases", keywords: "achat commande fournisseur réception" },
  { label: "Ajouter un client", to: "/customers?new=1", icon: UserPlus, perm: "manage_customers", keywords: "client nouveau" },
  { label: "Ajouter un fournisseur", to: "/suppliers?new=1", icon: Truck, perm: "manage_suppliers", keywords: "fournisseur nouveau" },
  { label: "Nouvel inventaire", to: "/inventory?new=1", icon: Boxes, perm: "manage_stock", keywords: "inventaire comptage" },
  { label: "Imprimer des étiquettes", to: "/products/labels", icon: ReceiptText, keywords: "étiquettes code-barres labels" },
];

async function searchAll(term: string): Promise<Result[]> {
  const q = like(term);
  const [products, customers, suppliers, sales, purchases] = await Promise.all([
    select<{ id: number; name: string; barcode: string | null; selling_price: number; quantity: number }>(
      "SELECT id, name, barcode, selling_price, quantity FROM products WHERE archived = 0 AND (name LIKE ?1 ESCAPE '\\' OR barcode = ?2 OR sku LIKE ?1 ESCAPE '\\') ORDER BY name LIMIT 6",
      [q, term.trim()],
    ),
    select<{ id: number; name: string; phone: string | null; balance: number }>(
      "SELECT id, name, phone, balance FROM customers WHERE archived = 0 AND (name LIKE ?1 ESCAPE '\\' OR phone LIKE ?1 ESCAPE '\\') ORDER BY name LIMIT 4",
      [q],
    ),
    select<{ id: number; name: string; company_name: string | null }>(
      "SELECT id, name, company_name FROM suppliers WHERE archived = 0 AND (name LIKE ?1 ESCAPE '\\' OR company_name LIKE ?1 ESCAPE '\\') ORDER BY name LIMIT 4",
      [q],
    ),
    select<{ id: number; number: string; total: number; created_at: string }>("SELECT id, number, total, created_at FROM sales WHERE number LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 4", [q]),
    select<{ id: number; number: string; total: number }>("SELECT id, number, total FROM purchases WHERE number LIKE ?1 ESCAPE '\\' OR reference LIKE ?1 ESCAPE '\\' ORDER BY id DESC LIMIT 4", [q]),
  ]);
  return [
    ...products.map((p) => ({ kind: "product" as const, id: p.id, title: p.name, subtitle: `${money(p.selling_price)} · Stock ${qty(p.quantity)}` })),
    ...customers.map((c) => ({ kind: "customer" as const, id: c.id, title: c.name, subtitle: c.balance > 0 ? `Crédit ${money(c.balance)}` : c.phone ?? "Client" })),
    ...suppliers.map((s) => ({ kind: "supplier" as const, id: s.id, title: s.name, subtitle: s.company_name ?? "Fournisseur" })),
    ...sales.map((s) => ({ kind: "sale" as const, id: s.id, title: s.number, subtitle: money(s.total) })),
    ...purchases.map((p) => ({ kind: "purchase" as const, id: p.id, title: p.number, subtitle: money(p.total) })),
  ];
}

const GROUPS: { kind: Result["kind"]; label: string; icon: LucideIcon; path: string }[] = [
  { kind: "product", label: "Produits", icon: Package, path: "/products/" },
  { kind: "customer", label: "Clients", icon: Users, path: "/customers/" },
  { kind: "supplier", label: "Fournisseurs", icon: Truck, path: "/suppliers/" },
  { kind: "sale", label: "Ventes", icon: ReceiptText, path: "/sales/" },
  { kind: "purchase", label: "Achats", icon: ShoppingBag, path: "/purchases/" },
];

const itemCls =
  "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-[0.8125rem] aria-selected:bg-accent [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function CommandPalette() {
  const { open, setOpen } = usePalette();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const navigate = useNavigate();
  const perms = useApp((s) => s.session?.permissions);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(id);
  }, [term]);
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  const { data: results = [] } = useQuery({
    queryKey: ["palette", debounced],
    queryFn: () => searchAll(debounced),
    enabled: open && debounced.trim().length >= 2,
  });

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };
  const lower = term.toLowerCase();
  const actions = ACTIONS.filter((a) => hasPermission(perms, a.perm) && (!lower || (a.label + " " + a.keywords).toLowerCase().includes(lower)));
  const pages = NAV.flatMap((s) => s.items)
    .filter((i) => hasPermission(perms, i.perm) && (!lower || t(i.label).toLowerCase().includes(lower)))
    .slice(0, lower ? 5 : 0);

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-[hsl(228_30%_6%/0.4)] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <D.Content className="fixed left-1/2 top-[14vh] z-50 w-[620px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-xl border bg-popover shadow-pop data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]">
          <D.Title className="sr-only">Recherche globale</D.Title>
          <D.Description className="sr-only">Rechercher des produits, clients, fournisseurs, ventes et actions.</D.Description>
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-3 border-b px-4">
              <Search className="size-[18px] text-muted-foreground" />
              <Command.Input
                autoFocus
                value={term}
                onValueChange={setTerm}
                placeholder="Rechercher un produit, un client, une vente… ou une action"
                className="h-[52px] flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
              />
              <span className="kbd">Échap</span>
            </div>
            <Command.List className="max-h-[420px] overflow-y-auto p-2">
              <Command.Empty className="px-4 py-10 text-center text-[0.8125rem] text-muted-foreground">Aucun résultat pour « {term} ».</Command.Empty>
              {GROUPS.map((g) => {
                const items = results.filter((r) => r.kind === g.kind);
                if (!items.length) return null;
                return (
                  <Command.Group key={g.kind} heading={g.label} className="mb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
                    {items.map((r) => (
                      <Command.Item key={`${r.kind}-${r.id}`} value={`${r.kind}-${r.id}`} onSelect={() => go(g.path + r.id)} className={itemCls}>
                        <g.icon />
                        <span className="flex-1 truncate font-medium">{r.title}</span>
                        <span className="num text-[0.75rem] text-muted-foreground">{r.subtitle}</span>
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}
              {actions.length > 0 && (
                <Command.Group heading="Actions" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
                  {actions.map((a) => (
                    <Command.Item key={a.to} value={"action-" + a.to} onSelect={() => go(a.to)} className={itemCls}>
                      <a.icon />
                      <span className="flex-1">{a.label}</span>
                      <CornerDownLeft className="!size-3.5 opacity-0 [[aria-selected=true]_&]:opacity-100" />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {pages.length > 0 && (
                <Command.Group heading="Pages" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:text-[0.6875rem] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground">
                  {pages.map((p) => (
                    <Command.Item key={p.to} value={"page-" + p.to} onSelect={() => go(p.to)} className={itemCls}>
                      <p.icon />
                      <span>{t(p.label)}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
            <div className="flex items-center gap-4 border-t bg-subtle px-4 py-2 text-[0.6875rem] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="kbd">↑</span>
                <span className="kbd">↓</span> naviguer
              </span>
              <span className="flex items-center gap-1">
                <span className="kbd">Entrée</span> ouvrir
              </span>
            </div>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
