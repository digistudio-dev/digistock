import { ShieldOff } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState, Page } from "@/components/common/page";
import type { Permission } from "@/lib/permissions";
import { useCan } from "@/stores/app";

export function RequirePermission({ perm, children }: { perm: Permission | Permission[]; children: ReactNode }) {
  const can = useCan();
  if (can(perm)) return <>{children}</>;
  return (
    <Page>
      <EmptyState
        icon={<ShieldOff />}
        title="Accès restreint"
        description="Votre rôle ne permet pas d'accéder à cette page. Contactez l'administrateur si nécessaire."
      />
    </Page>
  );
}

/** Masque un élément si l'utilisateur n'a pas la permission. */
export function Can({ perm, children, fallback = null }: { perm: Permission | Permission[]; children: ReactNode; fallback?: ReactNode }) {
  const can = useCan();
  return <>{can(perm) ? children : fallback}</>;
}
