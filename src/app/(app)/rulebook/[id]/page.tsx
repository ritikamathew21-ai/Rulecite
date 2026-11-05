import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { setRuleStatus } from "@/lib/rules/actions";
import { getRuleOr404 } from "@/lib/rules/queries";
import { RULE_TYPE_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";
import { StatusActions } from "../../status-actions";

export const metadata: Metadata = { title: "Rule" };

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function RulePage({ params, searchParams }: PageProps<"/rulebook/[id]">) {
  const member = await requireMember();
  const { id } = await params;
  const { changed } = await searchParams;
  const rule = await getRuleOr404(id);
  const isAdmin = member.role === "admin";

  let revisions: { version: number; created_at: string }[] = [];
  if (member.role !== "creator") {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("rule_revisions")
      .select("version, created_at")
      .eq("rule_id", rule.id)
      .order("version", { ascending: false });
    if (error) throw new Error("Could not load the rule history");
    revisions = data;
  }

  return (
    <>
      <Link href="/rulebook" className="text-pencil underline">
        Back to the rulebook
      </Link>
      {changed && isAdmin && (
        <p role="alert" className="highlighted mt-4 inline-block px-1.5">
          This rule changed after you opened it, so nothing was applied. Review this version, then try again.
        </p>
      )}
      <p className="mt-6 text-lg font-bold text-pencil">{rule.code}</p>
      <h1 className="text-4xl font-bold tracking-tight">{rule.title}</h1>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">Status</dt>
        <dd>{STATUS_LABELS[rule.status]}</dd>
        <dt className="font-bold">Type</dt>
        <dd>{RULE_TYPE_LABELS[rule.type]}</dd>
        <dt className="font-bold">Severity</dt>
        <dd>{SEVERITY_LABELS[rule.severity]}</dd>
        <dt className="font-bold">Version</dt>
        <dd>{rule.version}</dd>
        {rule.approved_at && (
          <>
            <dt className="font-bold">Approved</dt>
            <dd>{formatTime.format(new Date(rule.approved_at))}</dd>
          </>
        )}
      </dl>

      <h2 className="mt-8 text-xl font-bold">Instruction</h2>
      <p className="mt-2 max-w-prose">{rule.instruction}</p>

      {rule.config.preferred && (
        <>
          <h2 className="mt-8 text-xl font-bold">Approved term</h2>
          <p className="mt-2">{rule.config.preferred}</p>
        </>
      )}
      {rule.config.variants && (
        <>
          <h2 className="mt-8 text-xl font-bold">Terms to replace</h2>
          <p className="mt-2">{rule.config.variants.join(", ")}</p>
        </>
      )}
      {rule.config.phrases && (
        <>
          <h2 className="mt-8 text-xl font-bold">Banned phrases</h2>
          <p className="mt-2">{rule.config.phrases.join(", ")}</p>
        </>
      )}

      <h2 className="mt-8 text-xl font-bold">Source</h2>
      <figure className="mt-2 max-w-prose border-l-4 border-marker pl-4">
        <blockquote>{rule.source_excerpt}</blockquote>
        <figcaption className="mt-1 text-sm text-muted">{rule.source_name}</figcaption>
      </figure>

      {isAdmin && (
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <StatusActions action={setRuleStatus} id={rule.id} status={rule.status} noun="rule" version={rule.version} />
          {rule.status !== "retired" && (
            <Link href={`/rulebook/${rule.id}/edit`} className="text-pencil underline">
              Edit rule
            </Link>
          )}
        </div>
      )}
      {isAdmin && rule.status === "approved" && (
        <p className="mt-2 text-sm text-muted">Editing this rule returns it to draft until you approve it again.</p>
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
