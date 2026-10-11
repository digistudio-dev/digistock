import { Field, Input, Select } from "@/components/ui/input";

/** Questions proposées ; l'utilisateur peut aussi écrire la sienne. */
export const SUGGESTED_QUESTIONS = [
  "Quel est le prénom de votre mère ?",
  "Dans quelle ville êtes-vous né(e) ?",
  "Quel est le nom de votre première école ?",
  "Quel était votre premier métier ?",
  "Quel est le prénom de votre meilleur ami d'enfance ?",
  "Quel est votre plat préféré ?",
  "Quel est le nom de votre premier animal de compagnie ?",
  "Quelle est la marque de votre première voiture ?",
  "Quel est le prénom de votre grand-père paternel ?",
];

export interface QA {
  question: string;
  answer: string;
}

export const emptyQuestions = (): QA[] => [
  { question: SUGGESTED_QUESTIONS[0], answer: "" },
  { question: SUGGESTED_QUESTIONS[1], answer: "" },
  { question: SUGGESTED_QUESTIONS[2], answer: "" },
];

/** Erreur de saisie par question (miroir de `domain/security.rs::validate_questions`). */
export function questionErrors(items: QA[]): (string | undefined)[] {
  return items.map((q, i) => {
    if (q.question.trim().length < 5) return "Question trop courte.";
    if (q.answer.trim().replace(/\s+/g, " ").length < 2) return "Saisissez une réponse.";
    if (items.some((o, j) => j !== i && o.question.trim().toLowerCase() === q.question.trim().toLowerCase())) return "Choisissez trois questions différentes.";
    return undefined;
  });
}

const CUSTOM = "__custom__";

export function QuestionsForm({ value, onChange, showErrors }: { value: QA[]; onChange: (v: QA[]) => void; showErrors?: boolean }) {
  const errors = questionErrors(value);
  const update = (i: number, patch: Partial<QA>) => onChange(value.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  return (
    <div className="space-y-4">
      {value.map((q, i) => {
        const custom = !SUGGESTED_QUESTIONS.includes(q.question);
        return (
          <div key={i} className="rounded-lg border bg-surface p-4">
            <div className="eyebrow mb-2">Question {i + 1}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <Select value={custom ? CUSTOM : q.question} onChange={(e) => update(i, { question: e.target.value === CUSTOM ? "" : e.target.value })}>
                  {SUGGESTED_QUESTIONS.map((s) => (
                    <option key={s} value={s} disabled={value.some((o, j) => j !== i && o.question === s)}>
                      {s}
                    </option>
                  ))}
                  <option value={CUSTOM}>Écrire ma propre question…</option>
                </Select>
                {custom && <Input className="mt-2" value={q.question} placeholder="Votre question" onChange={(e) => update(i, { question: e.target.value })} />}
              </Field>
              <Field error={showErrors ? errors[i] : undefined}>
                <Input value={q.answer} placeholder="Votre réponse" autoComplete="off" onChange={(e) => update(i, { answer: e.target.value })} aria-invalid={showErrors && !!errors[i]} />
              </Field>
            </div>
          </div>
        );
      })}
      <p className="text-[0.75rem] text-muted-foreground">Les majuscules et les espaces ne comptent pas. Choisissez des réponses que vous seul connaissez et que vous n'oublierez pas.</p>
    </div>
  );
}
