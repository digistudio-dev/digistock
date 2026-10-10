import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import type { Session } from "@/types";
import { AuthLayout, BrandAside } from "./auth-layout";

const schema = z.object({
  username: z.string().trim().min(1, "Saisissez votre identifiant."),
  password: z.string().min(1, "Saisissez votre mot de passe."),
});

export function LoginScreen() {
  const company = useApp((s) => s.bootstrap?.company);
  const version = useApp((s) => s.bootstrap?.version);
  const setSession = useApp((s) => s.setSession);
  const loadContext = useApp((s) => s.loadContext);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { username: "", password: "" } });

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const s = await call<Session>("auth_login", v);
      window.location.hash = "#/";
      await loadContext();
      setSession(s);
    } catch (e) {
      setError(toAppError(e).message);
      form.setValue("password", "");
      form.setFocus("password");
    }
  });

  return (
    <AuthLayout aside={<BrandAside />}>
      <div className="m-auto w-full max-w-[380px] px-6 py-10">
        <div className="mb-8">
          <p className="eyebrow mb-2">{company?.name ?? "DigiStock"}</p>
          <h1 className="text-[1.625rem] font-semibold">Connexion</h1>
          <p className="mt-1.5 text-[0.875rem] text-muted-foreground">Bienvenue. Connectez-vous pour accéder à votre espace.</p>
        </div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <Field label="Identifiant" error={form.formState.errors.username?.message}>
            <Input inputSize="lg" autoFocus autoComplete="username" {...form.register("username")} aria-invalid={!!form.formState.errors.username} />
          </Field>
          <Field label="Mot de passe" error={form.formState.errors.password?.message}>
            <Input
              inputSize="lg"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              {...form.register("password")}
              aria-invalid={!!form.formState.errors.password}
              trailing={
                <button type="button" className="pointer-events-auto rounded p-1 hover:bg-accent" onClick={() => setShow(!show)} aria-label="Afficher le mot de passe">
                  {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              }
            />
          </Field>
          {error && <div className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[0.8125rem] font-medium text-danger">{error}</div>}
          <Button type="submit" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            <LogIn /> Se connecter
          </Button>
        </form>
        <p className="mt-10 text-center text-[0.75rem] text-muted-foreground">
          DigiStock {version} · DigiStock par DigiStudio
        </p>
      </div>
    </AuthLayout>
  );
}
