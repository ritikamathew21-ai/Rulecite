"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth/actions";

const fieldClass = "rounded border border-muted bg-white px-3 py-2";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="font-bold">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={fieldClass} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="font-bold">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={fieldClass}
        />
      </div>
      {state?.error && (
        <p role="alert" className="highlighted self-start px-1.5">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
