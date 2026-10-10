import { Lock } from "lucide-react";
import { useState } from "react";
import { AppMark } from "@/components/common/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { call, toAppError } from "@/lib/tauri";
import { initials } from "@/lib/utils";
import { useApp } from "@/stores/app";

/** Verrouillage de l'application : la session reste ouverte, l'écran est masqué. */
export function LockScreen() {
  const session = useApp((s) => s.session);
  const unlock = useApp((s) => s.unlock);
  const logout = useApp((s) => s.logout);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const ok = await call<boolean>("auth_unlock", { password });
      if (ok) unlock();
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[hsl(222_47%_6%)]">
      <div className="pointer-events-none absolute left-1/2 top-1/3 size-[480px] -translate-x-1/2 rounded-full bg-[hsl(221_70%_55%/0.18)] blur-[110px]" />
      <form onSubmit={submit} className="relative w-[340px] text-center text-white">
        <AppMark className="mx-auto mb-8 size-10 opacity-90" />
        <div className="mx-auto mb-3 flex size-16 items-center justify-center rounded-full bg-white/10 text-xl font-semibold ring-1 ring-white/15">{initials(session?.name ?? "")}</div>
        <div className="text-[1.0625rem] font-semibold">{session?.name}</div>
        <div className="mb-6 mt-1 flex items-center justify-center gap-1.5 text-[0.8125rem] text-white/55">
          <Lock className="size-3.5" /> Application verrouillée
        </div>
        <Input
          autoFocus
          type="password"
          inputSize="lg"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="[&_input]:border-white/15 [&_input]:bg-white/[0.06] [&_input]:text-white"
          aria-invalid={!!error}
        />
        {error && <p className="mt-2 text-[0.8125rem] text-[hsl(0_80%_72%)]">{error}</p>}
        <Button type="submit" size="lg" className="mt-4 w-full" loading={loading} disabled={!password}>
          Déverrouiller
        </Button>
        <button type="button" onClick={() => logout()} className="mt-5 text-[0.8125rem] text-white/55 hover:text-white">
          Changer d'utilisateur
        </button>
      </form>
    </div>
  );
}
