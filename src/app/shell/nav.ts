import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  DatabaseBackup,
  FolderTree,
  History,
  LayoutDashboard,
  MessageCircle,
  Package,
  ReceiptText,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  UserCog,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { TranslationKey } from "@/i18n";
import type { Permission } from "@/lib/permissions";
import type { PremiumFeature } from "@/features/premium/premium-gate";

export interface NavItem {
  to: string;
  label: TranslationKey;
  icon: LucideIcon;
  perm?: Permission | Permission[];
  premium?: PremiumFeature;
  shortcut?: string;
}

export interface NavSection {
  title?: TranslationKey;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  { items: [{ to: "/", label: "nav.dashboard", icon: LayoutDashboard }] },
  {
    title: "nav.sales",
    items: [
      { to: "/pos", label: "nav.newSale", icon: ShoppingCart, perm: "create_sales", shortcut: "F2" },
      { to: "/sales", label: "nav.salesHistory", icon: ReceiptText },
    ],
  },
  {
    title: "nav.stock",
    items: [
      { to: "/products", label: "nav.products", icon: Package, shortcut: "F3" },
      { to: "/categories", label: "nav.categories", icon: FolderTree },
      { to: "/stock/movements", label: "nav.movements", icon: ArrowLeftRight },
      { to: "/inventory", label: "nav.inventory", icon: ClipboardCheck, perm: "manage_stock" },
    ],
  },
  {
    title: "nav.purchasing",
    items: [
      { to: "/purchases/new", label: "nav.newPurchase", icon: ShoppingBag, perm: "manage_purchases" },
      { to: "/purchases", label: "nav.purchases", icon: Boxes, perm: "manage_purchases" },
      { to: "/suppliers", label: "nav.suppliers", icon: Truck },
    ],
  },
  {
    title: "nav.customersSection",
    items: [
      { to: "/customers", label: "nav.customers", icon: Users, shortcut: "F4" },
      { to: "/credits", label: "nav.credits", icon: Wallet },
    ],
  },
  {
    title: "nav.management",
    items: [
      { to: "/warehouses", label: "nav.warehouses", icon: Warehouse },
      { to: "/reports", label: "nav.reports", icon: BarChart3, perm: "view_reports" },
      { to: "/actions", label: "nav.actions", icon: Sparkles },
    ],
  },
  {
    title: "nav.premium",
    items: [
      { to: "/whatsapp", label: "nav.whatsapp", icon: MessageCircle, premium: "whatsapp" },
      { to: "/users", label: "nav.users", icon: UserCog, perm: "manage_users", premium: "users" },
      { to: "/activity", label: "nav.activity", icon: History, perm: "manage_users", premium: "activity" },
    ],
  },
  {
    title: "nav.system",
    items: [
      { to: "/backup", label: "nav.backup", icon: DatabaseBackup, perm: "manage_backups" },
      { to: "/settings/company", label: "nav.settings", icon: Settings },
    ],
  },
];
