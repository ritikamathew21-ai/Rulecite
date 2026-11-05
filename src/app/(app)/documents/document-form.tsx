"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import { createDocument } from "@/lib/documents/actions";
import { Field, fieldClass } from "../form-field";

export function DocumentForm() {
  const [state, formAction, pending] = useActionState(createDocument, undefined);

  // React resets a form after its action runs, which would clear what the user typed.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      <Field label="Title">
        <input name="title" required maxLength={200} className={fieldClass} />
      </Field>
      <Field label="Paste your text">
        <textarea name="text" rows={10} className={fieldClass} />
      </Field>
      <Field label="Or upload a Word document" hint="A .docx file up to 4 MB. If you choose a file, it is used instead of the text above.">
        <input
          name="file"
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className={fieldClass}
        />
      </Field>
      <label className="flex items-start gap-2">
        <input name="synthetic" type="checkbox" className="mt-1" />
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
          {pending ? "Checking…" : "Save and check"}
        </button>
        <Link href="/documents" className="text-pencil underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
