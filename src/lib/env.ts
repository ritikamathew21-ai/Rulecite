import { z } from "zod";

const publicEnvSchema = z.object({
  url: z.url({ protocol: /^https$/ }),
  // Rejects a secret key pasted into the browser-visible slot.
  publishableKey: z.string().startsWith("sb_publishable_"),
});

export function parsePublicEnv(values: { url?: string; publishableKey?: string }) {
  const parsed = publicEnvSchema.safeParse(values);
  if (!parsed.success) {
    throw new Error(
      "Invalid NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Check .env.local.",
    );
  }
  return parsed.data;
}

// Next.js only inlines NEXT_PUBLIC_ values referenced by their literal names.
export const getPublicEnv = () =>
  parsePublicEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
