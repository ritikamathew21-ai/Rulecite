import type { Metadata } from "next";
import Link from "next/link";
import { canReadAudit, requireMember, ROLE_LABELS, type Role } from "@/lib/auth/member";

export const metadata: Metadata = { title: "Workspace" };

const START_HERE: Record<Role, string[]> = {
  creator: [
    'Open Documents, select "Check a document", then "Use sample document", then "Save and check".',
    "Read each finding and the rule it cites, then accept it or dismiss it with a reason.",
    'Select "Submit for review" once every high severity finding is decided.',
    "Sign out and sign in as the Reviewer to approve it, because nobody can approve their own document.",
  ],
  reviewer: [
    "Open the Review queue and choose a document that is in review.",
    "Read its findings and the Creator's decisions, then comment, request changes or approve it.",
    "Open Insights to see repeated problems and rules that may be unclear.",
  ],
  admin: [
    "Open the Rulebook, Claim Ledger and Assets to see approved rules, facts and colours.",
    "Add or edit a rule. It stays a draft until you approve it, and only approved rules are checked.",
    "Open Insights to see which rules may need clarifying, and the Audit log to see who changed what.",
  ],
};

export default async function WorkspacePage() {
  const member = await requireMember();

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Your workspace</h1>
      <p className="mt-4 max-w-prose">
        Your role in {member.organization.name} is {ROLE_LABELS[member.role]}.
      </p>
      {member.organization.isDemo && (
        <>
          <h2 className="mt-8 text-xl font-bold">Start here</h2>
          <ol className="mt-2 max-w-prose list-decimal space-y-1 pl-5">
            {START_HERE[member.role].map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </>
      )}
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
