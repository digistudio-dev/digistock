import { Banknote, CreditCard, Landmark, Minus, MoreHorizontal, Plus, ShoppingCart, Trash2, UserRound, Wallet, X } from "lucide-react";
import { useState } from "react";
import { MoneyInput, NumberInput } from "@/components/common/inputs";
import { CustomerPicker, type PartyOption } from "@/components/common/pickers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/menu";
import { unitShort } from "@/i18n";
import { parseDiscount, type Totals } from "@/lib/calc";
import { money, qty } from "@/lib/format";
import { cn, round2 } from "@/lib/utils";
import { useSettings } from "@/stores/app";
import { usePos, type CartLine, type PaymentMethod } from "./pos-store";

const METHODS: { value: PaymentMethod; label: string; icon: typeof Banknote; key: string }[] = [
  { value: "cash", label: "Espèces", icon: Banknote, key: "F6" },
  { value: "card", label: "Carte", icon: CreditCard, key: "F7" },
  { value: "transfer", label: "Virement", icon: Landmark, key: "" },
  { value: "credit", label: "Crédit", icon: Wallet, key: "F8" },
  { value: "other", label: "Autre", icon: MoreHorizontal, key: "" },
];

function LineRow({ line, allowNegative }: { line: CartLine; allowNegative: boolean }) {
  const { inc, setQty, setPrice, setLineDiscount, remove } = usePos.getState();
  const flash = usePos((s) => (s.flash?.productId === line.productId ? s.flash.n : 0));
  const settings = useSettings();
  const [discountText, setDiscountText] = useState("");
  const total = round2(line.quantity * line.unitPrice - line.discount);
  const overStock = !allowNegative && line.quantity > line.stock;
  return (
    <div key={flash} className={cn("group border-b px-4 py-2.5 last:border-b-0", flash ? "animate-flash" : "")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[0.8125rem] font-semibold leading-tight">{line.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-muted-foreground">
            {settings["sales.allow_price_edit"] ? (
              <Popover>
                <PopoverTrigger asChild>
                  <button className={cn("num rounded px-1 -mx-1 hover:bg-accent hover:text-foreground", line.unitPrice !== line.originalPrice && "font-semibold text-warning")}>{money(line.unitPrice)}</button>
                </PopoverTrigger>
                <PopoverContent className="w-64 p-3">
                  <div className="mb-2 text-[0.75rem] font-semibold">Prix unitaire</div>
                  <MoneyInput autoFocus value={line.unitPrice} onValueChange={(v) => v !== null && setPrice(line.productId, v)} />
                  <div className="mb-2 mt-3 text-[0.75rem] font-semibold">Remise sur la ligne</div>
                  <Input
                    value={discountText}
                    placeholder={line.discount ? money(line.discount) : "Ex. 5 ou 10%"}
                    onChange={(e) => setDiscountText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setLineDiscount(line.productId, parseDiscount(discountText, line.quantity * line.unitPrice));
                        setDiscountText("");
                      }
                    }}
                    onBlur={() => {
                      if (discountText) setLineDiscount(line.productId, parseDiscount(discountText, line.quantity * line.unitPrice));
                      setDiscountText("");
                    }}
                  />
                  {line.unitPrice !== line.originalPrice && (
                    <button className="mt-2 text-[0.75rem] text-primary hover:underline" onClick={() => setPrice(line.productId, line.originalPrice)}>
                      Rétablir le prix ({money(line.originalPrice)})
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            ) : (
              <span className="num">{money(line.unitPrice)}</span>
            )}
            <span>/ {unitShort(line.unit)}</span>
            {line.discount > 0 && <span className="num rounded bg-success-soft px-1 font-medium text-success">−{money(line.discount)}</span>}
            {overStock && <span className="font-medium text-danger">Stock : {qty(line.stock)}</span>}
          </div>
        </div>
        <div className="num w-[86px] shrink-0 text-right text-[0.875rem] font-bold">{money(total)}</div>
        <button onClick={() => remove(line.productId)} className="-mr-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-danger-soft hover:text-danger group-hover:opacity-100" aria-label="Retirer">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <button onClick={() => inc(line.productId, -1)} className="flex size-7 items-center justify-center rounded-md border bg-surface text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Diminuer">
          <Minus className="size-3.5" />
        </button>
        <NumberInput
          value={line.quantity}
          onValueChange={(v) => v !== null && v > 0 && setQty(line.productId, v)}
          decimals={3}
          inputSize="sm"
          className={cn("w-[64px] [&_input]:h-7 [&_input]:px-1.5 [&_input]:text-center", overStock && "[&_input]:border-danger [&_input]:text-danger")}
          aria-label="Quantité"
        />
        <button onClick={() => inc(line.productId, 1)} className="flex size-7 items-center justify-center rounded-md border bg-surface text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Augmenter">
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

export function PosCart({ totals, onValidate, submitting, customer, setCustomer }: { totals: Totals; onValidate: () => void; submitting: boolean; customer: PartyOption | null; setCustomer: (c: PartyOption | null) => void }) {
  const lines = usePos((s) => s.lines);
  const method = usePos((s) => s.method);
  const received = usePos((s) => s.received);
  const paidNow = usePos((s) => s.paidNow);
  const discount = usePos((s) => s.discount);
  const set = usePos((s) => s.set);
  const clear = usePos((s) => s.clear);
  const settings = useSettings();
  const [discountText, setDiscountText] = useState("");
  const allowNegative = settings["stock.allow_negative"];
  const itemsCount = lines.reduce((s, l) => s + l.quantity, 0);
  const change = method === "cash" && received ? round2(received - totals.total) : 0;
  const remaining = method === "credit" ? round2(totals.total - (paidNow ?? 0)) : 0;
  const quick = Array.from(new Set([Math.ceil(totals.total), Math.ceil(totals.total / 50) * 50, Math.ceil(totals.total / 100) * 100, Math.ceil(totals.total / 200) * 200])).filter((v) => v > 0).slice(0, 4);

  return (
    <aside className="flex w-[420px] shrink-0 flex-col border-l bg-surface xl:w-[460px]">
      <div className="flex h-[52px] items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <ShoppingCart className="size-[18px] text-primary" />
          <span className="text-[0.9375rem] font-semibold">Panier</span>
          {lines.length > 0 && (
            <span className="num rounded-full bg-primary-soft px-2 py-0.5 text-[0.6875rem] font-bold text-primary">
              {qty(itemsCount)} article{itemsCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        {lines.length > 0 && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clear}>
            <Trash2 /> Vider
          </Button>
        )}
      </div>
      <div className="border-b px-4 py-2.5">
        <CustomerPicker
          value={customer?.id ?? null}
          onChange={(c) => {
            setCustomer(c);
            set({ customerId: c?.id ?? null });
          }}
          placeholder="Client de passage"
        />
        {customer && customer.balance > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-warning">
            <UserRound className="size-3.5" /> Crédit en cours : <span className="num font-semibold">{money(customer.balance)}</span>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <ShoppingCart className="size-6" />
            </div>
            <div className="text-[0.875rem] font-semibold">Le panier est vide</div>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">Scannez un article ou touchez un produit pour l'ajouter.</p>
          </div>
        ) : (
          [...lines].reverse().map((l) => <LineRow key={l.productId} line={l} allowNegative={allowNegative} />)
        )}
      </div>
      <div className="border-t bg-subtle px-4 pb-4 pt-3">
        <div className="space-y-1 text-[0.8125rem]">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Sous-total</span>
            <span className="num font-medium">{money(totals.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Remise</span>
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("num rounded px-1 -mr-1 font-medium hover:bg-accent", totals.discountTotal > 0 && "text-success")} disabled={!lines.length}>
                  {totals.discountTotal > 0 ? `−${money(totals.discountTotal)}` : "Ajouter"}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <div className="mb-2 text-[0.75rem] font-semibold">Remise globale</div>
                <Input
                  autoFocus
                  value={discountText}
                  placeholder={discount ? money(discount) : "Ex. 20 ou 10%"}
                  onChange={(e) => setDiscountText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      set({ discount: parseDiscount(discountText, totals.subtotal) });
                      setDiscountText("");
                    }
                  }}
                />
                <div className="mt-2 flex gap-1.5">
                  {[5, 10, 15].map((p) => (
                    <Button key={p} size="sm" variant="secondary" onClick={() => set({ discount: parseDiscount(`${p}%`, totals.subtotal) })}>
                      {p} %
                    </Button>
                  ))}
                  {discount > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => set({ discount: 0 })}>
                      Retirer
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">TVA{settings["sales.prices_include_tax"] ? " (incluse)" : ""}</span>
            <span className="num font-medium">{money(totals.taxTotal)}</span>
          </div>
        </div>
        <div className="mt-2.5 flex items-baseline justify-between border-t pt-2.5">
          <span className="text-[0.9375rem] font-semibold">Total</span>
          <span className="num text-[1.875rem] font-bold leading-none tracking-tight">{money(totals.total)}</span>
        </div>

        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {METHODS.map((m) => (
            <Tooltip key={m.value} content={m.key ? `${m.label} (${m.key})` : m.label}>
              <button
                onClick={() => set({ method: m.value })}
                className={cn(
                  "flex h-[52px] flex-col items-center justify-center gap-1 rounded-lg border bg-surface text-[0.6875rem] font-semibold transition-colors",
                  method === m.value ? "border-primary bg-primary-soft text-primary ring-2 ring-primary/15" : "text-muted-foreground hover:border-foreground/25 hover:text-foreground",
                )}
              >
                <m.icon className="size-[18px]" />
                {m.label}
              </button>
            </Tooltip>
          ))}
        </div>

        {method === "cash" && lines.length > 0 && (
          <div className="mt-2.5 rounded-lg border bg-surface p-2.5">
            <div className="flex items-center gap-2">
              <span className="w-[92px] shrink-0 text-[0.75rem] font-medium text-muted-foreground">Montant reçu</span>
              <MoneyInput id="pos-received" value={received} allowEmpty onValueChange={(v) => set({ received: v })} inputSize="sm" placeholder={money(totals.total, false)} />
            </div>
            <div className="mt-2 flex gap-1.5">
              {quick.map((v) => (
                <button key={v} onClick={() => set({ received: v })} className="num flex-1 rounded-md border bg-subtle py-1 text-[0.75rem] font-semibold hover:border-primary/40">
                  {v}
                </button>
              ))}
            </div>
            {received !== null && received > 0 && (
              <div className={cn("mt-2 flex justify-between text-[0.875rem] font-semibold", change < 0 ? "text-danger" : "text-success")}>
                <span>{change < 0 ? "Montant insuffisant" : "Monnaie à rendre"}</span>
                <span className="num">{money(Math.abs(change))}</span>
              </div>
            )}
          </div>
        )}
        {method === "credit" && lines.length > 0 && (
          <div className="mt-2.5 rounded-lg border bg-surface p-2.5">
            {!customer ? (
              <p className="text-[0.75rem] font-medium text-warning">Sélectionnez un client pour une vente à crédit.</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-[92px] shrink-0 text-[0.75rem] font-medium text-muted-foreground">Acompte versé</span>
                  <MoneyInput value={paidNow} allowEmpty onValueChange={(v) => set({ paidNow: v })} inputSize="sm" placeholder="0,00" />
                </div>
                <div className="mt-2 flex justify-between text-[0.8125rem]">
                  <span className="text-muted-foreground">Ajouté au crédit</span>
                  <span className="num font-semibold text-warning">{money(remaining)}</span>
                </div>
                {customer.credit_limit ? (
                  <div className="mt-0.5 flex justify-between text-[0.75rem] text-muted-foreground">
                    <span>Plafond</span>
                    <span className={cn("num", customer.balance + remaining > customer.credit_limit && "font-semibold text-danger")}>
                      {money(customer.balance + remaining)} / {money(customer.credit_limit)}
                    </span>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        <Button size="xl" className="mt-3 w-full text-[1rem] tracking-wide" onClick={onValidate} loading={submitting} disabled={!lines.length}>
          VALIDER LA VENTE
          <span className="ml-1 rounded bg-white/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold">F9</span>
        </Button>
      </div>
    </aside>
  );
}
