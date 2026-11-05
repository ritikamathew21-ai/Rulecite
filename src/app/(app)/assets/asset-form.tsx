"use client";

import Link from "next/link";
import { startTransition, useActionState, type FormEvent } from "react";
import { createAsset } from "@/lib/assets/actions";
import { Field, fieldClass } from "../form-field";

export function AssetForm() {
  const [state, formAction, pending] = useActionState(createAsset, undefined);

  // React resets a form after its action runs, which would clear what the Admin typed.
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  };

  return (
    <form action={formAction} onSubmit={submit} className="mt-6 flex max-w-xl flex-col gap-4">
      <Field label="Colour ID" hint="For example CLR-01. It cannot be changed later.">
        <input name="code" required className={fieldClass} />
      </Field>
      <Field label="Colour name">
        <input name="name" required maxLength={120} className={fieldClass} />
      </Field>
      <Field label="Hex value" hint="For example #2340D6.">
        <input name="value" required className={fieldClass} />
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
          {pending ? "Saving…" : "Save draft"}
        </button>
        <Link href="/assets" className="text-pencil underline">
          Cancel
        </Link>
      </div>
    </form>
  );
}
