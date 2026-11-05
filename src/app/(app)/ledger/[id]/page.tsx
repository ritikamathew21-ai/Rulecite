import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { setFactStatus } from "@/lib/facts/actions";
import { getFactOr404 } from "@/lib/facts/queries";
import { factValidity, todayInIndia } from "@/lib/facts/schema";
import { STATUS_LABELS } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";
import { StatusActions } from "../../status-actions";

export const metadata: Metadata = { title: "Fact" };

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function FactPage({ params, searchParams }: PageProps<"/ledger/[id]">) {
  const member = await requireMember();
  const { id } = await params;
  const { changed } = await searchParams;
  const fact = await getFactOr404(id);
  const isAdmin = member.role === "admin";
  const validity = factValidity(fact.valid_from, fact.expires_on, todayInIndia());

  let revisions: { version: number; created_at: string }[] = [];
  if (member.role !== "creator") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fact_revisions")
      .select("version, created_at")
      .eq("fact_id", fact.id)
      .order("version", { ascending: false });
    if (error) throw new Error("Could not load the fact history");
    revisions = data;
  }

  return (
    <>
      <Link href="/ledger" className="text-pencil underline">
        Back to the Claim Ledger
      </Link>
      {changed && isAdmin && (
        <p role="alert" className="highlighted mt-4 inline-block px-1.5">
          This fact changed after you opened it, so nothing was applied. Review this version, then try again.
        </p>
      )}
      <p className="mt-6 text-lg font-bold text-pencil">{fact.code}</p>
      <h1 className="max-w-prose text-3xl font-bold tracking-tight">{fact.statement}</h1>
      {validity === "expired" && (
        <p className="highlighted mt-3 inline-block px-1.5">
          This fact expired on {fact.expires_on}. Claims that rely on it are outdated.
        </p>
      )}
      {validity === "not_yet_valid" && (
        <p className="highlighted mt-3 inline-block px-1.5">
          This fact starts on {fact.valid_from}. It cannot support claims until then.
        </p>
      )}

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">Status</dt>
        <dd>{STATUS_LABELS[fact.status]}</dd>
        <dt className="font-bold">Valid from</dt>
        <dd>{fact.valid_from}</dd>
        <dt className="font-bold">Expires on</dt>
        <dd>{fact.expires_on ?? "No expiry"}</dd>
        <dt className="font-bold">Version</dt>
        <dd>{fact.version}</dd>
        {fact.approved_at && (
          <>
            <dt className="font-bold">Approved</dt>
            <dd>{formatTime.format(new Date(fact.approved_at))}</dd>
          </>
        )}
      </dl>

      <h2 className="mt-8 text-xl font-bold">Source</h2>
      <p className="mt-2 max-w-prose">{fact.source_name}</p>
      {fact.source_url && (
        <a href={fact.source_url} rel="noopener noreferrer" target="_blank" className="break-all text-pencil underline">
          {fact.source_url}
        </a>
      )}

      {isAdmin && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <StatusActions action={setFactStatus} id={fact.id} status={fact.status} noun="fact" version={fact.version} />
          {fact.status !== "retired" && (
            <Link href={`/ledger/${fact.id}/edit`} className="text-pencil underline">
              Edit fact
            </Link>
          )}
        </div>
      )}
      {isAdmin && fact.status === "approved" && (
        <p className="mt-2 text-sm text-muted">Editing this fact returns it to draft until you approve it again.</p>
      )}

      {revisions.length > 0 && (
        <>
          <h2 className="mt-8 text-xl font-bold">Version history</h2>
          <ul className="mt-2 space-y-1">
            {revisions.map(({ version, created_at }) => (
              <li key={version}>
                Version {version}, saved {formatTime.format(new Date(created_at))}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
