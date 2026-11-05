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

  it("keeps the audit log from the Creator", async () => {
    const { client } = await signIn("zentra-creator@example.com");
    const { data } = await client.from("audit_log").select("id");
    expect(data).toEqual([]);
  });
});
