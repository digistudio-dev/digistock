import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { MoneyInput } from "@/components/common/inputs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { paymentLabel } from "@/i18n";
import { money } from "@/lib/format";
import { call } from "@/lib/tauri";

export function SupplierPaymentDialog({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  due,
  purchaseId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  supplierId: number;
  supplierName: string;
  due: number;
  purchaseId?: number | null;
}) {
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const { run, pending } = useAction();
  useEffect(() => {
    if (open) {
      setAmount(due > 0 ? due : null);
      setMethod("cash");
      setReference("");
      setNote("");
      setTouched(false);
    }
  }, [open, due]);
  const invalid = !amount || amount <= 0;
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    const res = await run(
      () => call("supplier_payment", { input: { supplier_id: supplierId, amount, method, purchase_id: purchaseId ?? null, reference: reference || null, note: note || null } }),
      { success: "Paiement fournisseur enregistré." },
    );
    if (res) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Payer le fournisseur" description={`${supplierName} · reste dû ${money(due)}`} icon={<Wallet />}>
        <DialogBody className="grid grid-cols-2 gap-3">
          <Field label="Montant" required error={touched && invalid ? "Montant invalide." : undefined} className="col-span-2">
            <MoneyInput autoFocus value={amount} onValueChange={setAmount} allowEmpty inputSize="lg" />
          </Field>
          <Field label="Mode de paiement">
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              {["cash", "transfer", "cheque", "card", "other"].map((m) => (
                <option key={m} value={m}>
                  {paymentLabel(m)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Référence">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° chèque, virement…" />
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
      </DialogContent>
    </Dialog>
  );
}
