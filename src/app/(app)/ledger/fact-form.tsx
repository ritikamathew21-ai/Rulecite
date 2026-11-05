"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import type { FactFormState, FactFormValues } from "@/lib/facts/actions";
import { Field, fieldClass } from "../form-field";

type FactFormProps = {
  action: (state: FactFormState, formData: FormData) => Promise<FactFormState>;
  initial?: FactFormValues;
  cancelHref: string;
  submitLabel: string;
  showCode?: boolean;
};

export function FactForm({ action, initial = {}, cancelHref, submitLabel, showCode = false }: FactFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);

  // React resets a form after its action runs, which would clear what the Admin typed.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      {showCode && (
        <Field label="Fact ID" hint="For example FACT-07. It cannot be changed later.">
          <input name="code" required defaultValue={initial.code} className={fieldClass} />
        </Field>
      )}
      <Field label="Approved statement" hint="The exact fact that content may claim.">
        <textarea
          name="statement"
          required
          rows={3}
          maxLength={1000}
          defaultValue={initial.statement}
          className={fieldClass}
        />
      </Field>
      <Field label="Source name" hint="The document this fact comes from.">
        <input name="sourceName" required maxLength={200} defaultValue={initial.sourceName} className={fieldClass} />
      </Field>
      <Field label="Source link" hint="Optional. It must start with http:// or https://.">
        <input name="sourceUrl" type="text" maxLength={500} defaultValue={initial.sourceUrl} className={fieldClass} />
      </Field>
      <Field label="Valid from">
        <input name="validFrom" type="date" required defaultValue={initial.validFrom} className={fieldClass} />
      </Field>
      <Field label="Expires on" hint="Optional. After this date, claims using this fact are outdated.">
        <input name="expiresOn" type="date" defaultValue={initial.expiresOn} className={fieldClass} />
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
