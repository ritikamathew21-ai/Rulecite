import { beforeEach, describe, expect, it, vi } from "vitest";

const abortSignal = vi.fn();
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc: () => ({ abortSignal }) }),
}));

const { GET } = await import("@/app/api/health/route");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fake");
});

describe("GET /api/health", () => {
  it("reports a reachable database", async () => {
    abortSignal.mockResolvedValue({ data: true, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["a database error", () => abortSignal.mockResolvedValue({ data: null, error: { message: "secret detail" } })],
    ["an unexpected result", () => abortSignal.mockResolvedValue({ data: false, error: null })],
    ["a timeout", () => abortSignal.mockRejectedValue(new Error("secret detail"))],
  ])("reports %s without details", async (_name, arrange) => {
    arrange();
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"status":"degraded","database":"unavailable"}');
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("reports missing configuration without details", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "degraded", database: "unavailable" });
  });
});
