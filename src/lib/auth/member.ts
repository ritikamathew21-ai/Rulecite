import "server-only";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "creator" | "reviewer" | "admin";

export const ROLE_LABELS: Record<Role, string> = {
  creator: "Creator",
  reviewer: "Reviewer",
  admin: "Admin",
};

// For navigation and redirects only. Row-level security is what enforces this.
export const canReadAudit = (role: Role) => role === "reviewer" || role === "admin";

export type Member = {
  userId: string;
  name: string;
  email: string;
  role: Role;
  organization: { id: string; name: string; isDemo: boolean };
};

type MembershipRow = {
  role: Role;
  organizations: { id: string; name: string; is_demo: boolean };
};

// getClaims verifies the token signature. The role comes from the database under RLS.
const getSession = cache(async () => {
  const supabase = await createClient();
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (isAuthRetryableFetchError(claimsError)) throw new Error("Could not verify session");
  const claims = data?.claims;
  if (!claims) return null;

  // shortcut: first membership only, upgrade when a user can belong to several organisations.
  const { data: row, error } = await supabase
    .from("memberships")
    .select("role, organizations(id, name, is_demo)")
    .eq("user_id", claims.sub)
    .order("created_at")
    .limit(1)
    .maybeSingle<MembershipRow>();
  if (error) throw new Error("Could not load membership");
  if (!row) return { member: null };

  const email = claims.email ?? "";
  const member: Member = {
    userId: claims.sub,
    name: (claims.user_metadata?.name as string | undefined) ?? email,
    email,
    role: row.role,
    organization: {
      id: row.organizations.id,
      name: row.organizations.name,
      isDemo: row.organizations.is_demo,
    },
  };
  return { member };
});

export async function requireMember() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!session.member) redirect("/no-access");
  return session.member;
}

// A convenience check. Row-level security is what enforces this.
export async function requireAdmin(fallback: string) {
  const member = await requireMember();
  if (member.role !== "admin") redirect(fallback);
  return member;
}

export async function requireSignedIn() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
