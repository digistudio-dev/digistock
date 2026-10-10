import { FileDown, HandCoins } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { paymentLabel } from "@/i18n";
import { savePdf } from "@/lib/files";
import { money } from "@/lib/format";
import { customerPaymentPdf } from "@/lib/pdf/documents-pdf";
import { call, toAppError } from "@/lib/tauri";

export async function saveCustomerPaymentReceipt(transactionId: number) {
  try {
    const { base64, filename } = await customerPaymentPdf(transactionId);
    const path = await savePdf(filename, base64);
    if (path) toast.success("Reçu enregistré.", { description: path });
  } catch (e) {
    toast.error("Génération du reçu impossible.", { description: toAppError(e).message });
  }
}

/** Encaissement d'un paiement sur le crédit d'un client, avec reçu PDF. */
export function CustomerPaymentDialog({ open, onOpenChange, customerId, customerName, balance }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: number; customerName: string; balance: number }) {
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [done, setDone] = useState<{ id: number; number: string; balance_after: number } | null>(null);
  const { run, pending } = useAction();

  useEffect(() => {
    if (open) {
      setAmount(null);
      setMethod("cash");
      setNote("");
      setTouched(false);
      setDone(null);
    }
  }, [open]);

  const error = !amount || amount <= 0 ? "Saisissez un montant." : amount > balance + 0.001 ? `Le montant dépasse le solde dû (${money(balance)}).` : undefined;
  const submit = async () => {
    setTouched(true);
    if (error) return;
    const res = await run(() => call<{ id: number; number: string; balance_after: number }>("customer_payment", { customerId, amount, method, note: note || null }), { success: "Paiement enregistré." });
    if (res) setDone(res);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title={done ? "Paiement enregistré" : "Ajouter un paiement"} description={`${customerName} · solde dû ${money(done ? done.balance_after : balance)}`} icon={<HandCoins />}>
        {done ? (
          <>
            <DialogBody>
              <div className="rounded-lg bg-success-soft p-4 text-center">
                <div className="text-[0.75rem] font-semibold uppercase tracking-wide text-success">{done.number}</div>
                <div className="num mt-1 text-[1.5rem] font-bold text-success">{money(amount)}</div>
                <div className="mt-1 text-[0.8125rem] text-muted-foreground">Nouveau solde : {money(done.balance_after)}</div>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => saveCustomerPaymentReceipt(done.id)}>
                <FileDown /> Reçu PDF
              </Button>
              <Button onClick={() => onOpenChange(false)}>Terminer</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="grid grid-cols-2 gap-3">
              <Field label="Montant reçu" required error={touched ? error : undefined} className="col-span-2">
                <MoneyInput autoFocus value={amount} onValueChange={setAmount} allowEmpty inputSize="lg" aria-invalid={touched && !!error} />
              </Field>
              <div className="col-span-2 -mt-1 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setAmount(balance)}>
                  Solde total ({money(balance)})
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAmount(Math.round((balance / 2) * 100) / 100)}>
                  Moitié
                </Button>
              </div>
              <Field label="Mode de paiement" className="col-span-2">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {["cash", "card", "transfer", "other"].map((m) => (
                    <option key={m} value={m}>
                      {paymentLabel(m)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" className="col-span-2">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Annuler
              </Button>
              <Button onClick={submit} loading={pending}>
                Enregistrer le paiement
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
