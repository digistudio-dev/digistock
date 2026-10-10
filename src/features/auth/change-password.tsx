import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound } from "lucide-react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { call, toAppError } from "@/lib/tauri";

const schema = z
  .object({
    current: z.string().min(1, "Saisissez votre mot de passe actuel."),
    next: z.string().min(6, "6 caractères minimum."),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Les mots de passe ne correspondent pas." });

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current: "", next: "", confirm: "" } });
  const { errors, isSubmitting } = form.formState;
  const submit = form.handleSubmit(async (v) => {
    try {
      await call("auth_change_password", { current: v.current, newPassword: v.next });
      toast.success("Mot de passe modifié.");
      form.reset();
      onOpenChange(false);
    } catch (e) {
      form.setError("current", { message: toAppError(e).message });
    }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Changer le mot de passe" description="Choisissez un mot de passe d'au moins 6 caractères." icon={<KeyRound />}>
        <form onSubmit={submit} noValidate>
          <DialogBody className="space-y-3.5">
            <Field label="Mot de passe actuel" error={errors.current?.message}>
              <Input type="password" autoFocus {...form.register("current")} aria-invalid={!!errors.current} />
            </Field>
            <Field label="Nouveau mot de passe" error={errors.next?.message}>
              <Input type="password" {...form.register("next")} aria-invalid={!!errors.next} />
            </Field>
            <Field label="Confirmer le mot de passe" error={errors.confirm?.message}>
              <Input type="password" {...form.register("confirm")} aria-invalid={!!errors.confirm} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Enregistrer
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
