// Seeds the fictional Vornelle demonstration, once. It refuses to run if any of it already exists.
// Usage: npm run db:seed. The password is kept in .env.local and never printed.
import { closeSync, openSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

export const DEMO_ORG_NAME = "Vornelle (Fictional Demo)";
export const DEMO_USERS = [
  { email: "vornelle-creator@example.com", role: "creator", name: "Demo Creator" },
  { email: "vornelle-reviewer@example.com", role: "reviewer", name: "Demo Reviewer" },
  { email: "vornelle-admin@example.com", role: "admin", name: "Demo Admin" },
];

const GUIDE = "Vornelle Brand Guide (fictional)";
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
  rule("TERM-12", "terminology", "medium", "Use the approved product name", "Always write Vornelle Wallet, not a generic name.", "section 2.1", "Our product is always called Vornelle Wallet.", { preferred: "Vornelle Wallet", variants: ["e-wallet", "ewallet", "digital wallet"] }),
  rule("TERM-15", "terminology", "low", "Use the approved rewards name", "Always write Vornelle Rewards.", "section 2.3", "Our loyalty programme is called Vornelle Rewards.", { preferred: "Vornelle Rewards", variants: ["cashback points", "reward points"] }),
  rule("BAN-03", "banned_phrase", "high", "Avoid unsafe financial phrases", "Do not use phrases that hide risk.", "section 4.1", "Never describe a product as risk-free or 100% safe.", { phrases: ["risk-free", "100% safe", "instant approval"] }),
  rule("TONE-01", "tone", "medium", "Sound friendly and plain", "Write like a helpful person. Avoid hype and jargon.", "section 1.2", "Vornelle sounds friendly, plain and calm. We do not use hype."),
  rule("CLM-02", "claim", "high", "Fee and rate claims must match approved facts", "Any fee, rate or limit must match an approved fact that has not expired.", "section 3.1", "Numbers in our content must match the current approved figures."),
  rule("READ-01", "readability", "medium", "Write for a wide audience", "Aim for a reading grade of 9 or lower.", "section 1.4", "Customer content should be readable at about grade 9."),
  rule("ACC-01", "accessibility", "high", "Describe every image", "Every meaningful image needs alt text.", "section 5.1", "All meaningful images must include alternative text."),
  rule("ACC-02", "contrast", "high", "Keep text readable", "Text needs a contrast ratio of at least 4.5:1 against its background.", "section 5.2", "Text and background colours must meet WCAG AA contrast."),
  rule("VIS-02", "visual", "medium", "Use brand colours for text", "Text colours must come from the approved palette.", "section 6.2", "Only palette colours may be used for text."),
];

const fact = (code, statement, sourceName, validFrom, expiresOn = null, status = "approved") => ({
  code,
  statement,
  source_name: `Vornelle ${sourceName} (fictional)`,
  valid_from: validFrom,
  expires_on: expiresOn,
  status,
});

export const DEMO_FACTS = [
  fact("FACT-01", "Transfers between Vornelle Wallet users are free.", "Fee Schedule", "2026-01-01"),
  fact("FACT-02", "Transfers to a bank account cost ₹5 each.", "Fee Schedule", "2026-01-01"),
  fact("FACT-03", "New users get 2% back on their first ten payments.", "Offers Register", "2026-01-01", "2026-06-30"),
  fact("FACT-04", "Vornelle Wallet supports UPI payments.", "Product Sheet", "2026-01-01"),
  fact("FACT-05", "Customer support is open from 9am to 9pm IST every day.", "Support Policy", "2026-01-01"),
  fact("FACT-06", "Weekend support hours may change during festivals.", "Support Policy", "2026-01-01", null, "draft"),
];

const colour = (code, name, value, status = "approved") => ({ code, name, value, status });

export const DEMO_ASSETS = [
  colour("CLR-01", "Vornelle Indigo", "#2B2D8C"),
  colour("CLR-02", "Vornelle Teal", "#12A594"),
  colour("CLR-03", "Vornelle Ink", "#1B1F2A"),
  colour("CLR-04", "White", "#FFFFFF"),
  colour("CLR-05", "Vornelle Coral", "#F2654A", "draft"),
];

export const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DEMO_USER_PASSWORD",
];
const MIN_PASSWORD_LENGTH = 16;
export const LOCK_PATH = join(tmpdir(), "rulecite-seed-demo.lock");

const BRAND_TABLES = [
  ["rules", "rule", DEMO_RULES],
  ["facts", "fact", DEMO_FACTS],
  ["assets", "asset", DEMO_ASSETS],
];
const approvedCodes = (rows) => rows.filter(({ status }) => status === "approved").map(({ code }) => code);
const adminUser = DEMO_USERS.find(({ role }) => role === "admin");

