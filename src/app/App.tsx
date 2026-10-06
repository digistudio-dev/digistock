import { useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { AppMark } from "@/components/common/brand";
import { LoginScreen } from "@/features/auth/login";
import { Onboarding } from "@/features/auth/onboarding";
import { toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import { useUi } from "@/stores/ui";
import { router } from "./router";

export function App() {
  const { ready, bootstrap, session, init } = useApp();
  const theme = useUi((s) => s.theme);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    init().catch((e) => setError(toAppError(e).message));
  }, [init]);

  let content;
  if (error) {
    content = (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-8 text-center">
        <AppMark className="size-12" />
        <h1 className="text-lg font-semibold">DigiStock n'a pas pu démarrer</h1>
        <p className="max-w-md text-sm text-muted-foreground">{error}</p>
        <Button variant="secondary" onClick={() => location.reload()}>
          Réessayer
        </Button>
      </div>
    );
  } else if (!ready || !bootstrap) {
    content = (
      <div className="flex h-screen items-center justify-center">
        <AppMark className="size-11 animate-pulse" />
      </div>
    );
  } else if (!bootstrap.setup_done) {
    content = <Onboarding />;
  } else if (!session) {
    content = <LoginScreen />;
  } else {
    content = <RouterProvider router={router} future={{ v7_startTransition: true }} />;
  }

  return (
    <TooltipProvider delayDuration={350}>
      {content}
      <Toaster
        position="top-center"
        offset={64}
        theme={theme}
        closeButton
        toastOptions={{
          classNames: {
            toast: "!rounded-lg !border !border-border !bg-popover !text-popover-foreground !shadow-pop !text-[0.8125rem]",
            description: "!text-muted-foreground",
          },
        }}
      />
    </TooltipProvider>
  );
}
