import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const EMAIL_PREFIX = "rls-test-";
const ORG_A = "Fictional RLS Test Organisation A";
const ORG_B = "Fictional RLS Test Organisation B";
const PERSONAS = {
  adminA: { org: ORG_A, role: "admin" },
  reviewerA: { org: ORG_A, role: "reviewer" },
  creatorA: { org: ORG_A, role: "creator" },
  targetA: { org: ORG_A, role: "creator" },
  adminB: { org: ORG_B, role: "admin" },
  creatorB: { org: ORG_B, role: "creator" },
  outsider: { org: null, role: null },
} as const;
type Persona = keyof typeof PERSONAS;

const newClient = (key: string) =>
  createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const service = newClient(serviceKey);
const anon = newClient(publishableKey);
const as = {} as Record<Persona, SupabaseClient>;
const ids = {} as Record<Persona, string>;
const orgIds = {} as Record<string, string>;
const auditMarker = `rls-run-${randomUUID()}`;
// A sequence cannot repeat within a run, unlike separate random codes.
let nextCode = 1000 + Math.floor(Math.random() * 8000);
const unique = () => `TST-${nextCode++}`;
const succeed = async (request: PromiseLike<{ error: unknown }>) => {
  expect((await request).error).toBeNull();
};

async function deleteTestUsers() {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error("Could not list test users");
  for (const user of data.users) {
    if (user.email?.startsWith(EMAIL_PREFIX)) await service.auth.admin.deleteUser(user.id);
  }
}

async function findOrCreateOrg(name: string) {
  const found = await service.from("organizations").select("id").eq("name", name).maybeSingle();
  if (found.data) return found.data.id as string;
  const created = await service.from("organizations").insert({ name, is_demo: true }).select("id").single();
  if (created.error) throw new Error("Could not create test organisation");
  return created.data.id as string;
}

const roleOf = async (orgName: string, persona: Persona) => {
  const { data } = await service
    .from("memberships")
    .select("role")
    .eq("org_id", orgIds[orgName])
    .eq("user_id", ids[persona])
    .single();
  return data?.role;
};

const orgName = async (name: string) => {
  const { data } = await service.from("organizations").select("name").eq("id", orgIds[name]).single();
  return data?.name;
};

beforeAll(async () => {
  await deleteTestUsers();
  orgIds[ORG_A] = await findOrCreateOrg(ORG_A);
  orgIds[ORG_B] = await findOrCreateOrg(ORG_B);

  for (const [persona, { org, role }] of Object.entries(PERSONAS) as [Persona, (typeof PERSONAS)[Persona]][]) {
    const email = `${EMAIL_PREFIX}${persona.toLowerCase()}-${randomUUID()}@example.com`;
    const password = randomBytes(24).toString("base64url");
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error(`Could not create ${persona}`);
    ids[persona] = created.data.user.id;

    if (org) {
      const member = await service
        .from("memberships")
        .insert({ org_id: orgIds[org], user_id: ids[persona], role });
      if (member.error) throw new Error(`Could not add ${persona}`);
    }

    as[persona] = newClient(publishableKey);
    const signedIn = await as[persona].auth.signInWithPassword({ email, password });
    if (signedIn.error) throw new Error(`Could not sign in ${persona}`);
  }

  for (const org of [ORG_A, ORG_B]) {
    const audit = await service.from("audit_log").insert({
      org_id: orgIds[org],
      action: "rls.test",
      entity_type: "test",
      entity_id: auditMarker,
    });
    if (audit.error) throw new Error("Could not write test audit row");
  }
});

afterAll(async () => {
  await service.from("organizations").update({ name: ORG_A }).eq("id", orgIds[ORG_A]);
  await deleteTestUsers();
});

describe("anonymous visitors", () => {
  it.each(["organizations", "memberships", "audit_log"])("cannot read %s", async (table) => {
    const { error } = await anon.from(table).select("*");
    expect(error?.code).toBe("42501");
  });

  it("cannot write", async () => {
    const { error } = await anon.from("organizations").insert({ name: "Intruder" });
    expect(error?.code).toBe("42501");
  });
});

