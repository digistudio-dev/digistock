import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { PackageSearch, ScanBarcode, X } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";
import { ProductThumb } from "@/components/common/pickers";
import { Skeleton } from "@/components/ui/misc";
import { unitShort } from "@/i18n";
import { like, select } from "@/lib/db";
import { money, qty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductLike } from "./pos-store";

export interface PosProduct extends ProductLike {
  stock: number;
  minimum_stock: number;
  category_color: string | null;
  sku: string | null;
}

export function usePosCategories() {
  return useQuery({
    queryKey: ["pos", "categories"],
    queryFn: () =>
      select<{ id: number; name: string; color: string | null; n: number }>(
        "SELECT c.id, c.name, c.color, COUNT(p.id) AS n FROM categories c JOIN products p ON p.category_id = c.id AND p.archived = 0 WHERE c.archived = 0 GROUP BY c.id ORDER BY c.name",
      ),
  });
}

export function usePosProducts(term: string, categoryId: number | null, warehouseId: number) {
  const t = term.trim();
  return useQuery({
    queryKey: ["pos", "products", t, categoryId, warehouseId],
    placeholderData: keepPreviousData,
    queryFn: () =>
      select<PosProduct>(
        `SELECT p.id, p.name, p.barcode, p.sku, p.unit, p.image, p.selling_price, p.tax_rate, p.minimum_stock, c.color AS category_color,
                COALESCE(ws.quantity, 0) AS stock
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN warehouse_stock ws ON ws.product_id = p.id AND ws.warehouse_id = ?4
         LEFT JOIN (SELECT si.product_id, SUM(si.quantity) AS sold FROM sale_items si JOIN sales s ON s.id = si.sale_id
                    WHERE s.status = 'completed' AND s.created_at >= date('now','localtime','-60 days') GROUP BY si.product_id) pop ON pop.product_id = p.id
         WHERE p.archived = 0 AND (?1 IS NULL OR p.category_id = ?1)
           AND (?2 = '' OR p.name LIKE ?3 ESCAPE '\\' OR p.barcode = ?2 OR p.sku LIKE ?3 ESCAPE '\\')
         ORDER BY (p.barcode = ?2) DESC, ${t ? "p.name" : "COALESCE(pop.sold, 0) DESC, p.name"}
         LIMIT 120`,
        [categoryId, t, like(t), warehouseId],
      ),
  });
}

interface Props {
  term: string;
  setTerm: (v: string) => void;
  categoryId: number | null;
  setCategoryId: (v: number | null) => void;
  warehouseId: number;
  onAdd: (p: PosProduct) => void;
  onSubmitSearch: () => void;
  multiplier: number | null;
}

export const PosProducts = forwardRef<HTMLInputElement, Props>(function PosProducts({ term, setTerm, categoryId, setCategoryId, warehouseId, onAdd, onSubmitSearch, multiplier }, ref) {
  const [debounced, setDebounced] = useState(term);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 120);
    return () => clearTimeout(id);
  }, [term]);
  const searchTerm = /^\d+(?:[.,]\d+)?\*$/.test(debounced.trim()) ? "" : debounced;
  const { data: categories = [] } = usePosCategories();
  const { data: products = [], isLoading } = usePosProducts(searchTerm, categoryId, warehouseId);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="border-b bg-surface px-5 pb-3 pt-4">
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-primary" />
          <input
            ref={ref}
            autoFocus
            data-scan-target
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmitSearch();
              }
              if (e.key === "Escape" && term) {
                e.stopPropagation();
                setTerm("");
              }
            }}
            placeholder="Scannez un code-barres ou recherchez un produit…"
            className="h-12 w-full rounded-lg border-2 border-input bg-background pl-12 pr-28 text-[0.9375rem] font-medium outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/70 focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/10"
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {multiplier && <span className="num rounded-md bg-primary px-2 py-0.5 text-[0.75rem] font-bold text-white">× {qty(multiplier)}</span>}
            {term ? (
              <button onClick={() => setTerm("")} className="rounded p-1 text-muted-foreground hover:bg-accent" aria-label="Effacer">
                <X className="size-4" />
              </button>
            ) : (
              <span className="kbd">3* = qté</span>
            )}
          </div>
        </div>
        <div className="-mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
          <CategoryChip active={categoryId === null} onClick={() => setCategoryId(null)}>
            Tous
          </CategoryChip>
          {categories.map((c) => (
            <CategoryChip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)} color={c.color}>
              {c.name}
              <span className="num opacity-50">{c.n}</span>
            </CategoryChip>
          ))}
        </div>
      </div>
      <div className="scroll-area min-h-0 flex-1 p-4">
        {isLoading ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {Array.from({ length: 18 }).map((_, i) => (
              <Skeleton key={i} className="h-[148px] rounded-lg" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <PackageSearch className="mb-3 size-8 opacity-60" />
            <div className="text-[0.875rem] font-medium text-foreground">Aucun produit trouvé</div>
            <div className="mt-1 text-[0.8125rem]">Essayez un autre nom ou scannez le code-barres.</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
            {products.map((p) => {
              const out = p.stock <= 0;
              const low = !out && p.minimum_stock > 0 && p.stock <= p.minimum_stock;
              return (
                <button
                  key={p.id}
                  onClick={() => onAdd(p)}
                  className="group flex flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-card transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md active:translate-y-0 active:scale-[0.99]"
                >
                  <div className="relative flex h-[72px] items-center justify-center border-b bg-subtle">
                    {p.image ? (
                      <ProductThumb image={p.image} className="size-full rounded-none border-0" />
                    ) : (
                      <span className="text-[1.375rem] font-bold tracking-tight" style={{ color: p.category_color ?? "hsl(var(--muted-foreground) / 0.5)" }}>
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    <span
                      className={cn(
                        "num absolute right-1.5 top-1.5 rounded px-1.5 py-px text-[0.625rem] font-semibold",
                        out ? "bg-danger text-white" : low ? "bg-warning-soft text-warning" : "bg-surface/90 text-muted-foreground ring-1 ring-border",
                      )}
                    >
                      {out ? "Rupture" : `${qty(p.stock)} ${unitShort(p.unit)}`}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col justify-between gap-1 p-2.5">
                    <div className="line-clamp-2 text-[0.8125rem] font-medium leading-snug">{p.name}</div>
                    <div className="num text-[0.9375rem] font-bold text-foreground group-hover:text-primary">{money(p.selling_price)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

function CategoryChip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string | null }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-medium transition-colors",
        active ? "border-primary bg-primary text-white" : "bg-surface text-foreground/80 hover:border-foreground/25",
      )}
    >
      {color && !active && <span className="size-2 rounded-full" style={{ background: color }} />}
      {children}
    </button>
  );
}
