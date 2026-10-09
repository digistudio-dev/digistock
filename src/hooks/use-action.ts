import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { usePremiumGate } from "@/features/premium/premium-gate";
import { toAppError } from "@/lib/tauri";

/**
 * Exécute une action métier : gestion du chargement, toast de succès/erreur,
 * invalidation du cache (toutes les vues se rafraîchissent). Ne jamais échouer silencieusement.
 */
export function useAction() {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const gate = usePremiumGate();
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, opts: { success?: string; error?: string; errorDetail?: string; invalidate?: boolean } = {}): Promise<T | undefined> => {
      setPending(true);
      try {
        const res = await fn();
        if (opts.invalidate !== false) await qc.invalidateQueries();
        if (opts.success) toast.success(opts.success);
        return res;
      } catch (e) {
        const err = toAppError(e);
        if (err.code === "premium_required") {
          gate.open("general");
        } else if (opts.error) {
          toast.error(opts.error, { description: opts.errorDetail ?? err.message });
        } else {
          toast.error(err.message);
        }
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [qc, gate],
  );
  return { run, pending };
}
