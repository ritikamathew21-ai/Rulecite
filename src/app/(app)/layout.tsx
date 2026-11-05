import Link from "next/link";
import { canReadAudit, requireMember, ROLE_LABELS } from "@/lib/auth/member";
import { Wordmark } from "../wordmark";
import { NavLinks } from "./nav-links";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const member = await requireMember();

  const navItems = [
    { href: "/workspace", label: "Workspace" },
    { href: "/rulebook", label: "Rulebook" },
    { href: "/ledger", label: "Claim Ledger" },
    { href: "/assets", label: "Assets" },
    ...(canReadAudit(member.role) ? [{ href: "/audit", label: "Audit log" }] : []),
    { href: "/trust", label: "AI and data" },
  ];

  return (
    <div className="flex flex-1 flex-col md:grid md:grid-cols-[15rem_1fr]">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-10 focus:bg-white focus:p-2 focus:text-ink"
      >
        Skip to content
      </a>
      <aside className="on-pencil flex flex-col gap-4 bg-pencil p-4 text-white md:gap-8 md:p-6">
        <div>
          <Link href="/workspace">
            <Wordmark />
          </Link>
          <p className="mt-1 text-sm">{member.organization.name}</p>
        </div>
        <NavLinks items={navItems} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header>
          {member.organization.isDemo && (
            <p className="bg-marker px-4 py-2 text-sm font-bold md:px-10">
              Fictional demonstration. Use only fictional or synthetic content.
            </p>
          )}
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 md:justify-end md:px-10">
            <p>
              Signed in as {member.name} ({ROLE_LABELS[member.role]})
            </p>
            <SignOutButton />
          </div>
        </header>
        <main id="content" tabIndex={-1} className="w-full max-w-3xl flex-1 px-4 py-8 md:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
