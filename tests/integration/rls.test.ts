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
  const unique = () => `TST-${Math.floor(1000 + Math.random() * 9000)}`;
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
    if (error) throw new Error("Could not add test rule");
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
    await as.adminA.from("rules").update({ title: "Sneaky edit", status: "approved" }).eq("id", target.id);
    expect((await rule(target.id))?.status).toBe("draft");
  });

  it("does not create a version when only the status changes", async () => {
    const target = await addRule(ORG_A, "draft");
    await as.adminA.from("rules").update({ status: "approved" }).eq("id", target.id);
    await as.adminA.from("rules").update({ status: "retired" }).eq("id", target.id);
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
    await as.adminA.from("rules").update({ title: "Edited by another Admin" }).eq("id", target.id);
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
