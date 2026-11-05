import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Role = "creator" | "reviewer" | "admin";

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
  const { data } = await supabase.auth.getClaims();
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

export async function requireSignedIn() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}
