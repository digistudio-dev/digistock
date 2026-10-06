import { AlertTriangle, RotateCcw } from "lucide-react";
import { useNavigate, useRouteError } from "react-router-dom";
import { Page } from "@/components/common/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";

/** Écran d'erreur d'une page : le reste de l'application reste utilisable. */
export function RouteError() {
  const error = useRouteError();
  const navigate = useNavigate();
  const message = error instanceof Error ? error.message : "Une erreur inattendue s'est produite.";
  console.error(error);
  return (
    <Page>
      <Card className="mx-auto mt-10 max-w-lg p-8 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-danger-soft text-danger">
          <AlertTriangle className="size-5" />
        </div>
        <h2 className="text-[1.0625rem] font-semibold">Cette page a rencontré un problème</h2>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">Vos données sont intactes. Vous pouvez réessayer ou revenir au tableau de bord.</p>
        <p className="mt-3 rounded-md bg-subtle px-3 py-2 font-mono text-[0.75rem] text-muted-foreground">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => navigate("/")}>
            Tableau de bord
          </Button>
          <Button onClick={() => location.reload()}>
            <RotateCcw /> Réessayer
          </Button>
        </div>
      </Card>
    </Page>
  );
}
