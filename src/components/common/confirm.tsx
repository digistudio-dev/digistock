import { AlertTriangle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/input";

interface ConfirmOptions {
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Demande un motif obligatoire (annulations, ajustements). */
  reason?: { label: string; placeholder?: string };
}

interface ConfirmState {
  open: boolean;
  opts: ConfirmOptions | null;
  resolve: ((v: string | false) => void) | null;
  ask: (o: ConfirmOptions) => Promise<string | false>;
  close: (v: string | false) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  opts: null,
  resolve: null,
  ask: (opts) =>
    new Promise((resolve) => {
      set({ open: true, opts, resolve });
    }),
  close: (v) => {
    get().resolve?.(v);
    set({ open: false, resolve: null });
  },
}));

/**
 * Confirmation des actions sensibles. Retourne le motif saisi (ou "" sans motif) si confirmé, sinon false.
 * Usage : `if ((await confirm({...})) === false) return;`
 */
export const confirm = (o: ConfirmOptions) => useConfirmStore.getState().ask(o);

export function ConfirmHost() {
  const { open, opts, close } = useConfirmStore();
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  if (!opts) return null;
  const needReason = !!opts.reason;
  const invalid = needReason && reason.trim().length < 3;
  const submit = () => {
    setTouched(true);
    if (invalid) return;
    close(reason.trim());
    setReason("");
    setTouched(false);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          close(false);
          setReason("");
          setTouched(false);
        }
      }}
    >
      <DialogContent
        size="sm"
        title={opts.title}
        description={opts.description}
        icon={opts.danger ? <AlertTriangle /> : undefined}
        className={opts.danger ? "[&>div:first-child>div:first-child]:bg-danger-soft [&>div:first-child>div:first-child]:text-danger" : undefined}
      >
        {needReason ? (
          <DialogBody>
            <Field label={opts.reason!.label} required error={touched && invalid ? "Indiquez un motif (3 caractères minimum)." : undefined}>
              <Textarea
                autoFocus
                value={reason}
                placeholder={opts.reason!.placeholder}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
                }}
              />
            </Field>
          </DialogBody>
        ) : (
          <div className="h-3" />
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => close(false)}>
            {opts.cancelLabel ?? "Annuler"}
          </Button>
          <Button variant={opts.danger ? "danger" : "default"} onClick={submit} autoFocus={!needReason}>
            {opts.confirmLabel ?? "Confirmer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
