import { AuthInvalidJwtError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
const maybeSingle = vi.fn();
const query = { select: () => query, eq: () => query, order: () => query, limit: () => query, maybeSingle };

vi.mock("server-only", () => ({}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T,>(fn: T) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT ${path}`);
  },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims } }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims }, from: () => query }),
}));

const { proxy } = await import("@/proxy");
const { requireMember } = await import("@/lib/auth/member");

const outage = new AuthRetryableFetchError("fetch failed", 0);
const forged = new AuthInvalidJwtError("Invalid JWT signature");
const validClaims = { data: { claims: { sub: "user-1", email: "person@example.com" } }, error: null };
const request = (path: string) => new NextRequest(`http://localhost:3100${path}`);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fake");
  getClaims.mockReset();
  maybeSingle.mockReset();
});

describe("proxy", () => {
  it("does not treat a verification outage as signed out", async () => {
    getClaims.mockResolvedValue({ data: null, error: outage });
    const response = await proxy(request("/audit"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each([
    ["no session", { data: null, error: null }],
    ["a forged token", { data: null, error: forged }],
  ])("sends %s to sign-in", async (_name, result) => {
    getClaims.mockResolvedValue(result);
    const response = await proxy(request("/audit"));
    expect(response.headers.get("location")).toBe("http://localhost:3100/login?next=%2Faudit");
  });

  it("sends a signed-in user away from sign-in", async () => {
    getClaims.mockResolvedValue(validClaims);
    const response = await proxy(request("/login"));
    expect(response.headers.get("location")).toBe("http://localhost:3100/workspace");
  });
});

describe("requireMember", () => {
  it("fails closed with an error during a verification outage", async () => {
    getClaims.mockResolvedValue({ data: null, error: outage });
    await expect(requireMember()).rejects.toThrow("Could not verify session");
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it.each([
    ["no session", { data: null, error: null }],
    ["a forged token", { data: null, error: forged }],
  ])("redirects %s to sign-in", async (_name, result) => {
    getClaims.mockResolvedValue(result);
    await expect(requireMember()).rejects.toThrow("REDIRECT /login");
  });

  it("returns the member when the session is valid", async () => {
    getClaims.mockResolvedValue(validClaims);
    maybeSingle.mockResolvedValue({
      data: { role: "admin", organizations: { id: "org-1", name: "Org", is_demo: true } },
      error: null,
    });
    await expect(requireMember()).resolves.toMatchObject({ userId: "user-1", role: "admin" });
  });
});
