// Seeds the fictional Zentra demonstration. Safe to run more than once.
// Usage: npm run db:seed. The password is kept in .env.local and never printed.
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export const DEMO_ORG_NAME = "Zentra (Fictional Demo)";
export const DEMO_USERS = [
  { email: "zentra-creator@example.com", role: "creator", name: "Demo Creator" },
  { email: "zentra-reviewer@example.com", role: "reviewer", name: "Demo Reviewer" },
  { email: "zentra-admin@example.com", role: "admin", name: "Demo Admin" },
];

function demoPassword() {
  if (process.env.DEMO_USER_PASSWORD) return process.env.DEMO_USER_PASSWORD;
  const password = randomBytes(24).toString("base64url");
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}DEMO_USER_PASSWORD=${password}\n`);
  return password;
}

async function findOrCreateOrg(client) {
  const found = await client.from("organizations").select("id").eq("name", DEMO_ORG_NAME).maybeSingle();
  if (found.error) throw new Error("Could not read organisations");
  if (found.data) return found.data.id;
  const created = await client
    .from("organizations")
    .insert({ name: DEMO_ORG_NAME, is_demo: true })
    .select("id")
    .single();
  if (created.error) throw new Error("Could not create the demo organisation");
  return created.data.id;
}

async function upsertUser(client, existingUsers, { email, name }, password) {
  const attributes = { password, email_confirm: true, user_metadata: { name, demo: true } };
  const existing = existingUsers.find((user) => user.email === email);
  const result = existing
    ? await client.auth.admin.updateUserById(existing.id, attributes)
    : await client.auth.admin.createUser({ email, ...attributes });
  if (result.error) throw new Error(`Could not save ${email}`);
  return result.data.user.id;
}

async function seed() {
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: serviceKey } = process.env;
  if (!url || !serviceKey) throw new Error("Missing Supabase settings. Use --env-file=.env.local.");

  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = demoPassword();
  const orgId = await findOrCreateOrg(client);

  const listed = await client.auth.admin.listUsers({ perPage: 1000 });
  if (listed.error) throw new Error("Could not list users");

  for (const user of DEMO_USERS) {
    const userId = await upsertUser(client, listed.data.users, user, password);
    const member = await client
      .from("memberships")
      .upsert({ org_id: orgId, user_id: userId, role: user.role }, { onConflict: "org_id,user_id" });
    if (member.error) throw new Error(`Could not add ${user.email}`);
  }

  console.log(`Seeded ${DEMO_ORG_NAME} with ${DEMO_USERS.length} demo accounts.`);
}

if (process.argv[1]?.endsWith("seed-demo.mjs")) {
  seed().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
