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
