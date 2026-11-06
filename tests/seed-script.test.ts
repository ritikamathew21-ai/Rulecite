import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkEnv,
  DEMO_ASSETS,
  DEMO_FACTS,
  DEMO_ORG_NAME,
  DEMO_RULES,
  DEMO_USERS,
  expectedAudit,
  REQUIRED_ENV,
  seed,
  verifySeed,
} from "../scripts/seed-demo.mjs";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-value",
  SUPABASE_SERVICE_ROLE_KEY: "service-value",
  DEMO_USER_PASSWORD: "a-long-demo-password-value",
};

type Row = Record<string, unknown>;

// An in-memory database that records every write in order.
function fakeDb({ organisations = [] as Row[], emails = [] as string[], failAt = "" } = {}) {
  const writes: string[] = [];
  const tables: Record<string, Row[]> = { memberships: [], rules: [], facts: [], assets: [] };
  const audit: { action: string }[] = [];
  const entity = { rules: "rule", facts: "fact", assets: "asset" } as Record<string, string>;
  const record = (name: string) => {
    if (name === failAt) throw new Error("simulated failure");
    writes.push(name);
  };

  return {
    writes,
    tables,
    async checkPublishableKey() {},
    async findOrganisations() {
      return organisations;
    },
    async listEmails() {
      return emails;
    },
    async createUser({ email }: { email: string }) {
      record(`createUser ${email}`);
      return `id-${email}`;
    },
    async createOrganisation() {
      record("createOrganisation");
      return "org-1";
    },
    async addRows(table: string, rows: Row[]) {
      record(`addRows ${table}`);
      tables[table].push(...rows.map((row) => ({ version: table === "assets" ? undefined : 1, approved_by: null, ...row })));
      if (entity[table]) audit.push(...rows.map(() => ({ action: `${entity[table]}.created` })));
    },
    async approve(table: string, _orgId: string, codes: string[]) {
      record(`approve ${table}`);
      for (const row of tables[table]) {
        if (!codes.includes(row.code as string)) continue;
        row.status = "approved";
        row.approved_by = "id-vornelle-admin@example.com";
        audit.push({ action: `${entity[table]}.approved` });
      }
    },
    async readBack() {
      return {
        organizations: [{ is_demo: true }],
        memberships: tables.memberships,
        rules: tables.rules,
        facts: tables.facts,
        assets: tables.assets,
        ruleRevisions: tables.rules,
        factRevisions: tables.facts,
        audit,
      };
    },
  };
}

