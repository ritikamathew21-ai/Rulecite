import type { Metadata } from "next";
import { requireMember, type Role } from "@/lib/auth/member";
import { SignOutButton } from "../sign-out-button";

export const metadata: Metadata = { title: "Workspace · Rulecite" };

const ROLE_LABELS: Record<Role, string> = {
  creator: "Creator",
  reviewer: "Reviewer",
  admin: "Admin",
};

export default async function WorkspacePage() {
  const member = await requireMember();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-6">
      <h1 className="text-3xl font-semibold">{member.organization.name}</h1>
      {member.organization.isDemo && <p>This is a fictional demonstration workspace.</p>}
      <p>
        Signed in as {member.name} ({ROLE_LABELS[member.role]})
      </p>
      <SignOutButton />
    </main>
  );
}
