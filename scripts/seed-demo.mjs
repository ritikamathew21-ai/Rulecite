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

const GUIDE = "Zentra Brand Guide (fictional)";
const rule = (code, type, severity, title, instruction, section, excerpt, config = {}, status = "approved") => ({
  code,
  type,
  severity,
  title,
  instruction,
  source_excerpt: excerpt,
  source_name: `${GUIDE}, ${section}`,
  config,
  status,
});

export const DEMO_RULES = [
  rule("MSG-04", "messaging", "high", "Superlatives need an approved source", "Do not use words like best, lowest or fastest unless an approved fact supports the claim.", "section 3.2", "Superlative claims such as lowest, best or fastest may only appear with an approved source."),
  rule("MSG-07", "messaging", "high", "Do not promise outcomes", "Do not guarantee savings, returns or approval.", "section 3.4", "We never guarantee a financial outcome for a customer."),
  rule("MSG-09", "messaging", "low", "Link to the fee schedule", "When mentioning fees, link to the current fee schedule.", "section 3.6", "Any mention of fees should point readers to the current fee schedule.", {}, "draft"),
  rule("TERM-12", "terminology", "medium", "Use the approved product name", "Always write Zentra Wallet, not a generic name.", "section 2.1", "Our product is always called Zentra Wallet.", { preferred: "Zentra Wallet", variants: ["e-wallet", "ewallet", "digital wallet"] }),
  rule("TERM-15", "terminology", "low", "Use the approved rewards name", "Always write Zentra Rewards.", "section 2.3", "Our loyalty programme is called Zentra Rewards.", { preferred: "Zentra Rewards", variants: ["cashback points", "reward points"] }),
  rule("BAN-03", "banned_phrase", "high", "Avoid unsafe financial phrases", "Do not use phrases that hide risk.", "section 4.1", "Never describe a product as risk-free or 100% safe.", { phrases: ["risk-free", "100% safe", "instant approval"] }),
  rule("TONE-01", "tone", "medium", "Sound friendly and plain", "Write like a helpful person. Avoid hype and jargon.", "section 1.2", "Zentra sounds friendly, plain and calm. We do not use hype."),
  rule("CLM-02", "claim", "high", "Fee and rate claims must match approved facts", "Any fee, rate or limit must match an approved fact that has not expired.", "section 3.1", "Numbers in our content must match the current approved figures."),
  rule("READ-01", "readability", "medium", "Write for a wide audience", "Aim for a reading grade of 9 or lower.", "section 1.4", "Customer content should be readable at about grade 9."),
  rule("ACC-01", "accessibility", "high", "Describe every image", "Every meaningful image needs alt text.", "section 5.1", "All meaningful images must include alternative text."),
  rule("VIS-02", "visual", "medium", "Use brand colours for text", "Text colours must come from the approved palette.", "section 6.2", "Only palette colours may be used for text."),
];

const fact = (code, statement, sourceName, validFrom, expiresOn = null, status = "approved") => ({
  code,
  statement,
  source_name: `Zentra ${sourceName} (fictional)`,
  valid_from: validFrom,
  expires_on: expiresOn,
  status,
});

export const DEMO_FACTS = [
  fact("FACT-01", "Transfers between Zentra Wallet users are free.", "Fee Schedule", "2026-01-01"),
  fact("FACT-02", "Transfers to a bank account cost ₹5 each.", "Fee Schedule", "2026-01-01"),
  fact("FACT-03", "New users get 2% back on their first ten payments.", "Offers Register", "2026-01-01", "2026-06-30"),
  fact("FACT-04", "Zentra Wallet supports UPI payments.", "Product Sheet", "2026-01-01"),
  fact("FACT-05", "Customer support is open from 9am to 9pm IST every day.", "Support Policy", "2026-01-01"),
  fact("FACT-06", "Weekend support hours may change during festivals.", "Support Policy", "2026-01-01", null, "draft"),
];

const colour = (code, name, value, status = "approved") => ({ code, name, value, status });

export const DEMO_ASSETS = [
  colour("CLR-01", "Zentra Indigo", "#2B2D8C"),
  colour("CLR-02", "Zentra Teal", "#12A594"),
  colour("CLR-03", "Zentra Ink", "#1B1F2A"),
  colour("CLR-04", "White", "#FFFFFF"),
  colour("CLR-05", "Zentra Coral", "#F2654A", "draft"),
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

// Signs in as the Demo Admin, so the approval and its audit entry are real.
async function approveAsDemoAdmin(url, publishableKey, password, orgId, table, codes) {
  const admin = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = DEMO_USERS.find(({ role }) => role === "admin").email;
  const signedIn = await admin.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error("Could not sign in as the Demo Admin");

  const approved = await admin.from(table).update({ status: "approved" }).eq("org_id", orgId).in("code", codes).select("code");
  if (approved.error || approved.data.length !== codes.length) throw new Error(`Could not approve demo ${table}`);
  await admin.auth.signOut({ scope: "local" });
}

async function seed() {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  } = process.env;
  if (!url || !publishableKey || !serviceKey) throw new Error("Missing Supabase settings. Use --env-file=.env.local.");

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

  for (const [table, rows] of [["rules", DEMO_RULES], ["facts", DEMO_FACTS], ["assets", DEMO_ASSETS]]) {
    // Existing rows are left alone, so a rerun cannot undo an Admin's edits.
    const added = await client
      .from(table)
      .upsert(
        rows.map((row) => ({ ...row, status: "draft", org_id: orgId })),
        { onConflict: "org_id,code", ignoreDuplicates: true },
      )
      .select("code");
    if (added.error) throw new Error(`Could not add demo ${table}`);

    const addedCodes = new Set(added.data.map(({ code }) => code));
    const toApprove = rows.filter(({ code, status }) => status === "approved" && addedCodes.has(code)).map(({ code }) => code);
    if (toApprove.length > 0) await approveAsDemoAdmin(url, publishableKey, password, orgId, table, toApprove);
  }

  console.log(`Seeded ${DEMO_ORG_NAME} with ${DEMO_USERS.length} demo accounts, ${DEMO_RULES.length} rules, ${DEMO_FACTS.length} facts and ${DEMO_ASSETS.length} colours.`);
}

if (process.argv[1]?.endsWith("seed-demo.mjs")) {
  seed().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
