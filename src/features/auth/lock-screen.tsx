import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { AppMark } from "@/components/common/brand";
import { PinInput } from "@/components/common/pin-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call, toAppError } from "@/lib/tauri";
import { initials } from "@/lib/utils";
import { useApp } from "@/stores/app";

interface SecurityStatus {
  has_pin: boolean;
  pin_locked: boolean;
  questions: string[];
}

/** Verrouillage de l'application : la session reste ouverte, l'écran est masqué. */
export function LockScreen() {
  const session = useApp((s) => s.session);
  const unlock = useApp((s) => s.unlock);
  const logout = useApp((s) => s.logout);
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [usePin, setUsePin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { data: status } = useQuery({ queryKey: ["security-status", "lock"], queryFn: () => call<SecurityStatus>("auth_security_status"), gcTime: 0 });
  const pinAvailable = !!status?.has_pin && !status.pin_locked;

  useEffect(() => {
    if (pinAvailable) setUsePin(true);
  }, [pinAvailable]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (await call<boolean>("auth_unlock", { password })) unlock();
      else {
        setError("Mot de passe incorrect.");
        setPassword("");
      }
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  };

  const submitPin = async (value: string) => {
    setLoading(true);
    setError(null);
    try {
      await call("auth_unlock_pin", { pin: value });
      unlock();
    } catch (err) {
      const message = toAppError(err).message;
      setError(message);
      setPin("");
      if (message.includes("bloqué")) setUsePin(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(222_47%_6%)]">
      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[480px] -translate-x-1/2 rounded-full bg-[hsl(221_70%_55%/0.18)] blur-[110px]" />
      <form onSubmit={submitPassword} className="relative w-[340px] text-center text-white">
        <AppMark className="mx-auto mb-8 size-10 opacity-90" />
        <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-white/10 text-xl font-semibold ring-1 ring-white/15">{initials(session?.name ?? "")}</div>
        <div className="text-[1.0625rem] font-semibold">{session?.name}</div>
        <div className="mb-6 mt-1 flex items-center justify-center gap-1.5 text-[0.8125rem] text-white/55">
          <Lock className="size-3.5" /> Application verrouillée
        </div>
        {usePin ? (
          <>
            <PinInput dark autoFocus value={pin} onChange={setPin} onComplete={submitPin} invalid={!!error} disabled={loading} />
            <p className="mt-3 text-[0.8125rem] text-white/55">Saisissez votre code PIN</p>
          </>
        ) : (
          <>
            <Input
              autoFocus
              type="password"
              inputSize="lg"
              placeholder="Mot de passe"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border-white/15 bg-white/[0.06] text-white"
              aria-invalid={!!error}
            />
            <Button type="submit" size="lg" className="mt-4 w-full" loading={loading} disabled={!password}>
              Déverrouiller
            </Button>
          </>
        )}
        {error && <p className="mt-3 text-[0.8125rem] text-[hsl(0_80%_72%)]">{error}</p>}
        <div className="mt-5 flex flex-col items-center gap-2 text-[0.8125rem]">
          {pinAvailable && (
            <button
              type="button"
              onClick={() => {
                setUsePin(!usePin);
                setError(null);
              }}
              className="text-white/70 hover:text-white"
            >
              {usePin ? "Utiliser le mot de passe" : "Utiliser le code PIN"}
            </button>
          )}
          <button type="button" onClick={() => logout()} className="text-white/55 hover:text-white">
            Changer d'utilisateur
          </button>
        </div>
      </form>
    </div>
  );
}