let folder: string;
let lockPath: string;
let logs: string[];
const run = (db: ReturnType<typeof fakeDb>, overrides = {}) =>
  seed({ env, openDb: () => db, lockPath, log: (line: string) => logs.push(line), ...overrides });

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "seed-test-"));
  lockPath = join(folder, "seed.lock");
  logs = [];
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("checkEnv", () => {
  it("accepts complete settings", () => {
    expect(() => checkEnv(env)).not.toThrow();
  });

  it.each(REQUIRED_ENV)("refuses when %s is missing", (name) => {
    expect(() => checkEnv({ ...env, [name]: " " })).toThrow(`${name} is not set`);
  });

  it("names every missing setting at once", () => {
    expect(() => checkEnv({})).toThrow(REQUIRED_ENV.map((name) => `${name} is not set`).join("; "));
  });

  it("refuses an insecure address, matching keys and a short password", () => {
    expect(() => checkEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co" })).toThrow("must use https");
    expect(() => checkEnv({ ...env, SUPABASE_SERVICE_ROLE_KEY: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY })).toThrow("must differ");
    expect(() => checkEnv({ ...env, DEMO_USER_PASSWORD: "short" })).toThrow("at least 16 characters");
  });

  it("never includes a value in its message", () => {
    let message = "";
    try {
      checkEnv({ ...env, DEMO_USER_PASSWORD: "short-secret" });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toContain("short-secret");
    expect(message).not.toContain("service-value");
  });
});

describe("seed preflight", () => {
  it("refuses before any write if a Vornelle organisation exists", async () => {
    const db = fakeDb({ organisations: [{ id: "existing" }] });
    await expect(run(db)).rejects.toThrow("Preflight failed: a Vornelle organisation already exists. No changes were made.");
    expect(db.writes).toEqual([]);
  });

  it("refuses before any write if one account exists", async () => {
    const db = fakeDb({ emails: ["someone@example.com", "vornelle-reviewer@example.com"] });
    await expect(run(db)).rejects.toThrow("these accounts already exist: vornelle-reviewer@example.com");
    expect(db.writes).toEqual([]);
  });

  it("is not stopped by other organisations' accounts", async () => {
    const db = fakeDb({ emails: ["zentra-admin@example.com"] });
    await expect(run(db)).resolves.toBeUndefined();
  });

  it("does not connect when settings are missing", async () => {
    let opened = false;
    await expect(run(fakeDb(), { env: {}, openDb: () => (opened = true) })).rejects.toThrow("Preflight failed");
    expect(opened).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses if the lock is held, and leaves that lock in place", async () => {
    writeFileSync(lockPath, "");
    const db = fakeDb();
    await expect(run(db)).rejects.toThrow("another seed may be running");
    expect(db.writes).toEqual([]);
    expect(existsSync(lockPath)).toBe(true);
  });
});

describe("a successful seed", () => {
  it("writes accounts first, then each stage in order", async () => {
    const db = fakeDb();
    await run(db);
    expect(db.writes).toEqual([
      ...DEMO_USERS.map(({ email }) => `createUser ${email}`),
      "createOrganisation",
      "addRows memberships",
      "addRows rules",
      "addRows facts",
      "addRows assets",
      "approve rules",
      "approve facts",
      "approve assets",
    ]);
  });

  it("gives each account its role", async () => {
    const db = fakeDb();
    await run(db);
    expect(db.tables.memberships.map(({ user_id, role }) => [user_id, role])).toEqual(
      DEMO_USERS.map(({ email, role }) => [`id-${email}`, role]),
    );
  });

  it("keeps draft items as drafts", async () => {
    const db = fakeDb();
    await run(db);
    const drafts = (rows: Row[]) => rows.filter(({ status }) => status === "draft").map(({ code }) => code);
    expect(drafts(db.tables.rules)).toEqual(["MSG-09"]);
    expect(drafts(db.tables.facts)).toEqual(["FACT-06"]);
    expect(drafts(db.tables.assets)).toEqual(["CLR-05"]);
  });

  it("reports the counts it read back, and releases the lock", async () => {
    await run(fakeDb());
    expect(logs).toEqual([
      "Verified from the database: 1 organisation, 3 memberships, 12 rules, 6 facts, 5 colours, 18 revisions and 43 audit entries.",
    ]);
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe("a failed seed", () => {
  it.each([
    ["createUser vornelle-creator@example.com", "Create account vornelle-creator@example.com", 0],
    ["createUser vornelle-admin@example.com", "Create account vornelle-admin@example.com", 2],
    ["createOrganisation", "Create organisation", 3],
    ["addRows memberships", "Add memberships", 4],
    ["addRows rules", "Add rules as drafts", 5],
    ["approve rules", "Approve rules", 8],
    ["approve assets", "Approve assets", 10],
  ])("stops at %s and reports what finished", async (failAt, stage, finished) => {
    const db = fakeDb({ failAt });
    const failure = await run(db).catch((error) => error.message as string);

    expect(failure).toContain(`SEED FAILED at: ${stage}`);
    expect(failure).toContain("Reason: simulated failure");
    expect(failure).toContain("nothing was rolled back");
    expect(failure).toContain("Do not rerun");
    expect(db.writes).toHaveLength(finished);
    expect(logs).toEqual([]);
    expect(existsSync(lockPath)).toBe(false);
  });

  const failureAt = (failAt: string) => run(fakeDb({ failAt })).catch((error) => error.message as string);
  const [creator, reviewer, admin] = DEMO_USERS.map(({ email }) => email);

  it("reports the first account when the second fails", async () => {
    const failure = await failureAt(`createUser ${reviewer}`);
    expect(failure).toContain(`SEED FAILED at: Create account ${reviewer}`);
    expect(failure).toContain(`Created accounts: ${creator} = id-${creator}\n`);
    expect(failure).toContain("Created organisation: none");
    expect(failure).toContain("Recovery case: A");
  });

  it("reports two accounts when the third fails", async () => {
    const failure = await failureAt(`createUser ${admin}`);
    expect(failure).toContain(`Created accounts: ${creator} = id-${creator}; ${reviewer} = id-${reviewer}\n`);
    expect(failure).toContain("Recovery case: A");
  });

  it("reports all three accounts when the organisation fails", async () => {
    const failure = await failureAt("createOrganisation");
    expect(failure).toContain("SEED FAILED at: Create organisation");
    expect(failure).toContain(`Created accounts: ${creator} = id-${creator}; ${reviewer} = id-${reviewer}; ${admin} = id-${admin}\n`);
    expect(failure).toContain("Created organisation: none");
    expect(failure).toContain("Recovery case: A");
  });

  it("reports no accounts when the first fails", async () => {
    const failure = await failureAt(`createUser ${creator}`);
    expect(failure).toContain("Created accounts: none");
  });

  it.each([
    ["addRows memberships", "B"],
    ["addRows rules", "B"],
    ["addRows facts", "C"],
    ["addRows assets", "C"],
    ["approve rules", "C"],
    ["approve facts", "C"],
    ["approve assets", "C"],
  ])("reports the organisation and recovery case when %s fails", async (failAt, recovery) => {
    const failure = await failureAt(failAt);
    expect(failure).toContain("Created organisation: org-1");
    expect(failure).toContain(`Recovery case: ${recovery}`);
  });

  it("points to the recovery procedure, which covers every case", async () => {
    expect(await failureAt("createOrganisation")).toContain("docs/seed-recovery.md");
    const procedure = readFileSync("docs/seed-recovery.md", "utf8");
    for (const heading of ["## Case A", "## Case B", "## Case C", "## Case D"]) expect(procedure).toContain(heading);
  });

  it("never includes a secret in a report", async () => {
    const failure = await failureAt("approve facts");
    for (const name of ["DEMO_USER_PASSWORD", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"] as const) {
      expect(failure).not.toContain(env[name]);
    }
  });

  it("does not try to clean up after a failure", async () => {
    const db = fakeDb({ failAt: "addRows rules" });
    await run(db).catch(() => {});
    expect(db.writes.filter((write) => !write.startsWith("createUser") && !write.startsWith("createOrganisation"))).toEqual([
      "addRows memberships",
    ]);
    expect(db.tables.memberships).toHaveLength(3);
  });

  it("lists the completed stages", async () => {
    const failure = await run(fakeDb({ failAt: "addRows memberships" })).catch((error) => error.message as string);
    expect(failure).toContain(
      "Completed before the failure: Create account vornelle-creator@example.com; Create account vornelle-reviewer@example.com; Create account vornelle-admin@example.com; Create organisation",
    );
  });

  it("says nothing completed when the first write fails, as a parallel run would", async () => {
    const failure = await run(fakeDb({ failAt: "createUser vornelle-creator@example.com" })).catch((error) => error.message as string);
    expect(failure).toContain("Completed before the failure: nothing");
  });

  it("never claims success when the read-back disagrees", async () => {
    const db = fakeDb();
    const readBack = db.readBack;
    db.readBack = async () => ({ ...(await readBack()), organizations: [{ is_demo: true }, { is_demo: true }] });

    const failure = await run(db).catch((error) => error.message as string);
    expect(failure).toContain("SEED FAILED at: Verify by reading back");
    expect(failure).toContain("organisations: expected");
    expect(failure).toContain("Recovery case: D");
    expect(logs).toEqual([]);
  });

  it("never prints the password", async () => {
    const failure = await run(fakeDb({ failAt: "approve rules" })).catch((error) => error.message as string);
    expect(failure).not.toContain(env.DEMO_USER_PASSWORD);
  });
});

describe("verifySeed", () => {
  const userIds = Object.fromEntries(DEMO_USERS.map(({ email }) => [email, `id-${email}`]));
  const brand = (rows: Row[]) =>
    rows.map(({ code, status }) => ({
      code,
      status,
      version: 1,
      approved_by: status === "approved" ? "id-vornelle-admin@example.com" : null,
    }));
  const audit = Object.entries(expectedAudit() as Record<string, number>).flatMap(([action, count]) =>
    Array.from({ length: count }, () => ({ action })),
  );
  const good = {
    organizations: [{ is_demo: true }],
    memberships: DEMO_USERS.map(({ email, role }) => ({ user_id: `id-${email}`, role })),
    rules: brand(DEMO_RULES),
    facts: brand(DEMO_FACTS),
    assets: brand(DEMO_ASSETS).map(({ code, status, approved_by }) => ({ code, status, approved_by })),
    ruleRevisions: DEMO_RULES,
    factRevisions: DEMO_FACTS,
    audit,
  };

  it("expects 43 audit entries", () => {
    expect(audit).toHaveLength(43);
    expect(expectedAudit()).toEqual({
      "asset.approved": 4,
      "asset.created": 5,
      "fact.approved": 5,
      "fact.created": 6,
      "rule.approved": 11,
      "rule.created": 12,
    });
  });

  it("passes correct data", () => {
    expect(verifySeed(good, userIds)).toEqual([]);
  });

  it.each([
    ["organisations", { organizations: [] }],
    ["memberships", { memberships: good.memberships.map((row) => ({ ...row, role: "admin" })) }],
    ["rules", { rules: good.rules.slice(1) }],
    ["facts", { facts: good.facts.map((row) => ({ ...row, status: "draft", approved_by: null })) }],
    ["assets", { assets: good.assets.map((row) => ({ ...row, approved_by: "someone-else" })) }],
    ["rule revisions", { ruleRevisions: [] }],
    ["fact revisions", { factRevisions: [] }],
    ["audit entries", { audit: audit.slice(1) }],
  ])("reports wrong %s", (label, change) => {
    const problems = verifySeed({ ...good, ...change }, userIds);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`${label}: expected`);
  });
});

describe("the seed script source", () => {
  const source = readFileSync("scripts/seed-demo.mjs", "utf8");

  it("has no path that overwrites accounts, memberships or rows", () => {
    expect(source).not.toMatch(/updateUserById|\.upsert\(|ignoreDuplicates/);
  });

  it("has no path that deletes accounts or rows", () => {
    expect(source).not.toMatch(/deleteUser|\.delete\(/);
  });

  it("does not generate or store passwords", () => {
    expect(source).not.toMatch(/randomBytes|appendFileSync/);
  });

  it("only ever updates status, as the Demo Admin", () => {
    expect(source.match(/\.update\(/g)).toHaveLength(1);
    expect(source).toContain('admin.from(table).update({ status: "approved" })');
  });

  it("uses the Vornelle organisation name", () => {
    expect(DEMO_ORG_NAME).toBe("Vornelle (Fictional Demo)");
  });
});
