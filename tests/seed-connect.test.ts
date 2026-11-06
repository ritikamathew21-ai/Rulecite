import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connect } from "../scripts/seed-demo.mjs";

// Runs the real Supabase SDK against a fake fetch, so no request leaves this process.
const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-value",
  DEMO_USER_PASSWORD: "a-long-demo-password-value",
};

type Call = { method: string; path: string; headers: Headers; body: unknown };
type Reply = { status?: number; json?: unknown; headers?: Record<string, string> };

let calls: Call[];
let replies: Reply[];

const json = (reply: Reply) =>
  new Response(reply.json === undefined ? null : JSON.stringify(reply.json), {
    status: reply.status ?? 200,
    headers: { "Content-Type": "application/json", ...reply.headers },
  });

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    calls.push({
      method: init.method ?? "GET",
      path: decodeURIComponent(url.pathname + url.search),
      headers: new Headers(init.headers),
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error(`Unexpected request: ${url}`);
    return json(reply);
  });
});

afterEach(() => vi.unstubAllGlobals());

const session = {
  access_token: "admin-token",
  refresh_token: "refresh",
  token_type: "bearer",
  expires_in: 3600,
  user: { id: "admin-id", email: "vornelle-admin@example.com" },
};

describe("preflight calls", () => {
  it("checks the publishable key through health_check", async () => {
    replies = [{ json: true }];
    await connect(env).checkPublishableKey();
    expect(calls[0]).toMatchObject({ method: "POST", path: "/rest/v1/rpc/health_check" });
    expect(calls[0].headers.get("apikey")).toBe("publishable-value");
  });

  it("finds organisations by a case-insensitive name match, with the service key", async () => {
    replies = [{ json: [{ id: "org-1" }] }];
    await expect(connect(env).findOrganisations()).resolves.toEqual([{ id: "org-1" }]);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/rest/v1/organizations?select=id&name=ilike.%vornelle%" });
    expect(calls[0].headers.get("apikey")).toBe("service-value");
  });

  it("reads every page of users and lowercases emails", async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ id: `${index}`, email: `USER${index}@example.com` }));
    replies = [{ json: { users: page, aud: "authenticated" } }, { json: { users: [{ id: "x", email: "Last@Example.com" }], aud: "authenticated" } }];

    const emails = await connect(env).listEmails();
    expect(calls.map(({ path }) => path)).toEqual(["/auth/v1/admin/users?page=1&per_page=1000", "/auth/v1/admin/users?page=2&per_page=1000"]);
    expect(emails).toHaveLength(1001);
    expect(emails).toContain("last@example.com");
  });

  it("copes with a user who has no email", async () => {
    replies = [{ json: { users: [{ id: "phone-user" }], aud: "authenticated" } }];
    await expect(connect(env).listEmails()).resolves.toEqual([undefined]);
  });
});

