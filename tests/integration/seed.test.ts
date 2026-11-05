import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DEMO_ORG_NAME, DEMO_USERS } from "../../scripts/seed-demo.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const newClient = (key: string) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email: string) {
  const client = newClient(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password: process.env.DEMO_USER_PASSWORD!,
  });
  if (error) throw new Error(`Could not sign in ${email}`);
  return { client, userId: data.user.id };
}

describe("Zentra demo", () => {
  it("exists once and is marked as a demo", async () => {
    const service = newClient(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data } = await service.from("organizations").select("is_demo").eq("name", DEMO_ORG_NAME);
    expect(data).toEqual([{ is_demo: true }]);
  });

  it.each(DEMO_USERS)("$role signs in and sees only Zentra", async ({ email, role }) => {
    const { client, userId } = await signIn(email);
    const orgs = await client.from("organizations").select("name, is_demo");
    expect(orgs.data).toEqual([{ name: DEMO_ORG_NAME, is_demo: true }]);

    const members = await client.from("memberships").select("user_id, role");
    expect(members.data?.length).toBe(DEMO_USERS.length);
    expect(members.data?.find((row) => row.user_id === userId)?.role).toBe(role);
  });

  it("gives a Creator approved rules only", async () => {
    const { client } = await signIn("zentra-creator@example.com");
    const { data } = await client.from("rules").select("code, status");
    expect(data?.length).toBe(11);
    expect(data?.every((rule) => rule.status === "approved")).toBe(true);
  });

  it("records the Demo Admin as the approver of every approved rule", async () => {
    const { userId } = await signIn("zentra-admin@example.com");
    const { client } = await signIn("zentra-reviewer@example.com");
    const { data } = await client.from("rules").select("approved_by, approved_at").eq("status", "approved");
    expect(data?.length).toBe(11);
    expect(data?.every((rule) => rule.approved_by === userId && rule.approved_at)).toBe(true);

    const audit = await client.from("audit_log").select("actor_id").eq("action", "rule.approved").eq("entity_id", "MSG-04");
    expect(audit.data).toContainEqual({ actor_id: userId });
  });

  it("gives a Creator approved facts and colours only", async () => {
    const { client } = await signIn("zentra-creator@example.com");
    const facts = await client.from("facts").select("status");
    const assets = await client.from("assets").select("status");
    expect(facts.data?.length).toBe(5);
    expect(assets.data?.length).toBe(4);
    expect([...facts.data!, ...assets.data!].every(({ status }) => status === "approved")).toBe(true);
  });

  it("records the Demo Admin as the approver of facts and colours", async () => {
    const { userId } = await signIn("zentra-admin@example.com");
    const { client } = await signIn("zentra-reviewer@example.com");
    for (const table of ["facts", "assets"]) {
      const { data } = await client.from(table).select("approved_by").eq("status", "approved");
      expect(data?.every(({ approved_by }) => approved_by === userId)).toBe(true);
    }
  });

  it("keeps the audit log from the Creator", async () => {
    const { client } = await signIn("zentra-creator@example.com");
    const { data } = await client.from("audit_log").select("id");
    expect(data).toEqual([]);
  });
});
