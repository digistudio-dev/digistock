import { Check, ImagePlus, Monitor, Moon, Sun, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { NumberInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, Switch } from "@/components/ui/misc";
import { useAction } from "@/hooks/use-action";
import { imageSrc, storeImage } from "@/lib/files";
import type { Settings } from "@/lib/settings";
import { call, toAppError } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import { useUi, type Density, type FontSize, type Theme } from "@/stores/ui";

export function SectionCard({ title, description, children, footer }: { title: string; description?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card>
      <div className="border-b px-6 py-4">
        <h2 className="text-[0.9375rem] font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{description}</p>}
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 rounded-b-lg border-t bg-subtle px-6 py-3">{footer}</div>}
    </Card>
  );
}

export function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 border-b py-3.5 first:pt-0 last:border-0 last:pb-0">
      <span>
        <span className="block text-[0.8125rem] font-medium">{label}</span>
        {description && <span className="block text-[0.75rem] text-muted-foreground">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** Copie locale modifiable d'un sous-ensemble des paramètres, enregistrée d'un bloc. */
function useDraft<K extends keyof Settings>(keys: K[]) {
  const settings = useApp((s) => s.settings);
  const saveSettings = useApp((s) => s.saveSettings);
  const pick = () => Object.fromEntries(keys.map((k) => [k, settings[k]])) as Pick<Settings, K>;
  const [draft, setDraft] = useState(pick);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(pick()), [settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = keys.some((k) => draft[k] !== settings[k]);
  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(draft as Partial<Settings>);
      toast.success("Paramètres enregistrés.");
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setSaving(false);
    }
  };
  const set = <T extends K>(k: T, v: Settings[T]) => setDraft((d) => ({ ...d, [k]: v }));
  const footer = (
    <>
      <Button variant="ghost" disabled={!dirty} onClick={() => setDraft(pick())}>
        Annuler
      </Button>
      <Button onClick={save} loading={saving} disabled={!dirty}>
        Enregistrer
      </Button>
    </>
  );
  return { draft, set, footer };
}

// ---------------------------------------------------------------- Entreprise
const COMPANY_FIELDS = [
  ["name", "Nom de l'entreprise"],
  ["phone", "Téléphone"],
  ["whatsapp", "WhatsApp"],
  ["email", "Email"],
  ["city", "Ville"],
  ["address", "Adresse"],
  ["ice", "ICE"],
  ["if_number", "IF"],
  ["rc", "RC"],
] as const;

export function CompanySection() {
  const company = useApp((s) => s.company);
  const refresh = useApp((s) => s.refreshCompany);
  const [form, setForm] = useState<Record<string, string | number | null>>({});
  const { run, pending } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (company) setForm({ ...company } as Record<string, string | number | null>);
  }, [company]);
  const set = (k: string, v: string | number | null) => setForm((f) => ({ ...f, [k]: v }));
  const iceInvalid = !!form.ice && !/^\d{15}$/.test(String(form.ice));
  const save = async () => {
    if (!String(form.name ?? "").trim()) return toast.error("Le nom de l'entreprise est obligatoire.");
    if (iceInvalid) return toast.error("L'ICE comporte 15 chiffres.");
    const ok = await run(() => call("company_save", { values: form }), { success: "Informations de l'entreprise enregistrées." });
    if (ok !== undefined) refresh();
  };
  return (
    <SectionCard
      title="Entreprise"
      description="Ces informations apparaissent sur vos tickets, factures et documents."
      footer={
        <Button onClick={save} loading={pending}>
          Enregistrer
        </Button>
      }
    >
      <div className="mb-5 flex items-center gap-4">
        <button type="button" onClick={() => fileRef.current?.click()} className="flex size-20 items-center justify-center overflow-hidden rounded-xl border border-dashed bg-subtle text-muted-foreground hover:border-primary hover:text-primary">
          {form.logo ? <img src={imageSrc(String(form.logo)) ?? ""} className="size-full object-contain" alt="Logo" /> : <ImagePlus className="size-6" />}
        </button>
        <div className="text-[0.8125rem]">
          <div className="font-medium">Logo</div>
          <div className="text-muted-foreground">Affiché sur les tickets et factures.</div>
          {form.logo && (
            <Button variant="ghost" size="sm" className="-ml-3 mt-1 text-muted-foreground" onClick={() => set("logo", null)}>
              <Trash2 /> Retirer
            </Button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              set("logo", await storeImage(f, 400));
            } catch (err) {
              toast.error(toAppError(err).message);
            }
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        {COMPANY_FIELDS.map(([k, label]) => (
          <Field key={k} label={label} required={k === "name"} className={k === "name" || k === "address" ? "col-span-2" : ""} error={k === "ice" && iceInvalid ? "L'ICE comporte 15 chiffres." : undefined}>
            <Input value={String(form[k] ?? "")} onChange={(e) => set(k, e.target.value)} />
          </Field>
        ))}
        <Field label="Devise">
          <Select value={String(form.currency ?? "MAD")} onChange={(e) => set("currency", e.target.value)}>
            <option value="MAD">Dirham marocain (MAD / DH)</option>
          </Select>
        </Field>
        <Field label="TVA par défaut (nouveaux produits)">
          <Select value={Number(form.default_tax_rate ?? 20)} onChange={(e) => set("default_tax_rate", Number(e.target.value))}>
            {[0, 7, 10, 14, 20].map((r) => (
              <option key={r} value={r}>
                {r} %
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Apparence
export function AppearanceSection() {
  const { theme, density, fontSize, setTheme, setDensity, setFontSize } = useUi();
  const themes: { v: Theme; label: string; icon: typeof Sun }[] = [
    { v: "light", label: "Clair", icon: Sun },
    { v: "dark", label: "Sombre", icon: Moon },
    { v: "system", label: "Système", icon: Monitor },
  ];
  const Opt = <T extends string>({ value, current, onClick, children }: { value: T; current: T; onClick: (v: T) => void; children: ReactNode }) => (
    <button
      onClick={() => onClick(value)}
      className={cn("relative flex flex-1 flex-col items-center gap-2 rounded-lg border p-4 text-[0.8125rem] font-medium transition-colors", current === value ? "border-primary bg-primary-soft/50 ring-2 ring-primary/15" : "hover:border-foreground/25")}
    >
      {children}
      {current === value && <Check className="absolute right-2 top-2 size-4 text-primary" />}
    </button>
  );
  return (
    <SectionCard title="Apparence" description="Préférences d'affichage de ce poste.">
      <div className="space-y-6">
        <div>
          <div className="mb-2 text-[0.8125rem] font-medium">Thème</div>
          <div className="flex gap-3">
            {themes.map((t) => (
              <Opt key={t.v} value={t.v} current={theme} onClick={setTheme}>
                <t.icon className="size-5 text-muted-foreground" />
                {t.label}
              </Opt>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[0.8125rem] font-medium">Densité</div>
          <div className="flex gap-3">
            {(
              [
                ["comfortable", "Confortable"],
                ["compact", "Compacte"],
              ] as [Density, string][]
            ).map(([v, l]) => (
              <Opt key={v} value={v} current={density} onClick={setDensity}>
                <span className={cn("flex w-16 flex-col", v === "compact" ? "gap-0.5" : "gap-1.5")}>
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 rounded bg-muted-foreground/30" />
                  ))}
                </span>
                {l}
              </Opt>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-[0.8125rem] font-medium">Taille du texte</div>
          <div className="flex gap-3">
            {(
              [
                ["small", "Petite", "text-[12px]"],
                ["medium", "Normale", "text-[14px]"],
                ["large", "Grande", "text-[17px]"],
              ] as [FontSize, string, string][]
            ).map(([v, l, cls]) => (
              <Opt key={v} value={v} current={fontSize} onClick={setFontSize}>
                <span className={cn("font-semibold", cls)}>Aa</span>
                {l}
              </Opt>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Ventes
export function SalesSection() {
  const { draft, set, footer } = useDraft(["sales.prices_include_tax", "sales.allow_price_edit", "sales.block_credit_over_limit", "sales.sound"]);
  return (
    <SectionCard title="Ventes" description="Comportement de la caisse." footer={footer}>
      <ToggleRow label="Prix de vente TTC" description="Les prix saisis incluent la TVA (recommandé pour la vente en magasin)." checked={draft["sales.prices_include_tax"]} onChange={(v) => set("sales.prices_include_tax", v)} />
      <ToggleRow label="Modifier le prix en caisse" description="Autorise la modification du prix unitaire et les remises par ligne." checked={draft["sales.allow_price_edit"]} onChange={(v) => set("sales.allow_price_edit", v)} />
      <ToggleRow label="Bloquer le dépassement du plafond de crédit" checked={draft["sales.block_credit_over_limit"]} onChange={(v) => set("sales.block_credit_over_limit", v)} />
      <ToggleRow label="Son de confirmation au scan" checked={draft["sales.sound"]} onChange={(v) => set("sales.sound", v)} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Tickets
export function ReceiptSection() {
  const { draft, set, footer } = useDraft(["receipt.format", "receipt.show_logo", "receipt.show_ice", "receipt.show_if", "receipt.show_rc", "receipt.header", "receipt.footer", "receipt.copies", "receipt.after_sale"]);
  return (
    <SectionCard title="Tickets de caisse" description="Format et contenu des reçus imprimés." footer={footer}>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Largeur du ticket">
          <Select value={draft["receipt.format"]} onChange={(e) => set("receipt.format", e.target.value)}>
            <option value="ticket_58">Ticket 58 mm</option>
            <option value="ticket_80">Ticket 80 mm</option>
            <option value="a4">Facture A4</option>
          </Select>
        </Field>
        <Field label="Après chaque vente">
          <Select value={draft["receipt.after_sale"]} onChange={(e) => set("receipt.after_sale", e.target.value)}>
            <option value="ask">Proposer les options de reçu</option>
            <option value="print">Imprimer automatiquement</option>
            <option value="none">Aucun reçu</option>
          </Select>
        </Field>
        <Field label="Nombre de copies">
          <NumberInput value={draft["receipt.copies"]} decimals={0} onValueChange={(v) => set("receipt.copies", Math.min(5, Math.max(1, v ?? 1)))} />
        </Field>
        <Field label="Imprimante" hint="Choisie dans la fenêtre d'impression Windows. Définissez votre imprimante ticket comme imprimante par défaut pour aller plus vite.">
          <Input disabled value="Imprimante Windows par défaut" />
        </Field>
        <Field label="En-tête (facultatif)" className="col-span-2">
          <Input value={draft["receipt.header"]} onChange={(e) => set("receipt.header", e.target.value)} placeholder="Ex. Ouvert 7j/7 de 8h à 22h" />
        </Field>
        <Field label="Pied de ticket" className="col-span-2">
          <Input value={draft["receipt.footer"]} onChange={(e) => set("receipt.footer", e.target.value)} />
        </Field>
      </div>
      <div className="mt-5">
        <ToggleRow label="Afficher le logo" checked={draft["receipt.show_logo"]} onChange={(v) => set("receipt.show_logo", v)} />
        <ToggleRow label="Afficher l'ICE" checked={draft["receipt.show_ice"]} onChange={(v) => set("receipt.show_ice", v)} />
        <ToggleRow label="Afficher l'IF" checked={draft["receipt.show_if"]} onChange={(v) => set("receipt.show_if", v)} />
        <ToggleRow label="Afficher le RC" checked={draft["receipt.show_rc"]} onChange={(v) => set("receipt.show_rc", v)} />
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- Facturation
export function InvoiceSection() {
  const { draft, set, footer } = useDraft(["invoice.payment_terms", "invoice.notes"]);
  return (
    <div className="space-y-4">
      <SectionCard title="Facturation" description="Mentions des factures A4." footer={footer}>
        <div className="space-y-4">
          <Field label="Conditions de paiement">
            <Input value={draft["invoice.payment_terms"]} onChange={(e) => set("invoice.payment_terms", e.target.value)} />
          </Field>
          <Field label="Mentions complémentaires" hint="Ex. coordonnées bancaires (RIB), mentions légales.">
            <Textarea rows={3} value={draft["invoice.notes"]} onChange={(e) => set("invoice.notes", e.target.value)} />
          </Field>
        </div>
      </SectionCard>
      <SectionCard title="Numérotation des documents" description="Numérotation automatique, unique et sans trou, réinitialisée chaque année.">
        <div className="grid grid-cols-2 gap-2 text-[0.8125rem] sm:grid-cols-3">
          {[
            ["Vente", "V-2026-000001"],
            ["Facture", "FAC-2026-000001"],
            ["Achat", "ACH-2026-000001"],
            ["Paiement client", "PAY-2026-000001"],
            ["Règlement fournisseur", "REG-2026-000001"],
            ["Inventaire", "INV-2026-000001"],
            ["Transfert", "TRF-2026-000001"],
          ].map(([l, ex]) => (
            <div key={l} className="rounded-md border bg-subtle px-3 py-2">
              <div className="text-[0.75rem] text-muted-foreground">{l}</div>
              <div className="num font-medium">{ex}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------- Stock
export function StockSection() {
  const { draft, set, footer } = useDraft(["stock.allow_negative", "stock.expiry_warning_days", "reorder.lookback_days", "reorder.safety_days", "reorder.default_lead_time"]);
  return (
    <SectionCard title="Stock" description="Alertes et suggestions de réapprovisionnement." footer={footer}>
      <ToggleRow label="Autoriser le stock négatif" description="Permet de vendre un produit même si le stock enregistré est insuffisant (déconseillé)." checked={draft["stock.allow_negative"]} onChange={(v) => set("stock.allow_negative", v)} />
      <div className="mt-4 grid grid-cols-2 gap-4">
        <Field label="Alerte d'expiration (jours)">
          <NumberInput value={draft["stock.expiry_warning_days"]} decimals={0} onValueChange={(v) => set("stock.expiry_warning_days", Math.max(1, v ?? 30))} />
        </Field>
        <Field label="Historique de ventes analysé (jours)" hint="Pour calculer les ventes moyennes par jour.">
          <NumberInput value={draft["reorder.lookback_days"]} decimals={0} onValueChange={(v) => set("reorder.lookback_days", Math.max(7, v ?? 30))} />
        </Field>
        <Field label="Stock de sécurité (jours de ventes)">
          <NumberInput value={draft["reorder.safety_days"]} decimals={0} onValueChange={(v) => set("reorder.safety_days", Math.max(0, v ?? 2))} />
        </Field>
        <Field label="Délai fournisseur par défaut (jours)" hint="Utilisé si le fournisseur n'a pas de délai défini.">
          <NumberInput value={draft["reorder.default_lead_time"]} decimals={0} onValueChange={(v) => set("reorder.default_lead_time", Math.max(0, v ?? 3))} />
        </Field>
      </div>
      <p className="mt-4 rounded-md bg-subtle p-3 text-[0.75rem] text-muted-foreground">
        Suggestion de réapprovisionnement = ventes moyennes par jour × délai fournisseur + stock de sécurité − stock actuel.
      </p>
    </SectionCard>
  );
}

// ---------------------------------------------------------------- WhatsApp
export function WhatsAppSection() {
  const { draft, set, footer } = useDraft(["whatsapp.template_supplier", "whatsapp.template_reminder", "whatsapp.template_receipt"]);
  const block = (k: "whatsapp.template_supplier" | "whatsapp.template_reminder" | "whatsapp.template_receipt", label: string, vars: string) => (
    <Field label={label} hint={`Variables : ${vars}`}>
      <Textarea rows={7} value={draft[k]} onChange={(e) => set(k, e.target.value)} className="text-[0.8125rem]" />
    </Field>
  );
  return (
    <SectionCard title="Modèles de messages WhatsApp" description="Les messages restent modifiables avant chaque envoi." footer={footer}>
      <div className="space-y-5">
        {block("whatsapp.template_supplier", "Commande fournisseur", "{supplier_name} {product_name} {current_stock} {recommended_quantity} {company_name}")}
        {block("whatsapp.template_reminder", "Rappel de paiement client", "{customer_name} {amount} {company_name}")}
        {block("whatsapp.template_receipt", "Envoi de reçu / facture", "{customer_name} {number} {amount} {company_name}")}
      </div>
    </SectionCard>
  );
}
