import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, type ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { call } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { MoneyInput, NumberInput } from "./inputs";

export interface EntityField {
  name: string;
  label: string;
  type?: "text" | "textarea" | "number" | "money" | "color" | "email" | "phone";
  required?: boolean;
  span?: 1 | 2;
  placeholder?: string;
  hint?: string;
  pattern?: { regex: RegExp; message: string };
}

const COLORS = ["#4f46e5", "#2563eb", "#0891b2", "#059669", "#65a30d", "#d97706", "#dc2626", "#db2777", "#7c3aed", "#475569"];

function buildSchema(fields: EntityField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    if (f.type === "number" || f.type === "money") {
      shape[f.name] = z.number({ invalid_type_error: "Valeur invalide." }).min(0, "La valeur doit être positive.").nullable();
    } else {
      let s: z.ZodTypeAny = z.string().trim().max(2000, "Texte trop long.");
      if (f.required) s = (s as z.ZodString).min(1, `${f.label} : champ obligatoire.`);
      if (f.type === "email") s = s.refine((v: string) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Adresse email invalide.");
      if (f.type === "phone") s = s.refine((v: string) => !v || /^[+\d\s().-]{6,20}$/.test(v), "Numéro de téléphone invalide.");
      if (f.pattern) s = s.refine((v: string) => !v || f.pattern!.regex.test(v), f.pattern.message);
      shape[f.name] = s;
    }
  }
  return z.object(shape);
}

/** Formulaire de création / modification pour les référentiels simples (via `entity_save`). */
export function EntityDialog({
  open,
  onOpenChange,
  table,
  title,
  icon,
  fields,
  initial,
  id,
  successMessage,
  onSaved,
  extra,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  table: "categories" | "customers" | "suppliers" | "warehouses";
  title: string;
  icon?: ReactNode;
  fields: EntityField[];
  initial?: object | null;
  id?: number | null;
  successMessage: string;
  onSaved?: (id: number) => void;
  extra?: ReactNode;
}) {
  const schema = buildSchema(fields);
  const defaults = () => Object.fromEntries(fields.map((f) => [f.name, (initial as Record<string, unknown> | null | undefined)?.[f.name] ?? (f.type === "number" || f.type === "money" ? (f.required ? 0 : null) : "")]));
  const form = useForm<Record<string, unknown>>({ resolver: zodResolver(schema), defaultValues: defaults() });
  const { run, pending } = useAction();

  useEffect(() => {
    if (open) form.reset(defaults());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = form.handleSubmit(async (values) => {
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === null ? (fields.find((f) => f.name === k)?.type === "money" || fields.find((f) => f.name === k)?.type === "number" ? 0 : null) : v]));
    const newId = await run(() => call<number>("entity_save", { table, id: id ?? null, values: clean }), { success: successMessage });
    if (newId) {
      onOpenChange(false);
      onSaved?.(newId);
    }
  });

  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size={fields.length > 4 ? "lg" : "md"} title={title} icon={icon}>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
          <DialogBody className="grid grid-cols-2 gap-x-4 gap-y-3.5">
            {fields.map((f, i) => (
              <Field key={f.name} label={f.label} required={f.required} error={errors[f.name]?.message} hint={f.hint} className={cn(f.span === 2 || f.type === "textarea" ? "col-span-2" : "col-span-2 sm:col-span-1")}>
                {f.type === "textarea" ? (
                  <Textarea rows={3} {...form.register(f.name)} placeholder={f.placeholder} />
                ) : f.type === "money" || f.type === "number" ? (
                  <Controller
                    control={form.control}
                    name={f.name}
                    render={({ field }) =>
                      f.type === "money" ? (
                        <MoneyInput value={field.value as number | null} onValueChange={field.onChange} allowEmpty placeholder={f.placeholder} />
                      ) : (
                        <NumberInput value={field.value as number | null} onValueChange={field.onChange} allowEmpty decimals={0} placeholder={f.placeholder} />
                      )
                    }
                  />
                ) : f.type === "color" ? (
                  <Controller
                    control={form.control}
                    name={f.name}
                    render={({ field }) => (
                      <div className="flex flex-wrap gap-2">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => field.onChange(c)}
                            className={cn("size-7 rounded-full ring-offset-2 ring-offset-popover transition-transform hover:scale-110", field.value === c && "ring-2 ring-foreground")}
                            style={{ background: c }}
                            aria-label={c}
                          />
                        ))}
                      </div>
                    )}
                  />
                ) : (
                  <Input autoFocus={i === 0} {...form.register(f.name)} placeholder={f.placeholder} aria-invalid={!!errors[f.name]} type={f.type === "email" ? "email" : "text"} />
                )}
              </Field>
            ))}
            {extra}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={pending}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