// Reports names only, so a value can never reach the output.
export function checkEnv(env) {
  const problems = REQUIRED_ENV.filter((name) => !env[name]?.trim()).map((name) => `${name} is not set`);
  if (problems.length === 0) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL.startsWith("https://")) problems.push("NEXT_PUBLIC_SUPABASE_URL must use https");
    if (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === env.SUPABASE_SERVICE_ROLE_KEY) {
      problems.push("The publishable key and service role key must differ");
    }
    if (env.DEMO_USER_PASSWORD.length < MIN_PASSWORD_LENGTH) {
      problems.push(`DEMO_USER_PASSWORD must have at least ${MIN_PASSWORD_LENGTH} characters`);
    }
  }
  if (problems.length > 0) throw new Error(`Preflight failed: ${problems.join("; ")}. No changes were made.`);
}

// Only stops runs on this computer. Across computers, the unique account email stops the second run.
function takeLock(path) {
  try {
    closeSync(openSync(path, "wx"));
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Preflight failed: another seed may be running. If none is, delete ${path}. No changes were made.`);
  }
  return () => unlinkSync(path);
}

async function checkDatabase(db) {
  await db.checkPublishableKey();

  const organisations = await db.findOrganisations();
  if (organisations.length > 0) throw new Error("a Vornelle organisation already exists");

  const emails = await db.listEmails();
  const existing = DEMO_USERS.map(({ email }) => email).filter((email) => emails.includes(email));
  if (existing.length > 0) throw new Error(`these accounts already exist: ${existing.join(", ")}`);
}

const sorted = (rows, describe) => rows.map(describe).sort();

const tally = (rows) => {
  const counts = {};
  for (const { action } of rows) counts[action] = (counts[action] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort());
};

export function expectedAudit() {
  const entries = BRAND_TABLES.flatMap(([, entity, rows]) => [
    [`${entity}.created`, rows.length],
    [`${entity}.approved`, approvedCodes(rows).length],
  ]);
  return Object.fromEntries(entries.sort(([first], [second]) => first.localeCompare(second)));
}

export function verifySeed(actual, userIds) {
  const problems = [];
  const check = (label, found, expected) => {
    if (JSON.stringify(found) !== JSON.stringify(expected)) {
      problems.push(`${label}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(found)}`);
    }
  };

  check("organisations", actual.organizations, [{ is_demo: true }]);
  check(
    "memberships",
    sorted(actual.memberships, ({ user_id, role }) => `${user_id}:${role}`),
    sorted(DEMO_USERS, ({ email, role }) => `${userIds[email]}:${role}`),
  );
  for (const [table, , rows] of BRAND_TABLES) {
    check(
      table,
      sorted(actual[table], ({ code, status, version = 1, approved_by }) => `${code}:${status}:${version}:${approved_by}`),
      sorted(rows, ({ code, status }) => `${code}:${status}:1:${status === "approved" ? userIds[adminUser.email] : null}`),
    );
  }
  check("rule revisions", actual.ruleRevisions.length, DEMO_RULES.length);
  check("fact revisions", actual.factRevisions.length, DEMO_FACTS.length);
  check("audit entries", tally(actual.audit), expectedAudit());
  return problems;
}

const VERIFY_STAGE = "Verify by reading back";

// The cases are explained in docs/seed-recovery.md.
const recoveryCase = (stage, completed, orgId) => {
  if (stage === VERIFY_STAGE) return "D";
  if (completed.some((name) => name.endsWith("as drafts"))) return "C";
  return orgId ? "B" : "A";
};

// User and organisation IDs are identifiers, not credentials, and recovery needs them.
const failureReport = ({ stage, reason, completed, userIds, orgId }) =>
  [
    `SEED FAILED at: ${stage}`,
    `Reason: ${reason}`,
    `Completed before the failure: ${completed.join("; ") || "nothing"}`,
    `Created accounts: ${Object.entries(userIds).map(([email, id]) => `${email} = ${id}`).join("; ") || "none"}`,
    `Created organisation: ${orgId ?? "none"}`,
    `Recovery case: ${recoveryCase(stage, completed, orgId)}`,
    "Later stages did not run, and nothing was rolled back or deleted.",
    "Do not rerun. Keep this report, and follow docs/seed-recovery.md.",
  ].join("\n");

export async function seed({ env, openDb = connect, lockPath = LOCK_PATH, log = console.log }) {
  checkEnv(env);
  const unlock = takeLock(lockPath);
  const db = openDb(env);
  const completed = [];
  const userIds = {};
  let orgId = null;
  let current = null;
  const stage = async (name, action) => {
    current = name;
    const result = await action();
    completed.push(name);
    return result;
  };

  try {
    await checkDatabase(db);

    // Accounts come first because emails are unique, so a parallel run stops here with nothing written.
    for (const user of DEMO_USERS) {
      userIds[user.email] = await stage(`Create account ${user.email}`, () => db.createUser(user));
    }

    orgId = await stage("Create organisation", () => db.createOrganisation());

    await stage("Add memberships", () =>
      db.addRows("memberships", DEMO_USERS.map(({ email, role }) => ({ org_id: orgId, user_id: userIds[email], role }))),
    );

    for (const [table, , rows] of BRAND_TABLES) {
      await stage(`Add ${table} as drafts`, () =>
        db.addRows(table, rows.map((row) => ({ ...row, status: "draft", org_id: orgId }))),
      );
    }

    // Signs in as the Demo Admin, so the approval and its audit entry are real.
    for (const [table, , rows] of BRAND_TABLES) {
      await stage(`Approve ${table}`, () => db.approve(table, orgId, approvedCodes(rows)));
    }

    const actual = await stage(VERIFY_STAGE, async () => {
      const found = await db.readBack(orgId);
      const problems = verifySeed(found, userIds);
      if (problems.length > 0) throw new Error(problems.join("; "));
      return found;
    });

    log(
      `Verified from the database: ${actual.organizations.length} organisation, ${actual.memberships.length} memberships, ` +
        `${actual.rules.length} rules, ${actual.facts.length} facts, ${actual.assets.length} colours, ` +
        `${actual.ruleRevisions.length + actual.factRevisions.length} revisions and ${actual.audit.length} audit entries.`,
    );
  } catch (error) {
    if (!current) throw new Error(`Preflight failed: ${error.message}. No changes were made.`);
    throw new Error(failureReport({ stage: current, reason: error.message, completed, userIds, orgId }));
  } finally {
    unlock();
  }
}

// All Supabase access lives here, so tests can replace it.
export function connect(env) {
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    DEMO_USER_PASSWORD: password,
  } = env;
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(url, serviceKey, options);

  // Keeps the error code only, because Supabase messages are not ours to print.
  const must = ({ data, error }, failure) => {
    if (error) throw new Error(`${failure} (${error.code ?? error.status ?? "unknown error"})`);
    return data;
  };
  const read = async (table, columns, orgId) =>
    must(await service.from(table).select(columns).eq("org_id", orgId), `Could not read ${table}`);

  return {
    async checkPublishableKey() {
      must(await createClient(url, publishableKey, options).rpc("health_check"), "The publishable key did not work");
    },

    async findOrganisations() {
      return must(await service.from("organizations").select("id").ilike("name", "%vornelle%"), "Could not read organisations");
    },

    async listEmails() {
      const perPage = 1000;
      const emails = [];
      for (let page = 1; ; page++) {
        const { users } = must(await service.auth.admin.listUsers({ page, perPage }), "Could not list users");
        emails.push(...users.map(({ email }) => email?.toLowerCase()));
        if (users.length < perPage) return emails;
      }
    },

    async createUser({ email, name }) {
      const attributes = { email, password, email_confirm: true, user_metadata: { name, demo: true } };
      return must(await service.auth.admin.createUser(attributes), `Could not create ${email}`).user.id;
    },

    async createOrganisation() {
      const row = { name: DEMO_ORG_NAME, is_demo: true };
      return must(await service.from("organizations").insert(row).select("id").single(), "Could not create the organisation").id;
    },

    async addRows(table, rows) {
      must(await service.from(table).insert(rows), `Could not add ${table}`);
    },

    async approve(table, orgId, codes) {
      const admin = createClient(url, publishableKey, options);
      must(await admin.auth.signInWithPassword({ email: adminUser.email, password }), "Could not sign in as the Demo Admin");
      const approved = must(
        await admin.from(table).update({ status: "approved" }).eq("org_id", orgId).in("code", codes).select("code"),
        `Could not approve ${table}`,
      );
      await admin.auth.signOut({ scope: "local" });
      if (approved.length !== codes.length) throw new Error(`Approved ${approved.length} of ${codes.length} ${table}`);
    },

    async readBack(orgId) {
      const organizations = must(
        await service.from("organizations").select("is_demo").eq("name", DEMO_ORG_NAME),
        "Could not read organisations",
      );
      const [memberships, rules, facts, assets, ruleRevisions, factRevisions, audit] = await Promise.all([
        read("memberships", "user_id, role", orgId),
        read("rules", "code, status, version, approved_by", orgId),
        read("facts", "code, status, version, approved_by", orgId),
        read("assets", "code, status, approved_by", orgId),
        read("rule_revisions", "version", orgId),
        read("fact_revisions", "version", orgId),
        read("audit_log", "action", orgId),
      ]);
      return { organizations, memberships, rules, facts, assets, ruleRevisions, factRevisions, audit };
    },
  };
}

if (process.argv[1]?.endsWith("seed-demo.mjs")) {
  seed({ env: process.env }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