describe("signed-in user with no membership", () => {
  it.each(["organizations", "memberships", "audit_log"])("sees nothing in %s", async (table) => {
    const { data, error } = await as.outsider.from(table).select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe("cross-organisation isolation", () => {
  it("shows each member only their own organisation", async () => {
    const a = await as.creatorA.from("organizations").select("id");
    const b = await as.creatorB.from("organizations").select("id");
    expect(a.data).toEqual([{ id: orgIds[ORG_A] }]);
    expect(b.data).toEqual([{ id: orgIds[ORG_B] }]);
  });

  it("hides another organisation even when asked for by ID", async () => {
    const { data } = await as.adminA.from("organizations").select("id").eq("id", orgIds[ORG_B]);
    expect(data).toEqual([]);
  });

  it("hides another organisation's members", async () => {
    const { data } = await as.adminA.from("memberships").select("org_id, user_id");
    expect(data?.length).toBe(4);
    expect(data?.every((row) => row.org_id === orgIds[ORG_A])).toBe(true);
    const direct = await as.adminA.from("memberships").select("user_id").eq("org_id", orgIds[ORG_B]);
    expect(direct.data).toEqual([]);
  });

  it("hides another organisation's audit log", async () => {
    const { data } = await as.adminA.from("audit_log").select("org_id").eq("entity_id", auditMarker);
    expect(data).toEqual([{ org_id: orgIds[ORG_A] }]);
  });

  it("stops an admin renaming another organisation", async () => {
    const { data } = await as.adminA.from("organizations").update({ name: "Taken" }).eq("id", orgIds[ORG_B]).select();
    expect(data).toEqual([]);
    expect(await orgName(ORG_B)).toBe(ORG_B);
  });

  it("stops an admin changing a role in another organisation", async () => {
    const { data } = await as.adminA
      .from("memberships")
      .update({ role: "admin" })
      .eq("user_id", ids.creatorB)
      .select();
    expect(data).toEqual([]);
    expect(await roleOf(ORG_B, "creatorB")).toBe("creator");
  });
});

describe("Creator", () => {
  it("reads their organisation and its members", async () => {
    expect((await as.creatorA.from("organizations").select("id")).data?.length).toBe(1);
    expect((await as.creatorA.from("memberships").select("user_id")).data?.length).toBe(4);
  });

  it("cannot read the audit log", async () => {
    const { data, error } = await as.creatorA.from("audit_log").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot rename the organisation", async () => {
    const { data } = await as.creatorA.from("organizations").update({ name: "Nope" }).eq("id", orgIds[ORG_A]).select();
    expect(data).toEqual([]);
    expect(await orgName(ORG_A)).toBe(ORG_A);
  });

  it("cannot promote themselves", async () => {
    const { data } = await as.creatorA
      .from("memberships")
      .update({ role: "admin" })
      .eq("user_id", ids.creatorA)
      .select();
    expect(data).toEqual([]);
    expect(await roleOf(ORG_A, "creatorA")).toBe("creator");
  });
});

describe("Reviewer", () => {
  it("reads the audit log for their organisation", async () => {
    const { data } = await as.reviewerA.from("audit_log").select("org_id").eq("entity_id", auditMarker);
    expect(data).toEqual([{ org_id: orgIds[ORG_A] }]);
  });

  it("cannot rename the organisation", async () => {
    const { data } = await as.reviewerA.from("organizations").update({ name: "Nope" }).eq("id", orgIds[ORG_A]).select();
    expect(data).toEqual([]);
    expect(await orgName(ORG_A)).toBe(ORG_A);
  });

  it("cannot change roles, including their own", async () => {
    for (const persona of ["reviewerA", "targetA"] as const) {
      const { data } = await as.reviewerA.from("memberships").update({ role: "admin" }).eq("user_id", ids[persona]).select();
      expect(data).toEqual([]);
    }
    expect(await roleOf(ORG_A, "reviewerA")).toBe("reviewer");
    expect(await roleOf(ORG_A, "targetA")).toBe("creator");
  });
});

describe("Admin", () => {
  it("reads the audit log for their organisation", async () => {
    const { data } = await as.adminA.from("audit_log").select("org_id").eq("entity_id", auditMarker);
    expect(data).toEqual([{ org_id: orgIds[ORG_A] }]);
  });

  it("renames their organisation", async () => {
    const renamed = `${ORG_A} renamed`;
    const { data, error } = await as.adminA.from("organizations").update({ name: renamed }).eq("id", orgIds[ORG_A]).select("name");
    expect(error).toBeNull();
    expect(data).toEqual([{ name: renamed }]);
    await as.adminA.from("organizations").update({ name: ORG_A }).eq("id", orgIds[ORG_A]);
    expect(await orgName(ORG_A)).toBe(ORG_A);
  });

  it("changes another member's role", async () => {
    const { data, error } = await as.adminA.from("memberships").update({ role: "reviewer" }).eq("user_id", ids.targetA).select("role");
    expect(error).toBeNull();
    expect(data).toEqual([{ role: "reviewer" }]);
    await as.adminA.from("memberships").update({ role: "creator" }).eq("user_id", ids.targetA);
    expect(await roleOf(ORG_A, "targetA")).toBe("creator");
  });

  it("cannot change their own role", async () => {
    const { data } = await as.adminA.from("memberships").update({ role: "creator" }).eq("user_id", ids.adminA).select();
    expect(data).toEqual([]);
    expect(await roleOf(ORG_A, "adminA")).toBe("admin");
  });

  it("cannot raise the check limit or change the demo flag", async () => {
    for (const change of [{ daily_check_limit: 99999 }, { is_demo: false }]) {
      const { error } = await as.adminA.from("organizations").update(change).eq("id", orgIds[ORG_A]);
      expect(error?.code).toBe("42501");
    }
  });

  it("cannot move a member to another organisation", async () => {
    const { error } = await as.adminA.from("memberships").update({ org_id: orgIds[ORG_B] }).eq("user_id", ids.targetA);
    expect(error?.code).toBe("42501");
  });

  it("cannot create or delete organisations", async () => {
    const created = await as.adminA.from("organizations").insert({ name: "New" });
    const deleted = await as.adminA.from("organizations").delete().eq("id", orgIds[ORG_A]);
    expect(created.error?.code).toBe("42501");
    expect(deleted.error?.code).toBe("42501");
  });

  it("cannot add or remove members directly", async () => {
    const added = await as.adminA.from("memberships").insert({ org_id: orgIds[ORG_A], user_id: ids.outsider, role: "admin" });
    const removed = await as.adminA.from("memberships").delete().eq("user_id", ids.targetA);
    expect(added.error?.code).toBe("42501");
    expect(removed.error?.code).toBe("42501");
  });
});

describe("Rulebook", () => {
  const content = {
    type: "messaging",
    severity: "high",
    title: "Fictional test rule",
    instruction: "Superlatives need an approved source.",
    source_excerpt: "Fictional guide excerpt.",
    source_name: "Fictional test guide",
  };
  let approved: { id: string; code: string };
  let draft: { id: string; code: string };
  let otherOrg: { id: string; code: string };

  const addRule = async (org: string, status: string) => {
    const { data, error } = await service
      .from("rules")
      .insert({ ...content, org_id: orgIds[org], code: unique(), status })
      .select("id, code")
      .single();
    if (error) throw new Error(`Could not add test rule: ${error.code}`);
    return data;
  };
  const rule = async (id: string) => (await service.from("rules").select("*").eq("id", id).single()).data;

  beforeAll(async () => {
    approved = await addRule(ORG_A, "approved");
    draft = await addRule(ORG_A, "draft");
    otherOrg = await addRule(ORG_B, "approved");
  });

  afterAll(async () => {
    await service.from("rules").delete().in("org_id", [orgIds[ORG_A], orgIds[ORG_B]]);
  });

  it("is closed to anonymous visitors", async () => {
    for (const table of ["rules", "rule_revisions"]) {
      expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    }
  });

  it("shows a Creator approved rules only", async () => {
    const { data } = await as.creatorA.from("rules").select("id").in("id", [approved.id, draft.id]);
    expect(data).toEqual([{ id: approved.id }]);
  });

  it("shows Reviewers and Admins drafts too", async () => {
    for (const persona of ["reviewerA", "adminA"] as const) {
      const { data } = await as[persona].from("rules").select("id").in("id", [approved.id, draft.id]);
      expect(data?.length).toBe(2);
    }
  });

  it("hides rules from other organisations and non-members", async () => {
    expect((await as.adminA.from("rules").select("id").eq("id", otherOrg.id)).data).toEqual([]);
    expect((await as.outsider.from("rules").select("id")).data).toEqual([]);
  });

  it("lets only Admins add rules, always as drafts", async () => {
    const row = { ...content, org_id: orgIds[ORG_A], code: unique() };
    for (const persona of ["creatorA", "reviewerA", "adminB", "outsider"] as const) {
      expect((await as[persona].from("rules").insert(row)).error?.code).toBe("42501");
    }
    const { data, error } = await as.adminA.from("rules").insert(row).select("status, version, created_by").single();
    expect(error).toBeNull();
    expect(data).toEqual({ status: "draft", version: 1, created_by: ids.adminA });
  });

  it("stops anyone choosing a status, version or author on insert", async () => {
    for (const extra of [{ status: "approved" }, { version: 9 }, { created_by: ids.creatorA }]) {
      const row: Record<string, unknown> = { ...content, org_id: orgIds[ORG_A], code: unique(), ...extra };
      expect((await as.adminA.from("rules").insert(row)).error?.code).toBe("42501");
    }
  });

  it("rejects invalid rule codes and duplicates", async () => {
    const invalid = await as.adminA.from("rules").insert({ ...content, org_id: orgIds[ORG_A], code: "not a code" });
    expect(invalid.error?.code).toBe("23514");
    const duplicate = await as.adminA.from("rules").insert({ ...content, org_id: orgIds[ORG_A], code: draft.code });
    expect(duplicate.error?.code).toBe("23505");
  });

  it("stops non-Admins approving or editing", async () => {
    for (const persona of ["creatorA", "reviewerA", "adminB"] as const) {
      const { data } = await as[persona].from("rules").update({ status: "approved" }).eq("id", draft.id).select();
      expect(data).toEqual([]);
    }
    expect((await rule(draft.id))?.status).toBe("draft");
  });

  it("records who approved a rule, and audits it", async () => {
    const target = await addRule(ORG_A, "draft");
    const { error } = await as.adminA.from("rules").update({ status: "approved" }).eq("id", target.id);
    expect(error).toBeNull();
    const saved = await rule(target.id);
    expect(saved?.status).toBe("approved");
    expect(saved?.approved_by).toBe(ids.adminA);
    expect(saved?.approved_at).not.toBeNull();

    const { data } = await as.reviewerA.from("audit_log").select("action, actor_id").eq("entity_id", target.code);
    expect(data).toContainEqual({ action: "rule.approved", actor_id: ids.adminA });
  });

  it("sends an edited approved rule back to draft as a new version", async () => {
    const target = await addRule(ORG_A, "approved");
    const { error } = await as.adminA.from("rules").update({ title: "Changed title" }).eq("id", target.id);
    expect(error).toBeNull();
    const saved = await rule(target.id);
    expect(saved).toMatchObject({ status: "draft", version: 2, title: "Changed title", approved_by: null });

    const { data } = await as.reviewerA.from("rule_revisions").select("version").eq("rule_id", target.id).order("version");
    expect(data).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("cannot approve and edit in one step", async () => {
    const target = await addRule(ORG_A, "draft");
    await succeed(as.adminA.from("rules").update({ title: "Sneaky edit", status: "approved" }).eq("id", target.id));
    expect((await rule(target.id))?.status).toBe("draft");
  });

  it("does not create a version when only the status changes", async () => {
    const target = await addRule(ORG_A, "draft");
    await succeed(as.adminA.from("rules").update({ status: "approved" }).eq("id", target.id));
    await succeed(as.adminA.from("rules").update({ status: "retired" }).eq("id", target.id));
    expect(await rule(target.id)).toMatchObject({ status: "retired", version: 1, approved_by: null });
  });

  it("stops non-Admins retiring or restoring rules", async () => {
    const active = await addRule(ORG_A, "approved");
    const retired = await addRule(ORG_A, "retired");
    for (const persona of ["creatorA", "reviewerA", "adminB", "outsider"] as const) {
      await as[persona].from("rules").update({ status: "retired" }).eq("id", active.id);
      await as[persona].from("rules").update({ status: "draft" }).eq("id", retired.id);
    }
    expect((await rule(active.id))?.status).toBe("approved");
    expect((await rule(retired.id))?.status).toBe("retired");
  });

  it("makes a retired rule go through draft before approval", async () => {
    const target = await addRule(ORG_A, "retired");
    const direct = await as.adminA.from("rules").update({ status: "approved" }).eq("id", target.id);
    expect(direct.error?.code).toBe("23514");
    expect((await rule(target.id))?.status).toBe("retired");

    expect((await as.adminA.from("rules").update({ status: "draft" }).eq("id", target.id)).error).toBeNull();
    expect((await as.adminA.from("rules").update({ status: "approved" }).eq("id", target.id)).error).toBeNull();
    expect(await rule(target.id)).toMatchObject({ status: "approved", approved_by: ids.adminA });
  });

  it("stops a retired rule being edited", async () => {
    const target = await addRule(ORG_A, "retired");
    const edit = await as.adminA.from("rules").update({ title: "Changed" }).eq("id", target.id);
    expect(edit.error?.code).toBe("23514");
    expect(await rule(target.id)).toMatchObject({ status: "retired", version: 1, title: content.title });
  });

  it("does not apply an approval to a version the Admin did not see", async () => {
    const target = await addRule(ORG_A, "draft");
    await succeed(as.adminA.from("rules").update({ title: "Edited by another Admin" }).eq("id", target.id));
    const stale = await as.adminA
      .from("rules")
      .update({ status: "approved" })
      .eq("id", target.id)
      .eq("version", 1)
      .select("id");
    expect(stale.data).toEqual([]);
    expect(await rule(target.id)).toMatchObject({ status: "draft", version: 2 });
  });

  it("protects the code, organisation, version and approval fields", async () => {
    for (const change of [
      { code: "ZZ-99" },
      { org_id: orgIds[ORG_B] },
      { version: 9 },
      { approved_by: ids.creatorA },
      { created_by: ids.creatorA },
    ]) {
      expect((await as.adminA.from("rules").update(change).eq("id", draft.id)).error?.code).toBe("42501");
    }
  });

  it("has no client delete", async () => {
    expect((await as.adminA.from("rules").delete().eq("id", draft.id)).error?.code).toBe("42501");
  });

  it("keeps rule history from Creators and other organisations", async () => {
    expect((await as.creatorA.from("rule_revisions").select("rule_id")).data).toEqual([]);
    expect((await as.adminB.from("rule_revisions").select("rule_id").eq("rule_id", approved.id)).data).toEqual([]);
    const { data } = await as.reviewerA.from("rule_revisions").select("rule_id").eq("rule_id", approved.id);
    expect(data?.length).toBe(1);
  });

  it("gives clients no write access to rule history", async () => {
    const write = { rule_id: approved.id, version: 99, org_id: orgIds[ORG_A], snapshot: {} };
    expect((await as.adminA.from("rule_revisions").insert(write)).error?.code).toBe("42501");
    expect((await as.adminA.from("rule_revisions").delete().eq("rule_id", approved.id)).error?.code).toBe("42501");
  });
});

describe("Claim Ledger", () => {
  const content = {
    statement: "Fictional fee is zero.",
    source_name: "Fictional fee schedule",
    valid_from: "2026-01-01",
  };
  let approved: { id: string; code: string };
  let draft: { id: string; code: string };
  let otherOrg: { id: string; code: string };

  const addFact = async (org: string, status: string) => {
    const { data, error } = await service
      .from("facts")
      .insert({ ...content, org_id: orgIds[org], code: unique(), status })
      .select("id, code")
      .single();
    if (error) throw new Error(`Could not add test fact: ${error.code}`);
    return data;
  };
  const fact = async (id: string) => (await service.from("facts").select("*").eq("id", id).single()).data;

  beforeAll(async () => {
    approved = await addFact(ORG_A, "approved");
    draft = await addFact(ORG_A, "draft");
    otherOrg = await addFact(ORG_B, "approved");
  });

  afterAll(async () => {
    await service.from("facts").delete().in("org_id", [orgIds[ORG_A], orgIds[ORG_B]]);
  });

  it("is closed to anonymous visitors", async () => {
    for (const table of ["facts", "fact_revisions"]) {
      expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    }
  });

  it("shows a Creator approved facts only", async () => {
    const { data } = await as.creatorA.from("facts").select("id").in("id", [approved.id, draft.id]);
    expect(data).toEqual([{ id: approved.id }]);
  });

  it("shows Reviewers drafts, and hides other organisations", async () => {
    const { data } = await as.reviewerA.from("facts").select("id").in("id", [approved.id, draft.id]);
    expect(data?.length).toBe(2);
    expect((await as.adminA.from("facts").select("id").eq("id", otherOrg.id)).data).toEqual([]);
    expect((await as.outsider.from("facts").select("id")).data).toEqual([]);
  });

  it("lets only Admins add facts, always as drafts", async () => {
    const row = { ...content, org_id: orgIds[ORG_A], code: unique() };
    for (const persona of ["creatorA", "reviewerA", "adminB", "outsider"] as const) {
      expect((await as[persona].from("facts").insert(row)).error?.code).toBe("42501");
    }
    const { data, error } = await as.adminA.from("facts").insert(row).select("status, version, created_by").single();
    expect(error).toBeNull();
    expect(data).toEqual({ status: "draft", version: 1, created_by: ids.adminA });
  });

  it("rejects script links and impossible dates", async () => {
    const script = { ...content, org_id: orgIds[ORG_A], code: unique(), source_url: "javascript:alert(1)" };
    expect((await as.adminA.from("facts").insert(script)).error?.code).toBe("23514");
    const dates = { ...content, org_id: orgIds[ORG_A], code: unique(), expires_on: "2025-01-01" };
    expect((await as.adminA.from("facts").insert(dates)).error?.code).toBe("23514");
  });

  it("stops non-Admins changing status", async () => {
    for (const persona of ["creatorA", "reviewerA", "adminB", "outsider"] as const) {
      await as[persona].from("facts").update({ status: "approved" }).eq("id", draft.id);
      await as[persona].from("facts").update({ status: "retired" }).eq("id", approved.id);
    }
    expect((await fact(draft.id))?.status).toBe("draft");
    expect((await fact(approved.id))?.status).toBe("approved");
  });

  it("records who approved a fact, and audits it", async () => {
    const target = await addFact(ORG_A, "draft");
    await succeed(as.adminA.from("facts").update({ status: "approved" }).eq("id", target.id));
    expect(await fact(target.id)).toMatchObject({ status: "approved", approved_by: ids.adminA });
    const { data } = await as.reviewerA.from("audit_log").select("action, actor_id").eq("entity_id", target.code);
    expect(data).toContainEqual({ action: "fact.approved", actor_id: ids.adminA });
  });

  it("sends an edited approved fact back to draft as a new version", async () => {
    const target = await addFact(ORG_A, "approved");
    await succeed(as.adminA.from("facts").update({ expires_on: "2030-01-01", status: "approved" }).eq("id", target.id));
    expect(await fact(target.id)).toMatchObject({ status: "draft", version: 2, approved_by: null });
    const { data } = await as.reviewerA.from("fact_revisions").select("version").eq("fact_id", target.id).order("version");
    expect(data).toEqual([{ version: 1 }, { version: 2 }]);
  });

  it("makes a retired fact go through draft", async () => {
    const target = await addFact(ORG_A, "retired");
    expect((await as.adminA.from("facts").update({ status: "approved" }).eq("id", target.id)).error?.code).toBe("23514");
    expect((await as.adminA.from("facts").update({ statement: "New" }).eq("id", target.id)).error?.code).toBe("23514");
    expect((await as.adminA.from("facts").update({ status: "draft" }).eq("id", target.id)).error).toBeNull();
    expect(await fact(target.id)).toMatchObject({ status: "draft", version: 1 });
  });

  it("protects identity, version and approval fields, and has no client delete", async () => {
    for (const change of [{ code: "ZZ-99" }, { org_id: orgIds[ORG_B] }, { version: 9 }, { approved_by: ids.creatorA }]) {
      expect((await as.adminA.from("facts").update(change).eq("id", draft.id)).error?.code).toBe("42501");
    }
    expect((await as.adminA.from("facts").delete().eq("id", draft.id)).error?.code).toBe("42501");
  });

  it("keeps history from Creators and other organisations, and read-only for everyone", async () => {
    expect((await as.creatorA.from("fact_revisions").select("fact_id")).data).toEqual([]);
    expect((await as.adminB.from("fact_revisions").select("fact_id").eq("fact_id", approved.id)).data).toEqual([]);
    const write = { fact_id: approved.id, version: 99, org_id: orgIds[ORG_A], snapshot: {} };
    expect((await as.adminA.from("fact_revisions").insert(write)).error?.code).toBe("42501");
  });
});

describe("Assets", () => {
  const addAsset = async (org: string, status: string) => {
    const { data, error } = await service
      .from("assets")
      .insert({ org_id: orgIds[org], code: unique(), name: "Fictional colour", value: "#112233", status })
      .select("id, code")
      .single();
    if (error) throw new Error(`Could not add test asset: ${error.code}`);
    return data;
  };
  const asset = async (id: string) => (await service.from("assets").select("*").eq("id", id).single()).data;

  afterAll(async () => {
    await service.from("assets").delete().in("org_id", [orgIds[ORG_A], orgIds[ORG_B]]);
  });

  it("is closed to anonymous visitors", async () => {
    expect((await anon.from("assets").select("*")).error?.code).toBe("42501");
  });

  it("shows a Creator approved assets from their organisation only", async () => {
    const shown = await addAsset(ORG_A, "approved");
    const hidden = await addAsset(ORG_A, "draft");
    const other = await addAsset(ORG_B, "approved");
    const { data } = await as.creatorA.from("assets").select("id").in("id", [shown.id, hidden.id, other.id]);
    expect(data).toEqual([{ id: shown.id }]);
    const reviewer = await as.reviewerA.from("assets").select("id").in("id", [shown.id, hidden.id, other.id]);
    expect(reviewer.data?.length).toBe(2);
  });

  it("lets only Admins add assets, always as drafts", async () => {
    const row = { org_id: orgIds[ORG_A], code: unique(), name: "New", value: "#ABCDEF" };
    for (const persona of ["creatorA", "reviewerA", "adminB"] as const) {
      expect((await as[persona].from("assets").insert(row)).error?.code).toBe("42501");
    }
    const { data } = await as.adminA.from("assets").insert(row).select("status, created_by").single();
    expect(data).toEqual({ status: "draft", created_by: ids.adminA });
  });

  it("rejects invalid colours", async () => {
    const row = { org_id: orgIds[ORG_A], code: unique(), name: "Bad", value: "red" };
    expect((await as.adminA.from("assets").insert(row)).error?.code).toBe("23514");
  });

  it("stops non-Admins approving, and records the approver", async () => {
    const target = await addAsset(ORG_A, "draft");
    for (const persona of ["creatorA", "reviewerA", "adminB"] as const) {
      await as[persona].from("assets").update({ status: "approved" }).eq("id", target.id);
    }
    expect((await asset(target.id))?.status).toBe("draft");
    await succeed(as.adminA.from("assets").update({ status: "approved" }).eq("id", target.id));
    expect(await asset(target.id)).toMatchObject({ status: "approved", approved_by: ids.adminA });
  });

  it("keeps assets immutable, with no client delete", async () => {
    const target = await addAsset(ORG_A, "approved");
    for (const change of [{ value: "#000000" }, { name: "Changed" }, { code: "ZZ-99" }, { approved_by: ids.creatorA }]) {
      expect((await as.adminA.from("assets").update(change).eq("id", target.id)).error?.code).toBe("42501");
    }
    expect((await as.adminA.from("assets").delete().eq("id", target.id)).error?.code).toBe("42501");
  });

  it("makes a retired asset go through draft", async () => {
    const target = await addAsset(ORG_A, "retired");
    expect((await as.adminA.from("assets").update({ status: "approved" }).eq("id", target.id)).error?.code).toBe("23514");
    expect((await as.adminA.from("assets").update({ status: "draft" }).eq("id", target.id)).error).toBeNull();
  });
});

describe("Documents and checks", () => {
  const secret = process.env.CHECK_WRITER_SECRET!;
  const createArgs = (org: string) => ({
    p_org_id: orgIds[org],
    p_title: "Fictional launch email",
    p_source_type: "text",
    p_text: "Fictional draft text.",
    p_images: [],
    p_colours: [],
    p_synthetic: true,
  });
  const finding = {
    origin: "rule",
    category: "terminology",
    severity: "medium",
    quote: "draft",
    start_offset: 10,
    end_offset: 15,
    rule_id: null,
    rule_version: 1,
    explanation: "Fictional explanation.",
    suggestion: "Fictional suggestion.",
    citation: { code: "TST-01" },
  };
  const recordArgs = (versionId: string, overrides = {}) => ({
    p_secret: secret,
    p_version_id: versionId,
    p_status: "partial",
    p_failure_reason: "ai_not_run",
    p_provider: null,
    p_model: null,
    p_dropped_count: 0,
    p_findings: [finding],
    ...overrides,
  });

  let created: { document_id: string; version_id: string };
  let otherOrg: { document_id: string; version_id: string };

  beforeAll(async () => {
    const own = await as.creatorA.rpc("create_document", createArgs(ORG_A));
    const other = await as.creatorB.rpc("create_document", createArgs(ORG_B));
    if (own.error || other.error) throw new Error(`Could not create documents: ${own.error?.code ?? other.error?.code}`);
    created = own.data;
    otherOrg = other.data;
    const recorded = await as.creatorA.rpc("record_check_run", recordArgs(created.version_id));
    if (recorded.error) throw new Error(`Could not record run: ${recorded.error.code}`);
  });

  afterAll(async () => {
    await service.from("documents").delete().in("org_id", [orgIds[ORG_A], orgIds[ORG_B]]);
  });

  it("records the author, version and synthetic confirmation", async () => {
    const document = await service.from("documents").select("*").eq("id", created.document_id).single();
    const version = await service.from("document_versions").select("*").eq("id", created.version_id).single();
    expect(document.data).toMatchObject({ created_by: ids.creatorA, status: "draft" });
    expect(version.data).toMatchObject({ number: 1, created_by: ids.creatorA, synthetic_confirmed_by: ids.creatorA });
    expect(version.data?.synthetic_confirmed_at).not.toBeNull();
  });

  it("leaves the confirmation empty when it was not given", async () => {
    const { data } = await as.creatorA.rpc("create_document", { ...createArgs(ORG_A), p_synthetic: false });
    const version = await service.from("document_versions").select("*").eq("id", data.version_id).single();
    expect(version.data).toMatchObject({ synthetic_confirmed_by: null, synthetic_confirmed_at: null });
  });

  it("is closed to anonymous visitors", async () => {
    for (const table of ["documents", "document_versions", "check_runs", "findings"]) {
      expect((await anon.from(table).select("*")).error?.code).toBe("42501");
    }
    expect((await anon.rpc("create_document", createArgs(ORG_A))).error?.code).toBe("42501");
    expect((await anon.rpc("record_check_run", recordArgs(created.version_id))).error?.code).toBe("42501");
  });

  it("stops anyone creating documents outside their organisation", async () => {
    expect((await as.creatorA.rpc("create_document", createArgs(ORG_B))).error?.code).toBe("42501");
    expect((await as.outsider.rpc("create_document", createArgs(ORG_A))).error?.code).toBe("42501");
  });

  it("shows a document to its author, Reviewers and Admins only", async () => {
    for (const table of ["documents", "document_versions", "check_runs", "findings"]) {
      const column = table === "documents" ? "id" : "document_id";
      const read = (persona: Persona) => as[persona].from(table).select(column).eq(column, created.document_id);
      expect((await read("creatorA")).data?.length).toBe(1);
      expect((await read("reviewerA")).data?.length).toBe(1);
      expect((await read("adminA")).data?.length).toBe(1);
      expect((await read("targetA")).data).toEqual([]);
      expect((await read("adminB")).data).toEqual([]);
      expect((await read("outsider")).data).toEqual([]);
    }
  });

  it("gives clients no direct write access", async () => {
    const attempts = [
      as.adminA.from("documents").insert({ org_id: orgIds[ORG_A], title: "X", created_by: ids.adminA }),
      as.adminA.from("documents").update({ status: "approved" }).eq("id", created.document_id),
      as.adminA.from("documents").delete().eq("id", created.document_id),
      as.adminA.from("document_versions").update({ plain_text: "Changed" }).eq("id", created.version_id),
      as.adminA.from("document_versions").delete().eq("id", created.version_id),
      as.adminA.from("check_runs").insert({ document_id: created.document_id, version_id: created.version_id, org_id: orgIds[ORG_A], status: "complete" }),
      as.adminA.from("check_runs").update({ status: "complete" }).eq("document_id", created.document_id),
      as.adminA.from("findings").update({ state: "dismissed" }).eq("document_id", created.document_id),
      as.adminA.from("findings").delete().eq("document_id", created.document_id),
    ];
    for (const attempt of attempts) expect((await attempt).error?.code).toBe("42501");
  });

  it("stops a user recording a fake clean run", async () => {
    for (const wrong of ["", "guess", `${secret}x`, null]) {
      const args = recordArgs(created.version_id, { p_secret: wrong, p_status: "complete", p_findings: [] });
      expect((await as.creatorA.rpc("record_check_run", args)).error?.code).toBe("42501");
    }
    const runs = await service.from("check_runs").select("status").eq("document_id", created.document_id);
    expect(runs.data).toEqual([{ status: "partial" }]);
  });

  it("does not expose the writer hash", async () => {
    const { error } = await as.adminA.schema("private" as "public").from("check_writer").select("*");
    expect(error).not.toBeNull();
  });

  it("stores findings with their citation, and audits the run", async () => {
    const { data } = await as.creatorA.from("findings").select("quote, citation, state, org_id").eq("document_id", created.document_id);
    expect(data).toEqual([{ quote: "draft", citation: { code: "TST-01" }, state: "open", org_id: orgIds[ORG_A] }]);
    const audit = await as.reviewerA.from("audit_log").select("action, actor_id").eq("entity_id", created.document_id);
    expect(audit.data).toContainEqual({ action: "document.created", actor_id: ids.creatorA });
    expect(audit.data).toContainEqual({ action: "check.partial", actor_id: ids.creatorA });
  });

  it("rejects an unknown version and a bad status", async () => {
    const unknown = recordArgs(randomUUID());
    expect((await as.creatorA.rpc("record_check_run", unknown)).error?.code).toBe("23503");
    const bad = recordArgs(created.version_id, { p_status: "clean" });
    expect((await as.creatorA.rpc("record_check_run", bad)).error?.code).toBe("23514");
  });

  it("keeps findings in the document's own organisation", async () => {
    await succeed(as.creatorB.rpc("record_check_run", recordArgs(otherOrg.version_id)));
    const { data } = await as.creatorB.from("findings").select("org_id").eq("document_id", otherOrg.document_id);
    expect(data).toEqual([{ org_id: orgIds[ORG_B] }]);
  });
});

describe("Review workflow", () => {
  const secret = process.env.CHECK_WRITER_SECRET!;
  const baseFinding = {
    origin: "rule",
    category: "terminology",
    quote: "draft",
    start_offset: 10,
    end_offset: 15,
    rule_id: null,
    rule_version: 1,
    explanation: "Fictional explanation.",
    suggestion: "Fictional suggestion.",
    replacement: "version",
    citation: { code: "TST-01" },
  };

  const newDocument = async (author: Persona, severity = "medium") => {
    const org = PERSONAS[author].org!;
    const created = await as[author].rpc("create_document", {
      p_org_id: orgIds[org],
      p_title: "Fictional review document",
      p_source_type: "text",
      p_text: "Fictional draft text.",
      p_images: [],
      p_colours: [],
      p_synthetic: true,
    });
    if (created.error) throw new Error(`Could not create document: ${created.error.code}`);
    const { document_id: id, version_id: versionId } = created.data;
    const run = await as[author].rpc("record_check_run", {
      p_secret: secret,
      p_version_id: versionId,
      p_status: "partial",
      p_failure_reason: "ai_not_run",
      p_provider: null,
      p_model: null,
      p_dropped_count: 0,
      p_findings: [{ ...baseFinding, severity }],
    });
    if (run.error) throw new Error(`Could not record run: ${run.error.code}`);
    const finding = await service.from("findings").select("id").eq("document_id", id).single();
    return { id: id as string, versionId: versionId as string, findingId: finding.data!.id as string };
  };

  const decide = (persona: Persona, findingId: string, action: string, extra = {}) =>
    as[persona].rpc("decide_finding", {
      p_finding_id: findingId,
      p_action: action,
      p_reason_code: null,
      p_reason_text: null,
      p_final_text: null,
      ...extra,
    });
  const submit = (persona: Persona, id: string, number = 1) =>
    as[persona].rpc("submit_document", { p_document_id: id, p_expected_number: number });
  const review = (persona: Persona, id: string, decision: string, comment: string | null = null, number = 1) =>
    as[persona].rpc("review_document", {
      p_document_id: id,
      p_expected_number: number,
      p_decision: decision,
      p_comment: comment,
    });
  const addVersion = (persona: Persona, id: string, number = 1) =>
    as[persona].rpc("add_document_version", {
      p_document_id: id,
      p_expected_number: number,
      p_text: "Fictional new text.",
      p_synthetic: true,
    });
  const statusOf = async (id: string) => (await service.from("documents").select("*").eq("id", id).single()).data;

  afterAll(async () => {
    await service.from("documents").delete().in("org_id", [orgIds[ORG_A], orgIds[ORG_B]]);
  });

  it("lets only the author decide a finding", async () => {
    const doc = await newDocument("creatorA");
    for (const persona of ["targetA", "reviewerA", "adminA", "adminB", "outsider"] as const) {
      expect((await decide(persona, doc.findingId, "accepted")).error?.code).toBe("42501");
    }
    expect((await anon.rpc("decide_finding", { p_finding_id: doc.findingId, p_action: "accepted", p_reason_code: null, p_reason_text: null, p_final_text: null })).error?.code).toBe("42501");
    await succeed(decide("creatorA", doc.findingId, "accepted"));
    const row = await service.from("findings").select("state").eq("id", doc.findingId).single();
    expect(row.data?.state).toBe("accepted");
  });

  it("requires a reason to dismiss, and text for 'other'", async () => {
    const doc = await newDocument("creatorA");
    expect((await decide("creatorA", doc.findingId, "dismissed")).error?.code).toBe("22023");
    expect((await decide("creatorA", doc.findingId, "dismissed", { p_reason_code: "other", p_reason_text: "  " })).error?.code).toBe("22023");
    expect((await decide("creatorA", doc.findingId, "dismissed", { p_reason_code: "bad" })).error?.code).toBe("23514");
    await succeed(decide("creatorA", doc.findingId, "dismissed", { p_reason_code: "rule_unclear" }));
    const { data } = await as.reviewerA.from("finding_decisions").select("action, reason_code, actor_id").eq("finding_id", doc.findingId);
    expect(data).toEqual([{ action: "dismissed", reason_code: "rule_unclear", actor_id: ids.creatorA }]);
  });

  it("requires text to edit a fix, and stores it", async () => {
    const doc = await newDocument("creatorA");
    expect((await decide("creatorA", doc.findingId, "edited")).error?.code).toBe("22023");
    await succeed(decide("creatorA", doc.findingId, "edited", { p_final_text: "my wording" }));
    const row = await service.from("findings").select("state, resolution").eq("id", doc.findingId).single();
    expect(row.data).toEqual({ state: "edited", resolution: "my wording" });
  });

  it("blocks submission until high severity findings are decided, and only for the author", async () => {
    const doc = await newDocument("creatorA", "high");
    expect((await submit("creatorA", doc.id)).error?.code).toBe("55000");
    await succeed(decide("creatorA", doc.findingId, "accepted"));
    for (const persona of ["targetA", "reviewerA", "adminA"] as const) {
      expect((await submit(persona, doc.id)).error?.code).toBe("42501");
    }
    await succeed(submit("creatorA", doc.id));
    expect((await statusOf(doc.id))?.status).toBe("in_review");
  });

  it("allows open lower severity findings at submission", async () => {
    const doc = await newDocument("creatorA", "medium");
    await succeed(submit("creatorA", doc.id));
  });

  it("freezes a document while in review", async () => {
    const doc = await newDocument("creatorA");
    await succeed(submit("creatorA", doc.id));
    expect((await decide("creatorA", doc.findingId, "accepted")).error?.code).toBe("55000");
    expect((await addVersion("creatorA", doc.id)).error?.code).toBe("55000");
    expect((await submit("creatorA", doc.id)).error?.code).toBe("55000");
  });

  it("lets only a Reviewer or Admin in the organisation review", async () => {
    const doc = await newDocument("creatorA");
    await succeed(submit("creatorA", doc.id));
    for (const persona of ["creatorA", "targetA", "adminB", "creatorB", "outsider"] as const) {
      expect((await review(persona, doc.id, "approved")).error?.code).toBe("42501");
    }
    expect((await statusOf(doc.id))?.status).toBe("in_review");
    await succeed(review("reviewerA", doc.id, "approved"));
    expect(await statusOf(doc.id)).toMatchObject({ status: "approved", approved_by: ids.reviewerA, approved_version_id: doc.versionId });
  });

  it("stops anyone approving their own document, including Admins and Reviewers", async () => {
    for (const author of ["adminA", "reviewerA"] as const) {
      const doc = await newDocument(author);
      await succeed(submit(author, doc.id));
      expect((await review(author, doc.id, "approved")).error?.code).toBe("42501");
      expect((await statusOf(doc.id))?.status).toBe("in_review");
    }
  });

  it("cannot approve a draft, or twice, or the wrong version", async () => {
    const doc = await newDocument("creatorA");
    expect((await review("reviewerA", doc.id, "approved")).error?.code).toBe("55000");
    await succeed(submit("creatorA", doc.id));
    expect((await review("reviewerA", doc.id, "approved", null, 2)).error?.code).toBe("55000");
    await succeed(review("reviewerA", doc.id, "approved"));
    expect((await review("adminA", doc.id, "approved")).error?.code).toBe("55000");
  });

  it("requires a comment to request changes, then reopens the document", async () => {
    const doc = await newDocument("creatorA");
    await succeed(submit("creatorA", doc.id));
    expect((await review("reviewerA", doc.id, "changes_requested", "  ")).error?.code).toBe("22023");
    expect((await review("reviewerA", doc.id, "made_up")).error?.code).toBe("22023");
    await succeed(review("reviewerA", doc.id, "changes_requested", "Please reword this."));
    expect((await statusOf(doc.id))?.status).toBe("changes_requested");
    const { data } = await as.creatorA.from("comments").select("body").eq("document_id", doc.id);
    expect(data).toEqual([{ body: "Please reword this." }]);
    await succeed(decide("creatorA", doc.findingId, "accepted"));
  });

  it("clears approval when a new version is added", async () => {
    const doc = await newDocument("creatorA");
    await succeed(submit("creatorA", doc.id));
    await succeed(review("reviewerA", doc.id, "approved"));
    await succeed(addVersion("creatorA", doc.id));
    expect(await statusOf(doc.id)).toMatchObject({ status: "draft", approved_version_id: null, approved_by: null, approved_at: null });
  });

  it("binds new versions to the version on screen, for the author only", async () => {
    const doc = await newDocument("creatorA");
    expect((await addVersion("creatorA", doc.id, 5)).error?.code).toBe("55000");
    for (const persona of ["targetA", "reviewerA", "adminA", "outsider"] as const) {
      expect((await addVersion(persona, doc.id)).error?.code).toBe("42501");
    }
    await succeed(addVersion("creatorA", doc.id));
    expect((await addVersion("creatorA", doc.id)).error?.code).toBe("55000");
    const { data } = await service.from("document_versions").select("number, plain_text").eq("document_id", doc.id).order("number");
    expect(data).toEqual([
      { number: 1, plain_text: "Fictional draft text." },
      { number: 2, plain_text: "Fictional new text." },
    ]);
  });

  it("requires a check on the new version before submission", async () => {
    const doc = await newDocument("creatorA");
    await succeed(addVersion("creatorA", doc.id));
    expect((await submit("creatorA", doc.id, 2)).error?.code).toBe("55000");
  });

  it("rejects decisions on findings from an older version", async () => {
    const doc = await newDocument("creatorA");
    await succeed(addVersion("creatorA", doc.id));
    expect((await decide("creatorA", doc.findingId, "accepted")).error?.code).toBe("55000");
  });

  it("lets readers comment, records the name, and blocks everyone else", async () => {
    const doc = await newDocument("creatorA");
    const comment = (persona: Persona) => as[persona].rpc("add_comment", { p_document_id: doc.id, p_body: "A comment." });
    await succeed(comment("creatorA"));
    await succeed(comment("reviewerA"));
    for (const persona of ["targetA", "adminB", "outsider"] as const) {
      expect((await comment(persona)).error?.code).toBe("42501");
    }
    expect((await as.creatorA.rpc("add_comment", { p_document_id: doc.id, p_body: "   " })).error?.code).toBe("23514");
    const { data } = await as.reviewerA.from("comments").select("author_id, author_name").eq("document_id", doc.id);
    expect(data?.length).toBe(2);
    expect(data?.every(({ author_name }) => author_name.length > 0)).toBe(true);
  });

  it("hides decisions and comments from other users", async () => {
    const doc = await newDocument("creatorA");
    await succeed(decide("creatorA", doc.findingId, "accepted"));
    await succeed(as.creatorA.rpc("add_comment", { p_document_id: doc.id, p_body: "Private." }));
    for (const persona of ["targetA", "adminB", "outsider"] as const) {
      expect((await as[persona].from("finding_decisions").select("id").eq("document_id", doc.id)).data).toEqual([]);
      expect((await as[persona].from("comments").select("id").eq("document_id", doc.id)).data).toEqual([]);
    }
    expect((await anon.from("comments").select("id")).error?.code).toBe("42501");
  });

  it("gives clients no direct write access", async () => {
    const doc = await newDocument("creatorA");
    const attempts = [
      as.adminA.from("comments").insert({ document_id: doc.id, version_id: doc.versionId, org_id: orgIds[ORG_A], author_id: ids.adminA, author_name: "Forged", body: "x" }),
      as.adminA.from("comments").delete().eq("document_id", doc.id),
      as.adminA.from("finding_decisions").insert({ finding_id: doc.findingId, document_id: doc.id, org_id: orgIds[ORG_A], actor_id: ids.adminA, action: "accepted" }),
      as.adminA.from("finding_decisions").delete().eq("document_id", doc.id),
      as.adminA.from("documents").update({ status: "approved" }).eq("id", doc.id),
    ];
    for (const attempt of attempts) expect((await attempt).error?.code).toBe("42501");
  });

  it("audits every step with the real actor", async () => {
    const doc = await newDocument("creatorA");
    await succeed(decide("creatorA", doc.findingId, "dismissed", { p_reason_code: "false_positive" }));
    await succeed(submit("creatorA", doc.id));
    await succeed(review("reviewerA", doc.id, "approved"));
    const { data } = await as.reviewerA.from("audit_log").select("action, actor_id").eq("entity_id", doc.id);
    expect(data).toContainEqual({ action: "document.submitted", actor_id: ids.creatorA });
    expect(data).toContainEqual({ action: "document.approved", actor_id: ids.reviewerA });
    const decision = await as.reviewerA.from("audit_log").select("action, metadata").eq("entity_id", doc.findingId).single();
    expect(decision.data).toMatchObject({ action: "finding.dismissed", metadata: { reason_code: "false_positive", rule_code: "TST-01" } });
  });
});

describe("private helpers", () => {
  it("are not reachable through the API", async () => {
    const args = { target_org: orgIds[ORG_B] };
    const viaPrivate = await as.adminA.schema("private" as "public").rpc("is_member", args);
    const viaPublic = await as.adminA.rpc("is_member", args);
    expect(viaPrivate.data).toBeNull();
    expect(viaPrivate.error).not.toBeNull();
    expect(viaPublic.data).toBeNull();
    expect(viaPublic.error).not.toBeNull();
  });
});

describe("audit log integrity", () => {
  it.each(["creatorA", "reviewerA", "adminA"] as const)("%s cannot write, change or delete entries", async (persona) => {
    const client = as[persona];
    const inserted = await client.from("audit_log").insert({ org_id: orgIds[ORG_A], action: "forged", entity_type: "test" });
    const updated = await client.from("audit_log").update({ action: "forged" }).eq("entity_id", auditMarker);
    const deleted = await client.from("audit_log").delete().eq("entity_id", auditMarker);
    expect(inserted.error?.code).toBe("42501");
    expect(updated.error?.code).toBe("42501");
    expect(deleted.error?.code).toBe("42501");
  });

  it("rejects changes even from an admin connection", async () => {
    const updated = await service.from("audit_log").update({ action: "forged" }).eq("entity_id", auditMarker);
    const deleted = await service.from("audit_log").delete().eq("entity_id", auditMarker);
    expect(updated.error?.message).toContain("append-only");
    expect(deleted.error?.message).toContain("append-only");
  });
});