describe("write calls", () => {
  it("creates a confirmed account and returns its ID from the plain user response", async () => {
    replies = [{ json: { id: "user-1", email: "vornelle-creator@example.com" } }];
    const id = await connect(env).createUser({ email: "vornelle-creator@example.com", name: "Demo Creator" });

    expect(id).toBe("user-1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/auth/v1/admin/users",
      body: {
        email: "vornelle-creator@example.com",
        password: env.DEMO_USER_PASSWORD,
        email_confirm: true,
        user_metadata: { name: "Demo Creator", demo: true },
      },
    });
    expect(calls[0].headers.get("authorization")).toBe("Bearer service-value");
  });

  it("creates the organisation and reads its ID from a single object", async () => {
    replies = [{ status: 201, json: { id: "org-1" } }];
    await expect(connect(env).createOrganisation()).resolves.toBe("org-1");
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/rest/v1/organizations?select=id",
      body: { name: "Vornelle (Fictional Demo)", is_demo: true },
    });
    expect(calls[0].headers.get("accept")).toContain("application/vnd.pgrst.object+json");
  });

  it("adds rows with a plain insert, which cannot overwrite", async () => {
    replies = [{ status: 201 }];
    await connect(env).addRows("rules", [{ code: "MSG-04" }]);
    expect(calls[0]).toMatchObject({ method: "POST", path: '/rest/v1/rules?columns="code"', body: [{ code: "MSG-04" }] });
    expect(calls[0].headers.get("prefer") ?? "").not.toContain("resolution");
  });

  it("approves as the signed-in Demo Admin, then signs out", async () => {
    replies = [{ json: session }, { json: [{ code: "MSG-04" }, { code: "MSG-07" }] }, { status: 204 }];
    await connect(env).approve("rules", "org-1", ["MSG-04", "MSG-07"]);

    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/auth/v1/token?grant_type=password",
      body: { email: "vornelle-admin@example.com", password: env.DEMO_USER_PASSWORD },
    });
    expect(calls[0].headers.get("apikey")).toBe("publishable-value");
    expect(calls[1]).toMatchObject({
      method: "PATCH",
      path: "/rest/v1/rules?org_id=eq.org-1&code=in.(MSG-04,MSG-07)&select=code",
      body: { status: "approved" },
    });
    expect(calls[1].headers.get("authorization")).toBe("Bearer admin-token");
    expect(calls[2]).toMatchObject({ method: "POST", path: "/auth/v1/logout?scope=local" });
  });

  it("fails if fewer rows were approved than requested", async () => {
    replies = [{ json: session }, { json: [{ code: "MSG-04" }] }, { status: 204 }];
    await expect(connect(env).approve("rules", "org-1", ["MSG-04", "MSG-07"])).rejects.toThrow("Approved 1 of 2 rules");
  });
});

describe("read-back", () => {
  it("reads each table for the organisation, and the organisation by exact name", async () => {
    replies = Array.from({ length: 8 }, () => ({ json: [] }));
    const found = await connect(env).readBack("org-1");

    expect(Object.keys(found)).toEqual(["organizations", "memberships", "rules", "facts", "assets", "ruleRevisions", "factRevisions", "audit"]);
    expect(calls.map(({ path }) => path).sort()).toEqual(
      [
        "/rest/v1/organizations?select=is_demo&name=eq.Vornelle+(Fictional+Demo)",
        "/rest/v1/memberships?select=user_id,role&org_id=eq.org-1",
        "/rest/v1/rules?select=code,status,version,approved_by&org_id=eq.org-1",
        "/rest/v1/facts?select=code,status,version,approved_by&org_id=eq.org-1",
        "/rest/v1/assets?select=code,status,approved_by&org_id=eq.org-1",
        "/rest/v1/rule_revisions?select=version&org_id=eq.org-1",
        "/rest/v1/fact_revisions?select=version&org_id=eq.org-1",
        "/rest/v1/audit_log?select=action&org_id=eq.org-1",
      ].sort(),
    );
  });
});

describe("error responses", () => {
  it("keeps the auth error code and drops its message", async () => {
    replies = [{ status: 422, json: { code: 422, error_code: "email_exists", msg: "private detail" } }];
    const failure = await connect(env).createUser({ email: "a@example.com", name: "A" }).catch((error) => error.message);
    expect(failure).toBe("Could not create a@example.com (email_exists)");
  });

  it("keeps the database error code and drops its message", async () => {
    replies = [{ status: 409, json: { code: "23505", message: "private detail", details: null, hint: null } }];
    const failure = await connect(env).addRows("rules", []).catch((error) => error.message);
    expect(failure).toBe("Could not add rules (23505)");
  });

  it("stops before updating if the Demo Admin cannot sign in", async () => {
    replies = [{ status: 400, json: { code: 400, error_code: "invalid_credentials", msg: "private detail" } }];
    await expect(connect(env).approve("rules", "org-1", ["MSG-04"])).rejects.toThrow(
      "Could not sign in as the Demo Admin (invalid_credentials)",
    );
    expect(calls).toHaveLength(1);
  });

  it("reports an error from listing users", async () => {
    replies = [{ status: 401, json: { code: 401, error_code: "not_admin", msg: "private detail" } }];
    await expect(connect(env).listEmails()).rejects.toThrow("Could not list users (not_admin)");
  });
});
