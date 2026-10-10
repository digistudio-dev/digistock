import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Building2, Check, Database, Factory, FileText, ImagePlus, Package, PartyPopper, Receipt, ShieldCheck, Store, Truck, Warehouse, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { storeImage } from "@/lib/files";
import { call, toAppError } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp } from "@/stores/app";
import type { Session } from "@/types";
import { AuthLayout } from "./auth-layout";

const STEPS = ["Bienvenue", "Entreprise", "Activité", "Tickets", "Administrateur", "Terminé"];

const companySchema = z.object({
  name: z.string().trim().min(2, "Le nom de l'entreprise est obligatoire."),
  phone: z.string().trim().optional(),
  whatsapp: z.string().trim().optional(),
  email: z.string().trim().email("Adresse email invalide.").or(z.literal("")).optional(),
  address: z.string().trim().optional(),
  city: z.string().trim().optional(),
  ice: z
    .string()
    .trim()
    .regex(/^(\d{15})?$/, "L'ICE comporte 15 chiffres.")
    .optional(),
  if_number: z.string().trim().optional(),
  rc: z.string().trim().optional(),
  currency: z.string().default("MAD"),
});

const adminSchema = z
  .object({
    name: z.string().trim().min(2, "Votre nom est obligatoire."),
    username: z
      .string()
      .trim()
      .min(3, "3 caractères minimum.")
      .regex(/^\S+$/, "Sans espace."),
    email: z.string().trim().email("Adresse email invalide.").or(z.literal("")).optional(),
    password: z.string().min(6, "6 caractères minimum."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

const BUSINESS: { value: string; label: string; desc: string; icon: LucideIcon }[] = [
  { value: "commerce", label: "Commerce", desc: "Boutique, supérette, magasin", icon: Store },
  { value: "wholesale", label: "Grossiste", desc: "Vente en gros aux revendeurs", icon: Package },
  { value: "warehouse", label: "Entrepôt", desc: "Stockage et logistique", icon: Warehouse },
  { value: "distribution", label: "Distribution", desc: "Livraison et tournées", icon: Truck },
  { value: "manufacturing", label: "Fabrication", desc: "Atelier, petite usine", icon: Factory },
  { value: "other", label: "Autre", desc: "Une autre activité", icon: Building2 },
];

const RECEIPTS: { value: string; label: string; desc: string; width: string }[] = [
  { value: "ticket_58", label: "Ticket 58 mm", desc: "Petites imprimantes thermiques", width: "w-10" },
  { value: "ticket_80", label: "Ticket 80 mm", desc: "Imprimantes de caisse standard", width: "w-14" },
  { value: "a4", label: "Facture A4", desc: "Imprimante de bureau", width: "w-[72px]" },
];

function Choice({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-start gap-3 rounded-lg border bg-surface p-4 text-left transition-all hover:border-foreground/25",
        selected && "border-primary bg-primary-soft/50 ring-[3px] ring-primary/15 hover:border-primary",
      )}
    >
      {children}
      {selected && (
        <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-primary text-white">
          <Check className="size-3" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

export function Onboarding() {
  const debug = useApp((s) => s.bootstrap?.debug);
  const init = useApp((s) => s.init);
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState("commerce");
  const [receipt, setReceipt] = useState("ticket_80");
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const company = useForm<z.infer<typeof companySchema>>({ resolver: zodResolver(companySchema), defaultValues: { currency: "MAD" } });
  const admin = useForm<z.infer<typeof adminSchema>>({ resolver: zodResolver(adminSchema), defaultValues: { name: "", username: "admin", email: "", password: "", confirm: "" } });

  const next = async () => {
    if (step === 1 && !(await company.trigger())) return;
    if (step === 4) {
      if (!(await admin.trigger())) return;
      await finish();
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const finish = async () => {
    setSubmitting(true);
    try {
      const c = company.getValues();
      const a = admin.getValues();
      await call<Session>("setup_complete", {
        input: {
          company: { ...c, default_tax_rate: 20 },
          business_type: business,
          receipt_format: receipt,
          admin: { name: a.name, username: a.username, email: a.email || null, password: a.password },
        },
      });
      if (logo) {
        try {
          const name = await storeImage(logo, 400);
          await call("company_save", { values: { name: c.name, logo: name } });
        } catch {
          toast.error("Le logo n'a pas pu être enregistré. Vous pourrez l'ajouter dans les paramètres.");
        }
      }
      setStep(5);
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setSubmitting(false);
    }
  };

  const seed = async () => {
    setSeeding(true);
    try {
      await call("dev_seed_demo");
      await init();
      toast.success("Données de démonstration chargées.", { description: "Identifiant : admin — mot de passe : admin123" });
    } catch (e) {
      toast.error(toAppError(e).message);
      setSeeding(false);
    }
  };

  const ce = company.formState.errors;
  const ae = admin.formState.errors;

  return (
    <AuthLayout
      aside={
        <ol className="space-y-1">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-[0.875rem] transition-colors", i === step ? "bg-white/[0.07] text-white" : i < step ? "text-white/75" : "text-white/40")}>
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[0.75rem] font-semibold ring-1",
                  i < step ? "bg-[hsl(221_70%_62%)] text-white ring-transparent" : i === step ? "ring-white/60" : "ring-white/20",
                )}
              >
                {i < step ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
      }
    >
      <div className="m-auto w-full max-w-[600px] px-8 py-10">
        {step === 0 && (
          <div className="animate-in fade-in-0 slide-in-from-bottom-1">
            <p className="eyebrow mb-3">Étape 1 sur 6</p>
            <h1 className="text-[2rem] font-semibold leading-tight">Bienvenue sur DigiStock.</h1>
            <p className="mt-3 text-[1rem] text-muted-foreground">Configurez votre entreprise en quelques instants.</p>
            <div className="mt-8 grid gap-3">
              {[
                [Receipt, "Une caisse rapide", "Scannez, encaissez, imprimez — en quelques secondes."],
                [Package, "Un stock toujours juste", "Chaque mouvement est enregistré et traçable."],
                [ShieldCheck, "Vos données chez vous", "Fonctionne hors ligne. Rien ne quitte votre ordinateur."],
              ].map(([Icon, t, d]) => {
                const I = Icon as LucideIcon;
                return (
                  <div key={t as string} className="flex items-start gap-3.5 rounded-lg border bg-surface p-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <I className="size-[18px]" />
                    </span>
                    <div>
                      <div className="text-[0.875rem] font-semibold">{t as string}</div>
                      <div className="text-[0.8125rem] text-muted-foreground">{d as string}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            {debug && (
              <div className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-dashed border-warning/40 bg-warning-soft/50 p-4">
                <div className="text-[0.8125rem]">
                  <div className="font-semibold">Mode développement</div>
                  <div className="text-muted-foreground">Charger « Demo Store » avec produits, clients et ventes.</div>
                </div>
                <Button variant="secondary" size="sm" onClick={seed} loading={seeding}>
                  <Database /> Données de démo
                </Button>
              </div>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="animate-in fade-in-0">
            <p className="eyebrow mb-2">Étape 2 sur 6</p>
            <h1 className="text-[1.5rem] font-semibold">Votre entreprise</h1>
            <p className="mt-1 text-[0.875rem] text-muted-foreground">Ces informations apparaîtront sur vos tickets et factures.</p>
            <div className="mt-6 flex items-center gap-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed bg-surface text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                {logoPreview ? <img src={logoPreview} className="size-full object-contain" alt="Logo" /> : <ImagePlus className="size-5" />}
              </button>
              <div className="text-[0.8125rem]">
                <div className="font-medium">Logo de l'entreprise</div>
                <div className="text-muted-foreground">PNG ou JPG — facultatif</div>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setLogo(f);
                  setLogoPreview(URL.createObjectURL(f));
                }}
              />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="Nom de l'entreprise" required error={ce.name?.message} className="col-span-2">
                <Input autoFocus {...company.register("name")} aria-invalid={!!ce.name} placeholder="Ex. Épicerie Al Baraka" />
              </Field>
              <Field label="Téléphone">
                <Input {...company.register("phone")} placeholder="05 22 00 00 00" />
              </Field>
              <Field label="WhatsApp">
                <Input {...company.register("whatsapp")} placeholder="06 00 00 00 00" />
              </Field>
              <Field label="Email" error={ce.email?.message}>
                <Input {...company.register("email")} aria-invalid={!!ce.email} />
              </Field>
              <Field label="Ville">
                <Input {...company.register("city")} placeholder="Casablanca" />
              </Field>
              <Field label="Adresse" className="col-span-2">
                <Input {...company.register("address")} />
              </Field>
              <Field label="ICE" error={ce.ice?.message}>
                <Input {...company.register("ice")} aria-invalid={!!ce.ice} placeholder="15 chiffres" />
              </Field>
              <Field label="IF">
                <Input {...company.register("if_number")} />
              </Field>
              <Field label="RC">
                <Input {...company.register("rc")} />
              </Field>
              <Field label="Devise">
                <Select {...company.register("currency")}>
                  <option value="MAD">Dirham marocain (MAD / DH)</option>
                </Select>
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="animate-in fade-in-0">
            <p className="eyebrow mb-2">Étape 3 sur 6</p>
            <h1 className="text-[1.5rem] font-semibold">Votre activité</h1>
            <p className="mt-1 text-[0.875rem] text-muted-foreground">Nous adaptons DigiStock à votre façon de travailler.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {BUSINESS.map((b) => (
                <Choice key={b.value} selected={business === b.value} onClick={() => setBusiness(b.value)}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
                    <b.icon className="size-[18px]" />
                  </span>
                  <span>
                    <span className="block text-[0.875rem] font-semibold">{b.label}</span>
                    <span className="block text-[0.75rem] text-muted-foreground">{b.desc}</span>
                  </span>
                </Choice>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="animate-in fade-in-0">
            <p className="eyebrow mb-2">Étape 4 sur 6</p>
            <h1 className="text-[1.5rem] font-semibold">Format des reçus</h1>
            <p className="mt-1 text-[0.875rem] text-muted-foreground">Modifiable à tout moment dans les paramètres.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {RECEIPTS.map((r) => (
                <Choice key={r.value} selected={receipt === r.value} onClick={() => setReceipt(r.value)}>
                  <span className="flex w-full flex-col items-center pt-2 text-center">
                    <span className="mb-4 flex h-24 items-end">
                      <span className={cn("flex h-full flex-col gap-1.5 rounded-sm border bg-background p-2 shadow-card", r.width)}>
                        {r.value === "a4" ? <FileText className="size-3 text-primary" /> : <span className="h-1 w-3 rounded bg-primary/60" />}
                        {[80, 60, 70, 50, 65].map((w, i) => (
                          <span key={i} className="h-1 rounded bg-muted-foreground/25" style={{ width: `${w}%` }} />
                        ))}
                      </span>
                    </span>
                    <span className="block text-[0.875rem] font-semibold">{r.label}</span>
                    <span className="block text-[0.75rem] text-muted-foreground">{r.desc}</span>
                  </span>
                </Choice>
              ))}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="animate-in fade-in-0">
            <p className="eyebrow mb-2">Étape 5 sur 6</p>
            <h1 className="text-[1.5rem] font-semibold">Compte administrateur</h1>
            <p className="mt-1 text-[0.875rem] text-muted-foreground">Ce compte protège l'accès à DigiStock. Le mot de passe est chiffré et jamais stocké en clair.</p>
            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3.5">
              <Field label="Nom complet" required error={ae.name?.message} className="col-span-2">
                <Input autoFocus {...admin.register("name")} aria-invalid={!!ae.name} />
              </Field>
              <Field label="Identifiant" required error={ae.username?.message}>
                <Input {...admin.register("username")} aria-invalid={!!ae.username} />
              </Field>
              <Field label="Email" error={ae.email?.message}>
                <Input {...admin.register("email")} aria-invalid={!!ae.email} />
              </Field>
              <Field label="Mot de passe" required error={ae.password?.message}>
                <Input type="password" {...admin.register("password")} aria-invalid={!!ae.password} />
              </Field>
              <Field label="Confirmation" required error={ae.confirm?.message}>
                <Input type="password" {...admin.register("confirm")} aria-invalid={!!ae.confirm} onKeyDown={(e) => e.key === "Enter" && next()} />
              </Field>
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="animate-in fade-in-0 zoom-in-[0.98] text-center">
            <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-success-soft text-success">
              <PartyPopper className="size-7" />
            </div>
            <h1 className="text-[1.75rem] font-semibold">Votre espace DigiStock est prêt.</h1>
            <p className="mx-auto mt-2 max-w-sm text-[0.9375rem] text-muted-foreground">Ajoutez vos premiers produits ou importez votre catalogue, puis lancez votre première vente.</p>
            <Button size="lg" className="mt-8" onClick={() => init()}>
              Accéder à DigiStock <ArrowRight />
            </Button>
          </div>
        )}

        {step < 5 && (
          <div className="mt-10 flex items-center justify-between border-t pt-5">
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)} disabled={step === 0}>
              <ArrowLeft /> Précédent
            </Button>
            <Button onClick={next} loading={submitting}>
              {step === 0 ? "Commencer" : step === 4 ? "Créer mon espace" : "Continuer"} <ArrowRight />
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
