"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import type { VersionFormState } from "@/lib/documents/workflow-actions";
import { Field, fieldClass } from "../../../form-field";

type VersionFormProps = {
  action: (state: VersionFormState, formData: FormData) => Promise<VersionFormState>;
  text: string;
  synthetic: boolean;
  cancelHref: string;
};

export function VersionForm({ action, text, synthetic, cancelHref }: VersionFormProps) {
  const [state, formAction, pending] = useActionState(action, undefined);

  // React resets a form after its action runs, which would discard the edit.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      <Field label="Draft text">
        <textarea name="text" required rows={14} defaultValue={text} className={fieldClass} />
      </Field>
      <label className="flex items-start gap-2">
        <input name="synthetic" type="checkbox" defaultChecked={synthetic} className="mt-1" />
        <span>This content is fictional or synthetic. AI checks will only ever run on content marked this way.</span>
      </label>

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
          {pending ? "Checking…" : "Save and check new version"}
        </button>
        <Link href={cancelHref} className="text-pencil underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
