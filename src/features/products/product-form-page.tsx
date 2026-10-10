import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { ImagePlus, RefreshCw, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { BarcodeSvg } from "@/components/common/barcode";
import { NumberInput, MoneyInput } from "@/components/common/inputs";
import { LoadingRows, Page, PageHeader } from "@/components/common/page";
import { SupplierPicker } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Card, CardHeader } from "@/components/ui/misc";
import { useAdjust } from "@/features/stock/adjust-dialog";
import { useWarehouses } from "@/features/warehouses/api";
import { useAction } from "@/hooks/use-action";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { section, unitShort } from "@/i18n";
import { generateEan13, isValidCode128 } from "@/lib/barcode";
import { margin } from "@/lib/calc";
import { one, select } from "@/lib/db";
import { imageSrc, storeImage } from "@/lib/files";
import { money, percent, qty } from "@/lib/format";
import { call, toAppError } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useApp, useCan, usePremium } from "@/stores/app";
import type { Product } from "@/types";
import { toast } from "sonner";

const TAX_RATES = [0, 7, 10, 14, 20];

const schema = z
  .object({
    name: z.string().trim().min(1, "Le nom du produit est obligatoire.").max(200),
    description: z.string().optional(),
    category_id: z.number().nullable(),
    brand: z.string().optional(),
    sku: z.string().trim().max(64).optional(),
    barcode: z
      .string()
      .trim()
      .optional()
      .refine((v) => !v || isValidCode128(v), "Code-barres invalide (caractères non autorisés)."),
    purchase_price: z.number({ invalid_type_error: "Prix invalide." }).min(0, "Le prix doit être positif."),
    selling_price: z.number({ invalid_type_error: "Prix invalide." }).min(0, "Le prix doit être positif."),
    tax_rate: z.number(),
    unit: z.string(),
    initial_quantity: z.number().min(0, "La quantité doit être positive.").nullable(),
    minimum_stock: z.number().min(0, "Valeur positive requise."),
    maximum_stock: z.number().min(0).nullable(),
    supplier_id: z.number().nullable(),
    warehouse_id: z.number().nullable(),
    location: z.string().optional(),
    batch_number: z.string().optional(),
    expiration_date: z.string().optional(),
    product_type: z.string(),
    image: z.string().nullable(),
  })
  .refine((v) => v.maximum_stock === null || v.maximum_stock === 0 || v.maximum_stock >= v.minimum_stock, { path: ["maximum_stock"], message: "Le stock maximum doit être supérieur au minimum." });

type FormValues = z.infer<typeof schema>;

