"use client";

import Link from "next/link";
import { startTransition, useActionState, useRef, type ChangeEvent, type FormEvent } from "react";
import { createDocument } from "@/lib/documents/actions";
import { SAMPLE_DOCUMENT, titleFromFileName } from "@/lib/documents/labels";
import { Field, fieldClass } from "../form-field";

export function DocumentForm({ showSample }: { showSample: boolean }) {
  const [state, formAction, pending] = useActionState(createDocument, undefined);
  const form = useRef<HTMLFormElement>(null);
  const field = (name: string) => form.current!.elements.namedItem(name) as HTMLInputElement;

  // React resets a form after its action runs, which would clear what the user typed.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  const fillSample = () => {
    field("title").value = SAMPLE_DOCUMENT.title;
    field("text").value = SAMPLE_DOCUMENT.text;
    field("file").value = "";
    field("synthetic").checked = true;
  };

  const fileChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && !field("title").value.trim()) field("title").value = titleFromFileName(file.name);
  };

  return (
    <form ref={form} action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      {showSample && (
        <div>
          <button type="button" onClick={fillSample} className="rounded border border-pencil px-4 py-2 font-bold text-pencil">
            Use sample document
          </button>
          <p className="mt-2">Fills in a fictional draft with planted problems, so you can try a check straight away.</p>
        </div>
      )}
      <Field label="Title">
        <input name="title" required maxLength={200} className={fieldClass} />
      </Field>
      <Field label="Paste your text">
        <textarea name="text" rows={10} className={fieldClass} />
      </Field>
      <Field label="Or upload a file" hint="A .docx or .pdf file up to 4 MB. If you choose a file, it is used instead of the text above.">
        <input
          name="file"
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={fileChosen}
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
