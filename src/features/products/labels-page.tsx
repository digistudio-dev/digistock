import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Printer, Tags, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BarcodeSvg, barcodeSvgString } from "@/components/common/barcode";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { ProductFinder, type ProductOption } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Card, CardHeader, Switch } from "@/components/ui/misc";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { select } from "@/lib/db";
import { money } from "@/lib/format";
import { escapeHtml, printHtml } from "@/lib/print";
import { useApp } from "@/stores/app";
import { useScanHandler } from "@/stores/scan";

interface LabelItem {
  id: number;
  name: string;
  barcode: string | null;
  selling_price: number;
  count: number;
}

const FORMATS = {
  "50x30": { label: "Étiquette 50 × 30 mm (rouleau)", w: 50, h: 30, sheet: false },
  "40x25": { label: "Étiquette 40 × 25 mm (rouleau)", w: 40, h: 25, sheet: false },
  "a4-3x8": { label: "Planche A4 — 24 étiquettes (70 × 37 mm)", w: 70, h: 37, sheet: true, cols: 3 },
  "a4-4x10": { label: "Planche A4 — 40 étiquettes (52,5 × 29,7 mm)", w: 52.5, h: 29.7, sheet: true, cols: 4 },
} as const;

type FormatKey = keyof typeof FORMATS;

