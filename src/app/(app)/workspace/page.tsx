import type { Metadata } from "next";
import Link from "next/link";
import { canReadAudit, requireMember, ROLE_LABELS } from "@/lib/auth/member";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkspacePage() {
  const member = await requireMember();

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Your workspace</h1>
      <p className="mt-4 max-w-prose">
        Your role in {member.organization.name} is {ROLE_LABELS[member.role]}.
      </p>
      <h2 className="mt-8 text-xl font-bold">What you can do now</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <Link href="/documents/new" className="text-pencil underline">
            Check a document
          </Link>
        </li>
        <li>
          <Link href="/rulebook" className="text-pencil underline">
            {member.role === "admin" ? "Manage your brand rules" : "Read your brand rules"}
          </Link>
        </li>
        <li>
          <Link href="/ledger" className="text-pencil underline">
            {member.role === "admin" ? "Manage approved facts" : "Read approved facts"}
          </Link>
        </li>
        <li>
          <Link href="/assets" className="text-pencil underline">
            {member.role === "admin" ? "Manage brand colours" : "See brand colours"}
          </Link>
        </li>
        {canReadAudit(member.role) && (
          <li>
            <Link href="/audit" className="text-pencil underline">
              Read your organisation&apos;s audit log
            </Link>
          </li>
        )}
        <li>
          <Link href="/trust" className="text-pencil underline">
            See how AI and your data will be handled
          </Link>
        </li>
      </ul>
    </>
  );
}
