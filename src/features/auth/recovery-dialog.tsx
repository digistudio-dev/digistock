import { CheckCircle2, KeyRound, ShieldQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { call, toAppError } from "@/lib/tauri";

type Step = "username" | "answers" | "done";

/** « Mot de passe oublié » : identifiant → 3 questions de sécurité → nouveau mot de passe. */
export function RecoveryDialog({ open, onOpenChange, initialUsername, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; initialUsername?: string; onDone?: (username: string) => void }) {
  const [step, setStep] = useState<Step>("username");
  const [username, setUsername] = useState("");
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setStep("username");
      setUsername(initialUsername ?? "");
      setQuestions([]);
      setAnswers(["", "", ""]);
      setPassword("");
      setConfirm("");
      setError(null);
    }
  }, [open, initialUsername]);

  const loadQuestions = async () => {
    if (!username.trim()) return setError("Saisissez votre identifiant.");
    setLoading(true);
    setError(null);
    try {
      setQuestions(await call<string[]>("auth_recovery_questions", { username }));
      setStep("answers");
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };

  const reset = async () => {
    if (answers.some((a) => !a.trim())) return setError("Répondez aux trois questions.");
    if (password.length < 6) return setError("Le nouveau mot de passe doit contenir au moins 6 caractères.");
    if (password !== confirm) return setError("Les mots de passe ne correspondent pas.");
    setLoading(true);
    setError(null);
    try {
      await call("auth_recovery_reset", { username, answers, newPassword: password });
      setStep("done");
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="md"
        title={step === "done" ? "Mot de passe réinitialisé" : "Mot de passe oublié"}
        description={step === "username" ? "Saisissez votre identifiant pour afficher vos questions de sécurité." : step === "answers" ? "Répondez à vos trois questions, puis choisissez un nouveau mot de passe." : undefined}
        icon={step === "done" ? <CheckCircle2 /> : step === "answers" ? <ShieldQuestion /> : <KeyRound />}
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (step === "username") loadQuestions();
            else if (step === "answers") reset();
          }}
        >
          <DialogBody className="space-y-3.5">
            {step === "username" && (
              <Field label="Identifiant">
                <Input autoFocus value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
              </Field>
            )}
            {step === "answers" && (
              <>
                {questions.map((q, i) => (
                  <Field key={i} label={q}>
                    <Input autoFocus={i === 0} value={answers[i]} autoComplete="off" onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
                  </Field>
                ))}
                <div className="grid grid-cols-2 gap-3 border-t pt-3.5">
                  <Field label="Nouveau mot de passe">
                    <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                  </Field>
                  <Field label="Confirmation">
                    <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
                  </Field>
                </div>
              </>
            )}
            {step === "done" && (
              <div className="rounded-lg bg-success-soft px-4 py-4 text-[0.875rem] text-success">
                Votre mot de passe a été modifié. Vous pouvez maintenant vous connecter avec le nouveau mot de passe. Votre code PIN reste inchangé.
              </div>
            )}
            {error && <div className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2.5 text-[0.8125rem] font-medium text-danger">{error}</div>}
          </DialogBody>
          <DialogFooter>
            {step === "done" ? (
              <Button
                onClick={() => {
                  onDone?.(username);
                  onOpenChange(false);
                }}
              >
                Se connecter
              </Button>
            ) : (
              <>
                <Button variant="secondary" onClick={() => (step === "answers" ? setStep("username") : onOpenChange(false))}>
                  {step === "answers" ? "Retour" : "Annuler"}
                </Button>
                <Button type="submit" loading={loading}>
                  {step === "username" ? "Continuer" : "Réinitialiser le mot de passe"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