export function LabelsPage() {
  const [params] = useSearchParams();
  const company = useApp((s) => s.company);
  const [items, setItems] = useState<LabelItem[]>([]);
  const [format, setFormat] = useState<FormatKey>("50x30");
  const [showPrice, setShowPrice] = useState(true);
  const [showName, setShowName] = useState(true);
  const [showCompany, setShowCompany] = useState(false);

  const ids = params.get("ids");
  const { data: initial } = useQuery({
    queryKey: ["labels", ids],
    enabled: !!ids,
    queryFn: () => {
      const list = (ids ?? "").split(",").map(Number).filter(Boolean).slice(0, 500);
      return select<LabelItem>(`SELECT id, name, barcode, selling_price, 1 AS count FROM products WHERE id IN (${list.map(() => "?").join(",")})`, list);
    },
  });
  useEffect(() => {
    if (initial) setItems(initial);
  }, [initial]);

  const add = (p: Pick<ProductOption, "id" | "name" | "barcode" | "selling_price">) => {
    if (!p.barcode) toast.warning(`« ${p.name} » n'a pas de code-barres : l'étiquette affichera seulement le nom et le prix.`);
    setItems((cur) => (cur.some((i) => i.id === p.id) ? cur.map((i) => (i.id === p.id ? { ...i, count: i.count + 1 } : i)) : [...cur, { id: p.id, name: p.name, barcode: p.barcode, selling_price: p.selling_price, count: 1 }]));
  };

  useScanHandler(async (code) => {
    const rows = await select<LabelItem>("SELECT id, name, barcode, selling_price, 1 AS count FROM products WHERE barcode = ? AND archived = 0", [code]);
    if (rows[0]) add(rows[0]);
    else toast.error("Produit introuvable", { description: code });
  });

  const total = items.reduce((s, i) => s + i.count, 0);
  const f = FORMATS[format];

  const html = useMemo(() => {
    const labels = items.flatMap((i) => Array.from({ length: i.count }, () => i));
    const cell = (i: LabelItem) => `
      <div class="lab">
        ${showCompany && company?.name ? `<div class="co">${escapeHtml(company.name)}</div>` : ""}
        ${showName ? `<div class="nm">${escapeHtml(i.name)}</div>` : ""}
        ${i.barcode ? `<div class="bc">${barcodeSvgString(i.barcode, { height: Math.max(18, f.h * 1.05), width: f.w >= 50 ? 1.4 : 1.15, fontSize: 10 })}</div>` : ""}
        ${showPrice ? `<div class="pr">${escapeHtml(money(i.selling_price))}</div>` : ""}
      </div>`;
    const css = `
      .lab { width: ${f.w}mm; height: ${f.h}mm; padding: 1.5mm 2mm; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6mm; overflow: hidden; text-align: center; font-family: Arial, sans-serif; }
      .co { font-size: 6.5px; color: #444; }
      .nm { font-size: ${f.w >= 50 ? 8.5 : 7.5}px; font-weight: 700; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
      .bc svg { max-width: ${f.w - 5}mm; height: auto; max-height: ${f.h * 0.5}mm; }
      .pr { font-size: ${f.w >= 50 ? 12 : 10}px; font-weight: 800; }
      .sheet { display: grid; grid-template-columns: repeat(${"cols" in f ? f.cols : 1}, ${f.w}mm); }
      .roll .lab { page-break-after: always; }`;
    const body = f.sheet ? `<div class="sheet">${labels.map(cell).join("")}</div>` : `<div class="roll">${labels.map(cell).join("")}</div>`;
    return { html: `<style>${css}</style>${body}`, pageCss: f.sheet ? "@page { size: A4; margin: 10mm 0 0 0; }" : `@page { size: ${f.w}mm ${f.h}mm; margin: 0; }` };
  }, [items, f, showPrice, showName, showCompany, company]);

  const print = () => {
    if (!total) return toast.error("Ajoutez au moins un produit.");
    printHtml(html.html, { pageCss: html.pageCss });
  };
  useShortcuts({ "ctrl+p": print });

  return (
    <Page>
      <PageHeader
        back="/products"
        title="Étiquettes code-barres"
        description="Imprimez des étiquettes avec nom, prix et code-barres (EAN-13 ou Code128)."
        actions={
          <Button onClick={print} disabled={!total}>
            <Printer /> Imprimer {total > 0 && `(${total})`}
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader title="Produits" description="Recherchez ou scannez des produits, puis indiquez le nombre d'étiquettes." />
          <div className="p-5">
            <ProductFinder onPick={add} />
            {items.length === 0 ? (
              <EmptyState compact icon={<Tags />} title="Aucun produit" description="Scannez un code-barres ou recherchez un produit pour commencer." />
            ) : (
              <div className="mt-4 divide-y rounded-lg border">
                {items.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[0.8125rem] font-medium">{i.name}</div>
                      <div className="text-[0.75rem] text-muted-foreground">
                        {i.barcode ?? "Sans code-barres"} · {money(i.selling_price)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="secondary" size="icon-xs" onClick={() => setItems((c) => c.map((x) => (x.id === i.id ? { ...x, count: Math.max(1, x.count - 1) } : x)))}>
                        <Minus />
                      </Button>
                      <Input
                        inputSize="sm"
                        className="num w-16 text-center"
                        value={i.count}
                        onChange={(e) => {
                          const n = Math.min(1000, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1));
                          setItems((c) => c.map((x) => (x.id === i.id ? { ...x, count: n } : x)));
                        }}
                      />
                      <Button variant="secondary" size="icon-xs" onClick={() => setItems((c) => c.map((x) => (x.id === i.id ? { ...x, count: x.count + 1 } : x)))}>
                        <Plus />
                      </Button>
                    </div>
                    <Button variant="ghost" size="icon-xs" onClick={() => setItems((c) => c.filter((x) => x.id !== i.id))} aria-label="Retirer">
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="space-y-3.5 p-5">
            <div className="section-title">Format</div>
            <Field label="Type d'étiquette">
              <Select value={format} onChange={(e) => setFormat(e.target.value as FormatKey)}>
                {Object.entries(FORMATS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </Field>
            <label className="flex items-center justify-between text-[0.8125rem]">
              Nom du produit <Switch checked={showName} onCheckedChange={setShowName} />
            </label>
            <label className="flex items-center justify-between text-[0.8125rem]">
              Prix <Switch checked={showPrice} onCheckedChange={setShowPrice} />
            </label>
            <label className="flex items-center justify-between text-[0.8125rem]">
              Nom de l'entreprise <Switch checked={showCompany} onCheckedChange={setShowCompany} />
            </label>
          </Card>
          <Card className="p-5">
            <div className="section-title mb-3">Aperçu</div>
            {items[0] ? (
              <div className="flex justify-center">
                <div className="flex flex-col items-center justify-center gap-1 rounded-md border bg-white p-2 text-center text-black shadow-card" style={{ width: `${f.w * 3.4}px`, height: `${f.h * 3.4}px` }}>
                  {showCompany && <div className="text-[9px] text-neutral-500">{company?.name}</div>}
                  {showName && <div className="line-clamp-2 text-[11px] font-bold leading-tight">{items[0].name}</div>}
                  {items[0].barcode && <BarcodeSvg value={items[0].barcode} height={f.h * 1.1} width={1.3} fontSize={10} className="max-w-full" />}
                  {showPrice && <div className="text-[14px] font-extrabold">{money(items[0].selling_price)}</div>}
                </div>
              </div>
            ) : (
              <p className="text-[0.8125rem] text-muted-foreground">L'aperçu s'affichera ici.</p>
            )}
            <p className="mt-3 text-[0.75rem] text-muted-foreground">Total : {total} étiquette(s). La boîte d'impression Windows permet de choisir l'imprimante et d'afficher un aperçu.</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
