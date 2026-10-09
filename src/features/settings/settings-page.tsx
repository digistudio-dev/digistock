import { Building2, DatabaseBackup, FileText, Info, MessageCircle, Package, Palette, Receipt, ShoppingCart, Sparkles, Users, type LucideIcon } from "lucide-react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import { Page, PageHeader } from "@/components/common/page";
import { cn } from "@/lib/utils";
import { useCan } from "@/stores/app";
import { AboutSection } from "./about-section";
import { PremiumSection } from "./premium-section";
import { AppearanceSection, CompanySection, InvoiceSection, ReceiptSection, SalesSection, StockSection, WhatsAppSection } from "./sections";

const SECTIONS: { id: string; label: string; icon: LucideIcon; admin?: boolean }[] = [
  { id: "company", label: "Entreprise", icon: Building2, admin: true },
  { id: "appearance", label: "Apparence", icon: Palette },
  { id: "sales", label: "Ventes", icon: ShoppingCart, admin: true },
  { id: "receipts", label: "Tickets", icon: Receipt, admin: true },
  { id: "invoices", label: "Facturation", icon: FileText, admin: true },
  { id: "stock", label: "Stock", icon: Package, admin: true },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle, admin: true },
  { id: "users", label: "Utilisateurs", icon: Users, admin: true },
  { id: "backup", label: "Sauvegarde", icon: DatabaseBackup, admin: true },
  { id: "premium", label: "Premium", icon: Sparkles, admin: true },
  { id: "about", label: "À propos", icon: Info },
];

export function SettingsPage() {
  const { section = "company" } = useParams();
  const can = useCan();
  const admin = can("manage_settings");
  const visible = SECTIONS.filter((s) => !s.admin || admin);
  if (!visible.some((s) => s.id === section)) return <Navigate to={`/settings/${visible[0].id}`} replace />;

  return (
    <Page className="max-w-[1200px]">
      <PageHeader title="Paramètres" description="Configurez DigiStock selon votre entreprise." />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[210px_1fr]">
        <nav className="space-y-0.5 md:sticky md:top-4 md:self-start">
          {visible.map((s) => (
            <NavLink
              key={s.id}
              to={`/settings/${s.id}`}
              className={({ isActive }) =>
                cn("flex h-9 items-center gap-2.5 rounded-md px-3 text-[0.8125rem] font-medium transition-colors", isActive ? "bg-surface text-foreground shadow-card ring-1 ring-border" : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              <s.icon className="size-4" />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {section === "company" && <CompanySection />}
          {section === "appearance" && <AppearanceSection />}
          {section === "sales" && <SalesSection />}
          {section === "receipts" && <ReceiptSection />}
          {section === "invoices" && <InvoiceSection />}
          {section === "stock" && <StockSection />}
          {section === "whatsapp" && <WhatsAppSection />}
          {section === "users" && <Navigate to="/users" />}
          {section === "backup" && <Navigate to="/backup" />}
          {section === "premium" && <PremiumSection />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </Page>
  );
}
