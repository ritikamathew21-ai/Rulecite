import { expect, it } from "vitest";

it("does not allow public signup", async () => {
  const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
  });
  const settings = await response.json();
  expect(settings.disable_signup).toBe(true);
});
