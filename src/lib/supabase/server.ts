import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicEnv } from "@/lib/env";
import { sessionCookieOptions } from "@/lib/supabase/cookies";

// Uses the signed-in user's session, so row-level security always applies.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getPublicEnv();

  return createServerClient(url, publishableKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot set cookies. The proxy refreshes sessions instead.
        }
      },
    },
  });
}
