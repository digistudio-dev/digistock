import { Eye, EyeOff, KeyRound, LogIn } from "lucide-react";
import { useState } from "react";
import { PinInput } from "@/components/common/pin-input";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/misc";
import { call, toAppError } from "@/lib/tauri";
import { useApp } from "@/stores/app";
import type { Session } from "@/types";
import { AuthLayout, BrandAside } from "./auth-layout";
import { RecoveryDialog } from "./recovery-dialog";

const LAST_USER = "digistock.lastUser";
const LAST_MODE = "digistock.loginMode";

function remembered(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible */
  }
}

export function LoginScreen() {
  const company = useApp((s) => s.bootstrap?.company);
  const version = useApp((s) => s.bootstrap?.version);
  const setSession = useApp((s) => s.setSession);
  const loadContext = useApp((s) => s.loadContext);
  const [mode, setMode] = useState<"password" | "pin">(() => (remembered(LAST_MODE, "password") === "pin" ? "pin" : "password"));
  const [username, setUsername] = useState(() => remembered(LAST_USER, ""));
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recovery, setRecovery] = useState(false);

  const finish = async (s: Session) => {
    remember(LAST_USER, username.trim());
    remember(LAST_MODE, mode);
    window.location.hash = "#/";
    await loadContext();
    setSession(s);
  };

  const submit = async (pinValue?: string) => {
    if (loading) return;
    setError(null);
    if (!username.trim()) return setError("Saisissez votre identifiant.");
    const usingPin = mode === "pin";
    const secret = usingPin ? pinValue ?? pin : password;
    if (usingPin ? secret.length !== 4 : !secret) return setError(usingPin ? "Saisissez votre code PIN à 4 chiffres." : "Saisissez votre mot de passe.");
    setLoading(true);
    try {
      const s = usingPin ? await call<Session>("auth_login_pin", { username, pin: secret }) : await call<Session>("auth_login", { username, password: secret });
      await finish(s);
    } catch (e) {
      setError(toAppError(e).message);
      setPassword("");
      setPin("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout aside={<BrandAside />}>
      <div className="m-auto w-full max-w-[380px] px-6 py-10">
        <div className="mb-7">
          <p className="eyebrow mb-2">{company?.name ?? "DigiStock"}</p>
          <h1 className="text-[1.625rem] font-semibold">Connexion</h1>
          <p className="mt-1.5 text-[0.875rem] text-muted-foreground">Bienvenue. Connectez-vous pour accéder à votre espace.</p>
        </div>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as "password" | "pin");
              setError(null);
            }}
          >
            <TabsList className="w-full [&>button]:flex-1 [&>button]:justify-center">
              <TabsTrigger value="password">Mot de passe</TabsTrigger>
              <TabsTrigger value="pin">Code PIN</TabsTrigger>
            </TabsList>
          </Tabs>
          <Field label="Identifiant">
            <Input inputSize="lg" autoFocus={!username} autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          </Field>
          {mode === "password" ? (
            <Field label="Mot de passe">
              <Input
                inputSize="lg"
                autoFocus={!!username}
                type={show ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                trailing={
                  <button type="button" className="pointer-events-auto rounded p-1 hover:bg-accent" onClick={() => setShow(!show)} aria-label="Afficher le mot de passe">
                    {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                }
              />
            </Field>
          ) : (
            <Field label="Code PIN">
              <div className="py-1">
                <PinInput value={pin} onChange={setPin} onComplete={(v) => submit(v)} autoFocus={!!username} invalid={!!error} disabled={loading} />
              </div>
            </Field>
          )}
          {error && <div className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[0.8125rem] font-medium text-danger">{error}</div>}
          <Button type="submit" size="lg" className="w-full" loading={loading}>
            <LogIn /> Se connecter
          </Button>
          <button type="button" onClick={() => setRecovery(true)} className="mx-auto flex items-center gap-1.5 text-[0.8125rem] font-medium text-primary hover:underline">
            <KeyRound className="size-3.5" /> Mot de passe oublié ?
          </button>
        </form>
        <p className="mt-10 text-center text-[0.75rem] text-muted-foreground">
          DigiStock {version} · DigiStock par DigiStudio
        </p>
      </div>
      <RecoveryDialog
        open={recovery}
        onOpenChange={setRecovery}
        initialUsername={username}
        onDone={(u) => {
          setUsername(u);
          setMode("password");
          setError(null);
        }}
      />
    </AuthLayout>
  );
}
