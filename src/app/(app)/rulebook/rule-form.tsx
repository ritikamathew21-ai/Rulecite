"use client";

import Link from "next/link";
import { startTransition, useActionState, useState, type FormEvent } from "react";
import type { RuleFormState, RuleFormValues } from "@/lib/rules/actions";
import { RULE_TYPE_LABELS, SEVERITY_LABELS } from "@/lib/rules/schema";

const fieldClass = "rounded border border-muted bg-white px-3 py-2";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-bold">{label}</span>
      {hint && <span className="text-sm text-muted">{hint}</span>}
      {children}
    </label>
  );
}

type RuleFormProps = {
  action: (state: RuleFormState, formData: FormData) => Promise<RuleFormState>;
  initial?: RuleFormValues;
  cancelHref: string;
  submitLabel: string;
  showCode?: boolean;
};

export function RuleForm({ action, initial = {}, cancelHref, submitLabel, showCode = false }: RuleFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const [type, setType] = useState(initial.type ?? "messaging");

  // React resets a form after its action runs, which would silently change the selected rule type.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      {showCode && (
        <Field label="Rule ID" hint="For example MSG-04. It cannot be changed later.">
          <input name="code" required defaultValue={initial.code} className={fieldClass} />
        </Field>
      )}
      <Field label="Rule type">
        <select name="type" value={type} onChange={(event) => setType(event.target.value)} className={fieldClass}>
          {Object.entries(RULE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Severity">
        <select name="severity" defaultValue={initial.severity ?? "medium"} className={fieldClass}>
          {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Title">
        <input name="title" required maxLength={120} defaultValue={initial.title} className={fieldClass} />
      </Field>
      <Field label="Instruction" hint="What content must do to follow this rule.">
        <textarea
          name="instruction"
          required
          rows={3}
          maxLength={1000}
          defaultValue={initial.instruction}
          className={fieldClass}
        />
      </Field>
      {type === "terminology" && (
        <Field label="Approved term">
          <input name="preferred" maxLength={120} defaultValue={initial.preferred} className={fieldClass} />
        </Field>
      )}
      {(type === "terminology" || type === "banned_phrase") && (
        <Field
          label={type === "terminology" ? "Terms to replace" : "Banned phrases"}
          hint="Separate them with commas or new lines."
        >
          <textarea name="terms" rows={3} defaultValue={initial.terms} className={fieldClass} />
        </Field>
      )}
      <Field label="Source excerpt" hint="The exact words from your brand guidelines.">
        <textarea
          name="sourceExcerpt"
          required
          rows={3}
          maxLength={2000}
          defaultValue={initial.sourceExcerpt}
          className={fieldClass}
        />
      </Field>
      <Field label="Source name" hint="The document and section the excerpt comes from.">
        <input name="sourceName" required maxLength={200} defaultValue={initial.sourceName} className={fieldClass} />
      </Field>

      {state?.error && (
        <p role="alert" className="highlighted self-start px-1.5">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
        </button>
        <Link href={cancelHref} className="text-pencil underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
