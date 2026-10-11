import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, ShieldAlert, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PinInput } from "@/components/common/pin-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/misc";
import { ChangePasswordDialog } from "@/features/auth/change-password";
import { emptyQuestions, questionErrors, QuestionsForm, type QA } from "@/features/auth/security-questions";
import { call, toAppError } from "@/lib/tauri";
import { SectionCard } from "./sections";

interface SecurityStatus {
  has_pin: boolean;
  pin_locked: boolean;
  questions: string[];
}

export function useSecurityStatus() {
  return useQuery({ queryKey: ["security-status"], queryFn: () => call<SecurityStatus>("auth_security_status") });
}

/** Paramètres › Sécurité : mot de passe, code PIN et questions de sécurité du compte connecté. */
export function SecuritySection() {
  const qc = useQueryClient();
  const { data: status } = useSecurityStatus();
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [qOpen, setQOpen] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["security-status"] });
  const hasQuestions = (status?.questions.length ?? 0) === 3;

  return (
    <div className="space-y-4">
      {status && !hasQuestions && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[0.8125rem]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <span className="font-semibold">Aucune question de sécurité.</span> Sans elles, un mot de passe oublié ne peut pas être récupéré. Configurez-les maintenant.
          </span>
        </div>
      )}
      <SectionCard title="Mot de passe" description="Utilisé pour vous connecter et confirmer les changements de sécurité.">
        <Button variant="secondary" onClick={() => setPwdOpen(true)}>
          <KeyRound /> Changer le mot de passe
        </Button>
      </SectionCard>

      <SectionCard title="Code PIN" description="Un code à 4 chiffres pour vous connecter et déverrouiller DigiStock plus rapidement.">
        <div className="flex flex-wrap items-center gap-3">
          {status?.has_pin ? (
            status.pin_locked ? (
              <Badge tone="danger" dot>
                Bloqué — reconnectez-vous avec le mot de passe
              </Badge>
            ) : (
              <Badge tone="success" dot>
                Activé
              </Badge>
            )
          ) : (
            <Badge dot>Non défini</Badge>
          )}
          <Button variant="secondary" onClick={() => setPinOpen(true)}>
            {status?.has_pin ? "Modifier le code PIN" : "Définir un code PIN"}
          </Button>
        </div>
        <p className="mt-3 text-[0.75rem] text-muted-foreground">Après 5 codes incorrects, le PIN est bloqué jusqu'à la prochaine connexion par mot de passe.</p>
      </SectionCard>

      <SectionCard title="Questions de sécurité" description="Trois questions pour réinitialiser votre mot de passe depuis l'écran de connexion (« Mot de passe oublié ? »).">
        {hasQuestions ? (
          <ul className="mb-4 space-y-1.5">
            {status!.questions.map((q) => (
              <li key={q} className="flex items-center gap-2 text-[0.8125rem]">
                <CheckCircle2 className="size-4 text-success" /> {q}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-4 text-[0.8125rem] text-muted-foreground">Aucune question configurée.</p>
        )}
        <Button variant={hasQuestions ? "secondary" : "default"} onClick={() => setQOpen(true)}>
          <ShieldQuestion /> {hasQuestions ? "Modifier les questions" : "Configurer les questions"}
        </Button>
      </SectionCard>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
      <PinDialog open={pinOpen} onOpenChange={setPinOpen} hasPin={!!status?.has_pin} onSaved={refresh} />
      <QuestionsDialog open={qOpen} onOpenChange={setQOpen} onSaved={refresh} />
    </div>
  );
}

function PinDialog({ open, onOpenChange, hasPin, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; hasPin: boolean; onSaved: () => void }) {
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const reset = () => {
    setPassword("");
    setPin("");
    setConfirmPin("");
    setError(null);
  };
  const save = async (remove = false) => {
    if (!password) return setError("Saisissez votre mot de passe actuel.");
    if (!remove) {
      if (pin.length !== 4) return setError("Le code PIN doit comporter 4 chiffres.");
      if (pin !== confirmPin) return setError("Les deux codes PIN ne correspondent pas.");
    }
    setLoading(true);
    setError(null);
    try {
      await call("auth_set_pin", { currentPassword: password, pin: remove ? null : pin });
      toast.success(remove ? "Code PIN supprimé." : "Code PIN enregistré.");
      onSaved();
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent size="sm" title={hasPin ? "Modifier le code PIN" : "Définir un code PIN"} description="Confirmez avec votre mot de passe." icon={<KeyRound />}>
        <DialogBody className="space-y-4">
          <Field label="Mot de passe actuel">
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <div>
            <div className="mb-2 text-center text-[0.8125rem] font-medium">Nouveau code PIN</div>
            <PinInput value={pin} onChange={setPin} />
          </div>
          <div>
            <div className="mb-2 text-center text-[0.8125rem] font-medium">Confirmer le code PIN</div>
            <PinInput value={confirmPin} onChange={setConfirmPin} />
          </div>
          {error && <div className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[0.8125rem] font-medium text-danger">{error}</div>}
        </DialogBody>
        <DialogFooter className={hasPin ? "justify-between" : undefined}>
          {hasPin && (
            <Button variant="danger-ghost" onClick={() => save(true)} disabled={loading}>
              Supprimer le PIN
            </Button>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button onClick={() => save()} loading={loading}>
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function QuestionsDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const [password, setPassword] = useState("");
  const [questions, setQuestions] = useState<QA[]>(emptyQuestions);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const save = async () => {
    setTouched(true);
    if (!password) return setError("Saisissez votre mot de passe actuel.");
    if (questionErrors(questions).some(Boolean)) return setError("Vérifiez les questions et les réponses.");
    setLoading(true);
    setError(null);
    try {
      await call("auth_set_questions", { currentPassword: password, questions });
      toast.success("Questions de sécurité enregistrées.");
      onSaved();
      onOpenChange(false);
      setPassword("");
      setQuestions(emptyQuestions());
      setTouched(false);
    } catch (e) {
      setError(toAppError(e).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Questions de sécurité" description="Elles remplacent les questions précédentes." icon={<ShieldQuestion />}>
        <DialogBody className="space-y-4">
          <Field label="Mot de passe actuel">
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} className="max-w-xs" />
          </Field>
          <QuestionsForm value={questions} onChange={setQuestions} showErrors={touched} />
          {error && <div className="rounded-md border border-danger/25 bg-danger-soft px-3 py-2 text-[0.8125rem] font-medium text-danger">{error}</div>}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={save} loading={loading}>
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
