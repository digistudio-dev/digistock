import { AlertCircle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { EmptyState, Page, PageHeader } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader } from "@/components/ui/misc";
import { PRODUCT_CSV_SAMPLE, parseCsv, validateProductRows, type ImportIssue, type ProductImportRow } from "@/lib/csv";
import { select } from "@/lib/db";
import { saveCsv } from "@/lib/files";
import { money, qty } from "@/lib/format";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";

export function ProductImportPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const defaultTax = useApp((s) => s.company?.default_tax_rate ?? 20);
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [valid, setValid] = useState<ProductImportRow[]>([]);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [failures, setFailures] = useState<ImportIssue[]>([]);

  const load = async (f: File) => {
    setFileName(f.name);
    setFailures([]);
    const rows = parseCsv(await f.text());
    if (!rows.length) {
      toast.error("Le fichier est vide ou illisible.");
      return;
    }
    if (!("name" in rows[0]) || !("selling_price" in rows[0])) {
      toast.error("Colonnes manquantes", { description: "Les colonnes « name » et « selling_price » sont obligatoires. Téléchargez le modèle." });
    }
    const existing = await select<{ barcode: string | null; sku: string | null }>("SELECT barcode, sku FROM products WHERE archived = 0");
    const res = validateProductRows(rows, new Set(existing.map((e) => e.barcode).filter(Boolean) as string[]), new Set(existing.map((e) => e.sku).filter(Boolean) as string[]));
    setValid(res.valid);
    setIssues(res.issues);
  };

  const runImport = async () => {
    setProgress(0);
    const errs: ImportIssue[] = [];
    const cats = new Map((await select<{ id: number; name: string }>("SELECT id, name FROM categories WHERE archived = 0")).map((c) => [c.name.toLowerCase(), c.id]));
    const sups = new Map((await select<{ id: number; name: string }>("SELECT id, name FROM suppliers WHERE archived = 0")).map((c) => [c.name.toLowerCase(), c.id]));
    let done = 0;
    for (const r of valid) {
      try {
        let categoryId: number | null = null;
        if (r.category) {
          categoryId = cats.get(r.category.toLowerCase()) ?? null;
          if (!categoryId) {
            categoryId = await call<number>("entity_save", { table: "categories", id: null, values: { name: r.category } });
            cats.set(r.category.toLowerCase(), categoryId);
          }
        }
        let supplierId: number | null = null;
        if (r.supplier) {
          supplierId = sups.get(r.supplier.toLowerCase()) ?? null;
          if (!supplierId) {
            supplierId = await call<number>("entity_save", { table: "suppliers", id: null, values: { name: r.supplier } });
            sups.set(r.supplier.toLowerCase(), supplierId);
          }
        }
        await call("product_save", {
          input: {
            id: null,
            name: r.name,
            sku: r.sku,
            barcode: r.barcode,
            category_id: categoryId,
            supplier_id: supplierId,
            purchase_price: r.purchase_price,
            selling_price: r.selling_price,
            tax_rate: defaultTax,
            minimum_stock: r.minimum_stock,
            unit: "piece",
            initial_quantity: r.quantity,
          },
        });
      } catch (e) {
        errs.push({ line: r.line, message: toAppError(e).message });
      }
      done++;
      setProgress(Math.round((done / valid.length) * 100));
    }
    await qc.invalidateQueries();
    setFailures(errs);
    setProgress(null);
    const ok = valid.length - errs.length;
    if (errs.length) toast.warning(`${ok} produit(s) importé(s), ${errs.length} en erreur.`);
    else {
      toast.success(`${ok} produit(s) importé(s) avec succès.`);
      navigate("/products");
    }
  };

  const downloadSample = async () => {
    const path = await saveCsv("modele-import-produits.csv", PRODUCT_CSV_SAMPLE);
    if (path) toast.success("Modèle enregistré.", { description: path });
  };

  return (
    <Page className="max-w-[1180px]">
      <PageHeader
        back="/products"
        title="Importer des produits"
        description="Importez votre catalogue depuis un fichier CSV (Excel : « Enregistrer sous › CSV »)."
        actions={
          <Button variant="secondary" onClick={downloadSample}>
            <Download /> Télécharger le modèle
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Fichier" description={fileName ?? "Aucun fichier sélectionné"} actions={<Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}><Upload /> Choisir un fichier</Button>} />
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
          <div className="p-5">
            {!fileName ? (
              <button onClick={() => fileRef.current?.click()} className="w-full rounded-lg border-2 border-dashed transition-colors hover:border-primary/50">
                <EmptyState icon={<FileSpreadsheet />} title="Sélectionnez un fichier CSV" description="Séparateur « ; » ou « , ». La première ligne doit contenir les noms de colonnes." />
              </button>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Badge tone="success" dot>
                    {valid.length} ligne(s) valide(s)
                  </Badge>
                  {issues.length > 0 && (
                    <Badge tone="danger" dot>
                      {issues.length} ligne(s) invalide(s)
                    </Badge>
                  )}
                </div>
                {issues.length > 0 && (
                  <div className="mb-4 max-h-40 overflow-y-auto rounded-lg border border-danger/25 bg-danger-soft/60 p-3 text-[0.8125rem]">
                    {issues.map((i) => (
                      <div key={i.line} className="flex gap-2 py-0.5">
                        <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                        <span>
                          <b>Ligne {i.line}</b> : {i.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {failures.length > 0 && (
                  <div className="mb-4 rounded-lg border border-warning/30 bg-warning-soft p-3 text-[0.8125rem]">
                    {failures.map((i) => (
                      <div key={i.line}>
                        <b>Ligne {i.line}</b> : {i.message}
                      </div>
                    ))}
                  </div>
                )}
                <div className="max-h-[440px] overflow-auto rounded-lg border">
                  <table className="w-full text-[0.8125rem]">
                    <thead className="sticky top-0 bg-subtle text-left text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Ligne</th>
                        <th className="px-3 py-2">Nom</th>
                        <th className="px-3 py-2">Code-barres</th>
                        <th className="px-3 py-2">Catégorie</th>
                        <th className="px-3 py-2 text-right">Achat</th>
                        <th className="px-3 py-2 text-right">Vente</th>
                        <th className="px-3 py-2 text-right">Qté</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valid.slice(0, 300).map((r) => (
                        <tr key={r.line} className="border-t">
                          <td className="px-3 py-1.5 text-muted-foreground">{r.line}</td>
                          <td className="px-3 py-1.5 font-medium">{r.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{r.barcode ?? "—"}</td>
                          <td className="px-3 py-1.5">{r.category ?? "—"}</td>
                          <td className="num px-3 py-1.5 text-right">{money(r.purchase_price)}</td>
                          <td className="num px-3 py-1.5 text-right">{money(r.selling_price)}</td>
                          <td className="num px-3 py-1.5 text-right">{qty(r.quantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {valid.length > 300 && <div className="border-t px-3 py-2 text-center text-[0.75rem] text-muted-foreground">… et {valid.length - 300} autre(s) ligne(s)</div>}
                </div>
              </>
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-5 text-[0.8125rem]">
            <div className="section-title mb-2">Colonnes attendues</div>
            <ul className="space-y-1 text-muted-foreground">
              <li><code className="text-foreground">name</code> — nom (obligatoire)</li>
              <li><code className="text-foreground">selling_price</code> — prix de vente (obligatoire)</li>
              <li><code className="text-foreground">sku</code>, <code className="text-foreground">barcode</code></li>
              <li><code className="text-foreground">category</code> — créée si absente</li>
              <li><code className="text-foreground">purchase_price</code>, <code className="text-foreground">quantity</code>, <code className="text-foreground">minimum_stock</code></li>
              <li><code className="text-foreground">supplier</code> — créé si absent</li>
            </ul>
            <p className="mt-3 text-muted-foreground">Le stock importé est enregistré comme mouvement « Stock initial ».</p>
          </Card>
          <Button size="lg" className="w-full" disabled={!valid.length || progress !== null} loading={progress !== null} onClick={runImport}>
            {progress !== null ? `Import en cours… ${progress} %` : (
              <>
                <CheckCircle2 /> Importer {valid.length} produit(s)
              </>
            )}
          </Button>
          {progress !== null && (
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