export function ProductFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const can = useCan();
  const premium = usePremium();
  const defaultTax = useApp((s) => s.company?.default_tax_rate ?? 20);
  const includeTax = useApp((s) => s.settings["sales.prices_include_tax"]);
  const openAdjust = useAdjust((s) => s.open);
  const { run, pending } = useAction();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const showCost = can("view_purchase_price");
  const { data: warehouses = [] } = useWarehouses();

  const { data: product, isLoading } = useQuery({ queryKey: ["product", id], enabled: !!id, queryFn: () => one<Product>("SELECT * FROM products WHERE id = ?", [id]) });
  const { data: categories = [] } = useQuery({ queryKey: ["categories", "options"], queryFn: () => select<{ id: number; name: string }>("SELECT id, name FROM categories WHERE archived = 0 ORDER BY name") });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      description: "",
      category_id: null,
      brand: "",
      sku: "",
      barcode: search.get("barcode") ?? "",
      purchase_price: 0,
      selling_price: 0,
      tax_rate: defaultTax,
      unit: "piece",
      initial_quantity: null,
      minimum_stock: 0,
      maximum_stock: null,
      supplier_id: null,
      warehouse_id: null,
      location: "",
      batch_number: "",
      expiration_date: "",
      product_type: "standard",
      image: null,
    },
  });

  useEffect(() => {
    if (product)
      form.reset({
        name: product.name,
        description: product.description ?? "",
        category_id: product.category_id,
        brand: product.brand ?? "",
        sku: product.sku ?? "",
        barcode: product.barcode ?? "",
        purchase_price: product.purchase_price,
        selling_price: product.selling_price,
        tax_rate: product.tax_rate,
        unit: product.unit,
        initial_quantity: null,
        minimum_stock: product.minimum_stock,
        maximum_stock: product.maximum_stock,
        supplier_id: product.supplier_id,
        warehouse_id: product.warehouse_id,
        location: product.location ?? "",
        batch_number: product.batch_number ?? "",
        expiration_date: product.expiration_date ?? "",
        product_type: product.product_type,
        image: product.image,
      });
  }, [product, form]);

  const { errors } = form.formState;
  const v = form.watch();
  const m = margin(v.selling_price || 0, v.purchase_price || 0, v.tax_rate, includeTax);

  const submit = form.handleSubmit(async (values) => {
    const newId = await run(
      () =>
        call<number>("product_save", {
          input: {
            ...values,
            id,
            maximum_stock: values.maximum_stock || null,
            expiration_date: values.expiration_date || null,
            initial_quantity: id ? null : values.initial_quantity,
          },
        }),
      { success: id ? "Produit enregistré avec succès." : "Produit ajouté avec succès." },
    );
    if (newId) navigate(`/products/${newId}`, { replace: true });
  });

  useShortcuts({ "ctrl+s": () => submit() });

  const pickImage = async (f: File) => {
    setUploading(true);
    try {
      form.setValue("image", await storeImage(f), { shouldDirty: true });
    } catch (e) {
      toast.error(toAppError(e).message);
    } finally {
      setUploading(false);
    }
  };

  if (id && isLoading) return <LoadingRows />;
  const units = section("units") as Record<string, string>;

  return (
    <Page className="max-w-[1180px]">
      <form onSubmit={submit} noValidate>
        <PageHeader
          back={id ? `/products/${id}` : "/products"}
          title={id ? `Modifier ${product?.name ?? "le produit"}` : "Nouveau produit"}
          description={id ? "Les quantités se modifient uniquement via un ajustement de stock tracé." : "Renseignez les informations essentielles ; le reste est facultatif."}
          actions={
            <>
              <Button variant="secondary" onClick={() => navigate(-1)}>
                Annuler
              </Button>
              <Button type="submit" loading={pending}>
                <Save /> Enregistrer <span className="ml-1 rounded bg-white/15 px-1 text-[0.6875rem]">Ctrl+S</span>
              </Button>
            </>
          }
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Informations générales" />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-5">
                <Field label="Nom du produit" required error={errors.name?.message} className="col-span-2">
                  <Input autoFocus {...form.register("name")} aria-invalid={!!errors.name} placeholder="Ex. Coca Cola 1L" />
                </Field>
                <Field label="Catégorie">
                  <Controller
                    control={form.control}
                    name="category_id"
                    render={({ field }) => (
                      <Select value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}>
                        <option value="">Sans catégorie</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Marque">
                  <Input {...form.register("brand")} />
                </Field>
                <Field label="Description" className="col-span-2">
                  <Textarea rows={2} {...form.register("description")} />
                </Field>
              </div>
            </Card>

            <Card>
              <CardHeader title="Prix" description={includeTax ? "Prix de vente TTC (TVA incluse)." : "Prix de vente HT."} />
              <div className="grid grid-cols-3 gap-x-4 gap-y-3.5 p-5">
                {showCost && (
                  <Field label="Prix d'achat HT" error={errors.purchase_price?.message}>
                    <Controller control={form.control} name="purchase_price" render={({ field }) => <MoneyInput value={field.value} onValueChange={(x) => field.onChange(x ?? 0)} />} />
                  </Field>
                )}
                <Field label="Prix de vente" required error={errors.selling_price?.message}>
                  <Controller control={form.control} name="selling_price" render={({ field }) => <MoneyInput value={field.value} onValueChange={(x) => field.onChange(x ?? 0)} />} />
                </Field>
                <Field label="TVA">
                  <Controller
                    control={form.control}
                    name="tax_rate"
                    render={({ field }) => (
                      <Select value={field.value} onChange={(e) => field.onChange(Number(e.target.value))}>
                        {TAX_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r} %
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                </Field>
                {showCost && (
                  <div className="col-span-3 grid grid-cols-3 gap-3 rounded-lg border bg-subtle p-3">
                    <div>
                      <div className="text-[0.75rem] text-muted-foreground">Marge unitaire</div>
                      <div className={cn("num text-[1rem] font-semibold", m.value < 0 ? "text-danger" : "text-success")}>{money(m.value)}</div>
                    </div>
                    <div>
                      <div className="text-[0.75rem] text-muted-foreground">Taux de marge</div>
                      <div className={cn("num text-[1rem] font-semibold", m.value < 0 ? "text-danger" : "")}>{percent(m.rate)}</div>
                    </div>
                    <div>
                      <div className="text-[0.75rem] text-muted-foreground">Coefficient</div>
                      <div className="num text-[1rem] font-semibold">{percent(m.markup)}</div>
                    </div>
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Stock" />
              <div className="grid grid-cols-3 gap-x-4 gap-y-3.5 p-5">
                <Field label="Unité">
                  <Select {...form.register("unit")}>
                    {Object.entries(units).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                {id ? (
                  <Field label="Stock actuel">
                    <div className="flex h-9 items-center justify-between rounded-md border bg-subtle px-3">
                      <span className="num font-semibold">
                        {qty(product?.quantity ?? 0)} {unitShort(v.unit)}
                      </span>
                      {can("manage_stock") && (
                        <button type="button" onClick={() => openAdjust(id)} className="flex items-center gap-1 text-[0.75rem] font-medium text-primary hover:underline">
                          <SlidersHorizontal className="size-3.5" /> Ajuster
                        </button>
                      )}
                    </div>
                  </Field>
                ) : (
                  <Field label="Stock initial" error={errors.initial_quantity?.message} hint="Enregistré comme mouvement « Stock initial ».">
                    <Controller control={form.control} name="initial_quantity" render={({ field }) => <NumberInput value={field.value} onValueChange={field.onChange} decimals={3} allowEmpty placeholder="0" />} />
                  </Field>
                )}
                <Field label="Type">
                  <Select {...form.register("product_type")}>
                    <option value="standard">Produit standard</option>
                    <option value="raw_material">Matière première</option>
                    <option value="finished_good">Produit fini</option>
                    <option value="service">Service (sans stock)</option>
                  </Select>
                </Field>
                <Field label="Stock minimum" error={errors.minimum_stock?.message} hint="Alerte « stock faible » en dessous.">
                  <Controller control={form.control} name="minimum_stock" render={({ field }) => <NumberInput value={field.value} onValueChange={(x) => field.onChange(x ?? 0)} decimals={3} />} />
                </Field>
                <Field label="Stock maximum" error={errors.maximum_stock?.message}>
                  <Controller control={form.control} name="maximum_stock" render={({ field }) => <NumberInput value={field.value} onValueChange={field.onChange} decimals={3} allowEmpty placeholder="—" />} />
                </Field>
                <Field label="Emplacement">
                  <Input {...form.register("location")} placeholder="Ex. Rayon B3" />
                </Field>
                {premium && warehouses.length > 1 && (
                  <Field label="Entrepôt principal">
                    <Controller
                      control={form.control}
                      name="warehouse_id"
                      render={({ field }) => (
                        <Select value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value ? Number(e.target.value) : null)}>
                          <option value="">Entrepôt par défaut</option>
                          {warehouses.map((w) => (
                            <option key={w.id} value={w.id}>
                              {w.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    />
                  </Field>
                )}
              </div>
            </Card>

            <Card>
              <CardHeader title="Lot et expiration" description="Facultatif — utile pour l'alimentaire, les cosmétiques et le paramédical." />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 p-5">
                <Field label="N° de lot">
                  <Input {...form.register("batch_number")} />
                </Field>
                <Field label="Date d'expiration">
                  <Input type="date" {...form.register("expiration_date")} />
                </Field>
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-5">
              <div className="section-title mb-3">Image</div>
              <Controller
                control={form.control}
                name="image"
                render={({ field }) => (
                  <div>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg border border-dashed bg-subtle text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      {field.value ? (
                        <img src={imageSrc(field.value) ?? ""} alt="" className="size-full object-contain" />
                      ) : (
                        <span className="flex flex-col items-center gap-2 text-[0.8125rem]">
                          <ImagePlus className="size-6" /> {uploading ? "Import…" : "Ajouter une image"}
                        </span>
                      )}
                    </button>
                    {field.value && (
                      <Button type="button" variant="ghost" size="sm" className="mt-2 text-muted-foreground" onClick={() => field.onChange(null)}>
                        <Trash2 /> Retirer l'image
                      </Button>
                    )}
                    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])} />
                  </div>
                )}
              />
            </Card>
            <Card className="p-5">
              <div className="section-title mb-3">Identification</div>
              <div className="space-y-3.5">
                <Field label="Code-barres" error={errors.barcode?.message} hint="Scannez directement dans ce champ.">
                  <div className="flex gap-2">
                    <Input {...form.register("barcode")} aria-invalid={!!errors.barcode} placeholder="EAN-13 ou Code128" className="flex-1" />
                    <Button type="button" variant="secondary" size="icon" onClick={() => form.setValue("barcode", generateEan13(), { shouldDirty: true })} aria-label="Générer un EAN-13">
                      <RefreshCw />
                    </Button>
                  </div>
                </Field>
                {v.barcode && isValidCode128(v.barcode) && (
                  <div className="flex justify-center rounded-lg border bg-white px-3 py-3 text-black">
                    <BarcodeSvg value={v.barcode} height={46} />
                  </div>
                )}
                <Field label="Référence (SKU)">
                  <Input {...form.register("sku")} placeholder="Ex. BOI-001" />
                </Field>
              </div>
            </Card>
            <Card className="p-5">
              <div className="section-title mb-3">Fournisseur</div>
              <Controller control={form.control} name="supplier_id" render={({ field }) => <SupplierPicker value={field.value} onChange={(s) => field.onChange(s?.id ?? null)} placeholder="Aucun fournisseur" />} />
            </Card>
          </div>
        </div>
      </form>
    </Page>
  );
}
