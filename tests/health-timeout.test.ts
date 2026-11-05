import { expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

// Uses the real Supabase client, so it proves the abort reaches the request.
it("gives up on a hung database request after about 5 seconds", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fake");
  vi.stubGlobal("fetch", (_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    }),
  );

  const started = Date.now();
  const response = await GET();
  const elapsed = Date.now() - started;

  expect(response.status).toBe(503);
  expect(await response.text()).toBe('{"status":"degraded","database":"unavailable"}');
  expect(elapsed).toBeGreaterThanOrEqual(4900);
  expect(elapsed).toBeLessThan(6000);
}, 15_000);
