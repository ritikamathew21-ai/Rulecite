"use server";

import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/redirects";
import { loginSchema } from "@/lib/auth/schema";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error: string } | undefined;

const INVALID_LOGIN = "Incorrect email or password.";

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: INVALID_LOGIN };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.status === 429) return { error: "Too many attempts. Please try again later." };
    if (error.status === undefined || error.status >= 500) {
      return { error: "Sign-in is unavailable right now. Please try again later." };
    }
    return { error: INVALID_LOGIN };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function logout() {
  const supabase = await createClient();
  // Local scope, because shared demo accounts may be signed in elsewhere.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
