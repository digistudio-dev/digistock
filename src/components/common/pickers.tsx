import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Check, ChevronsUpDown, Package, ScanBarcode, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { like, select } from "@/lib/db";
import { imageSrc } from "@/lib/files";
import { money, qty } from "@/lib/format";
import { unitShort } from "@/i18n";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------- Sélecteur asynchrone générique
interface PickerProps<T> {
  /** Identifiant de cache (ex. "customer"). */
  kind: string;
  value: number | null | undefined;
  onChange: (item: T | null) => void;
  search: (term: string) => Promise<T[]>;
  load: (id: number) => Promise<T | null>;
  getId: (t: T) => number;
  getLabel: (t: T) => string;
  renderItem?: (t: T) => ReactNode;
  placeholder?: string;
  emptyText?: string;
  clearable?: boolean;
  className?: string;
  invalid?: boolean;
  footer?: ReactNode;
  size?: "sm" | "md";
}

export function AsyncPicker<T>({
  kind,
  value,
  onChange,
  search,
  load,
  getId,
  getLabel,
  renderItem,
  placeholder = "Sélectionner…",
  emptyText = "Aucun résultat.",
  clearable = true,
  className,
  invalid,
  footer,
  size = "md",
}: PickerProps<T>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 150);
    return () => clearTimeout(id);
  }, [term]);
  const { data: selected } = useQuery({ queryKey: ["picker-item", kind, value], queryFn: () => (value ? load(value) : null), enabled: !!value });
  const { data: items = [], isFetching } = useQuery({ queryKey: ["picker", kind, debounced], queryFn: () => search(debounced), enabled: open });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-invalid={invalid}
          className={cn(
            "flex w-full items-center gap-2 rounded-md border border-input bg-surface px-3 text-left text-[0.875rem] transition-colors hover:border-foreground/25 focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 aria-[invalid=true]:border-danger",
            size === "sm" ? "h-8" : "h-9",
            className,
          )}
        >
          <span className={cn("flex-1 truncate", !(value && selected) && "text-muted-foreground/70")}>{value && selected ? getLabel(selected) : placeholder}</span>
          {clearable && value ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-accent"
            >
              <X className="size-3.5" />
            </span>
          ) : (
            <ChevronsUpDown className="size-3.5 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] min-w-[280px]">
        <Command shouldFilter={false} loop>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 text-muted-foreground" />
            <Command.Input value={term} onValueChange={setTerm} placeholder="Rechercher…" className="h-10 flex-1 bg-transparent text-[0.8125rem] outline-none" autoFocus />
          </div>
          <Command.List className="max-h-[280px] overflow-y-auto p-1">
            {!isFetching && <Command.Empty className="px-3 py-6 text-center text-[0.8125rem] text-muted-foreground">{emptyText}</Command.Empty>}
            {items.map((it) => (
              <Command.Item
                key={getId(it)}
                value={String(getId(it))}
                onSelect={() => {
                  onChange(it);
                  setOpen(false);
                  setTerm("");
                }}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[0.8125rem] aria-selected:bg-accent"
              >
                <span className="min-w-0 flex-1">{renderItem ? renderItem(it) : getLabel(it)}</span>
                {getId(it) === value && <Check className="size-4 text-primary" />}
              </Command.Item>
            ))}
          </Command.List>
          {footer && <div className="border-t p-1">{footer}</div>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------- Clients / fournisseurs
export interface PartyOption {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  credit_limit?: number;
  whatsapp?: string | null;
}

export function CustomerPicker(props: { value: number | null | undefined; onChange: (c: PartyOption | null) => void; placeholder?: string; invalid?: boolean; className?: string; footer?: ReactNode }) {
  return (
    <AsyncPicker<PartyOption>
      {...props}
      kind="customer"
      placeholder={props.placeholder ?? "Client de passage"}
      search={(t) =>
        select<PartyOption>(
          "SELECT id, name, phone, whatsapp, balance, credit_limit FROM customers WHERE archived = 0 AND (?1 = '' OR name LIKE ?2 ESCAPE '\\' OR phone LIKE ?2 ESCAPE '\\') ORDER BY name LIMIT 30",
          [t.trim(), like(t)],
        )
      }
      load={async (id) => (await select<PartyOption>("SELECT id, name, phone, whatsapp, balance, credit_limit FROM customers WHERE id = ?", [id]))[0] ?? null}
      getId={(c) => c.id}
      getLabel={(c) => c.name}
      emptyText="Aucun client trouvé."
      renderItem={(c) => (
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{c.name}</span>
          <span className="num shrink-0 text-[0.75rem] text-muted-foreground">{c.balance > 0 ? <span className="text-warning">Crédit {money(c.balance)}</span> : c.phone}</span>
        </span>
      )}
    />
  );
}

export function SupplierPicker(props: { value: number | null | undefined; onChange: (c: PartyOption | null) => void; placeholder?: string; invalid?: boolean; className?: string; clearable?: boolean }) {
  return (
    <AsyncPicker<PartyOption>
      {...props}
      kind="supplier"
      placeholder={props.placeholder ?? "Sélectionner un fournisseur"}
      search={(t) =>
        select<PartyOption>(
          "SELECT id, name, phone, whatsapp, balance FROM suppliers WHERE archived = 0 AND (?1 = '' OR name LIKE ?2 ESCAPE '\\' OR company_name LIKE ?2 ESCAPE '\\') ORDER BY name LIMIT 30",
          [t.trim(), like(t)],
        )
      }
      load={async (id) => (await select<PartyOption>("SELECT id, name, phone, whatsapp, balance FROM suppliers WHERE id = ?", [id]))[0] ?? null}
      getId={(c) => c.id}
      getLabel={(c) => c.name}
      emptyText="Aucun fournisseur trouvé."
    />
  );
}

// ---------------------------------------------------------------- Recherche produit (ajout de lignes)
export interface ProductOption {
  id: number;
  name: string;
  barcode: string | null;
  sku: string | null;
  selling_price: number;
  purchase_price: number;
  tax_rate: number;
  quantity: number;
  minimum_stock: number;
  unit: string;
  image: string | null;
  supplier_id: number | null;
}

const PRODUCT_COLS = "id, name, barcode, sku, selling_price, purchase_price, tax_rate, quantity, minimum_stock, unit, image, supplier_id";

export function searchProducts(term: string, limit = 12) {
  const t = term.trim();
  return select<ProductOption>(
    `SELECT ${PRODUCT_COLS} FROM products WHERE archived = 0 AND (?1 = '' OR name LIKE ?2 ESCAPE '\\' OR barcode = ?1 OR sku LIKE ?2 ESCAPE '\\')
     ORDER BY (barcode = ?1) DESC, (name LIKE ?3 ESCAPE '\\') DESC, name LIMIT ?4`,
    [t, like(t), t.replace(/[%_\\]/g, (m) => "\\" + m) + "%", limit],
  );
}

export async function findByBarcode(code: string) {
  return (await select<ProductOption>(`SELECT ${PRODUCT_COLS} FROM products WHERE archived = 0 AND barcode = ?`, [code]))[0] ?? null;
}

export async function loadProduct(id: number) {
  return (await select<ProductOption>(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`, [id]))[0] ?? null;
}

/** Champ de recherche produit avec liste déroulante ; Entrée sur un code-barres exact ajoute directement. */
export function ProductFinder({
  onPick,
  onNotFound,
  placeholder = "Scanner ou rechercher un produit…",
  showCost,
  autoFocus,
  className,
}: {
  onPick: (p: ProductOption) => void;
  onNotFound?: (code: string) => void;
  placeholder?: string;
  showCost?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(term), 120);
    return () => clearTimeout(id);
  }, [term]);
  const { data: items = [] } = useQuery({ queryKey: ["finder", debounced], queryFn: () => searchProducts(debounced), enabled: open && debounced.trim().length > 0 });

  const pick = (p: ProductOption) => {
    onPick(p);
    setTerm("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const submitExact = async () => {
    const code = term.trim();
    if (!code) return;
    const p = await findByBarcode(code);
    if (p) return pick(p);
    if (items.length === 1) return pick(items[0]);
    if (/^[\x21-\x7E]{4,}$/.test(code) && !items.length) {
      onNotFound?.(code);
      setTerm("");
    }
  };

  return (
    <Popover open={open && term.trim().length > 0} onOpenChange={setOpen}>
      <Command shouldFilter={false} loop className={cn("relative", className)}>
        <PopoverAnchor asChild>
          <div className="relative">
            <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Command.Input
              ref={inputRef}
              autoFocus={autoFocus}
              data-scan-target
              value={term}
              onValueChange={(v) => {
                setTerm(v);
                setOpen(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (!open || items.length === 0 || debounced !== term)) {
                  e.preventDefault();
                  submitExact();
                }
                if (e.key === "Escape") setTerm("");
              }}
              placeholder={placeholder}
              className="h-10 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-[0.875rem] outline-none transition-colors placeholder:text-muted-foreground/70 hover:border-foreground/25 focus:border-primary focus:ring-[3px] focus:ring-primary/15"
            />
          </div>
        </PopoverAnchor>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)]" onOpenAutoFocus={(e) => e.preventDefault()}>
          <Command.List className="max-h-[320px] overflow-y-auto p-1">
            <Command.Empty className="px-3 py-6 text-center text-[0.8125rem] text-muted-foreground">Aucun produit trouvé.</Command.Empty>
            {items.map((p) => (
              <Command.Item key={p.id} value={String(p.id)} onSelect={() => pick(p)} className="flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 text-[0.8125rem] aria-selected:bg-accent">
                <ProductThumb image={p.image} className="size-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-[0.6875rem] text-muted-foreground">{p.barcode ?? p.sku ?? "—"}</span>
                </span>
                <span className="num text-right text-[0.75rem]">
                  <span className="block font-semibold">{money(showCost ? p.purchase_price : p.selling_price)}</span>
                  <span className={cn("block", p.quantity <= 0 ? "text-danger" : "text-muted-foreground")}>
                    {qty(p.quantity)} {unitShort(p.unit)}
                  </span>
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </PopoverContent>
      </Command>
    </Popover>
  );
}

export function ProductThumb({ image, className, name }: { image: string | null | undefined; className?: string; name?: string }) {
  const src = imageSrc(image);
  return (
    <span className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted text-muted-foreground", className)}>
      {src ? <img src={src} alt={name ?? ""} className="size-full object-cover" draggable={false} /> : <Package className="size-[45%]" strokeWidth={1.6} />}
    </span>
  );
}
