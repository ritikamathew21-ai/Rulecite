import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAudit, requireMember } from "@/lib/auth/member";
import { DISMISS_REASONS } from "@/lib/documents/labels";
import { buildGapRadar, MIN_DECISIONS, type InsightDecision, type InsightFinding, type RuleInsight } from "@/lib/insights/gap-radar";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Insights" };

// shortcut: reads the latest rows only. Aggregate in the database when an organisation outgrows this.
const ROW_LIMIT = 5_000;

const reasonSummary = ({ reasons }: RuleInsight) =>
  Object.entries(reasons)
    .sort(([, a], [, b]) => b - a)
    .map(([code, count]) => `${DISMISS_REASONS[code as keyof typeof DISMISS_REASONS] ?? code} (${count})`)
    .join(", ");

export default async function InsightsPage() {
  const member = await requireMember();
  if (!canReadAudit(member.role)) redirect("/documents");

  const supabase = await createClient();
  const [findings, decisions] = await Promise.all([
    supabase
      .from("findings")
      .select("id, document_id, quote, state, created_at, citation")
      .eq("org_id", member.organization.id)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT)
      .returns<InsightFinding[]>(),
    supabase
      .from("finding_decisions")
      .select("finding_id, action, reason_code, created_at")
      .eq("org_id", member.organization.id)
      .order("created_at", { ascending: false })
      .limit(ROW_LIMIT)
      .returns<InsightDecision[]>(),
  ]);
  if (findings.error || decisions.error) throw new Error("Could not load the insights");

  const insights = buildGapRadar(findings.data, decisions.data);
  const unclear = insights.filter(({ likelyUnclear }) => likelyUnclear);

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Insights</h1>
      <p className="mt-4 max-w-prose">
        See which rules people keep breaking, and which rules may need clearer wording. Each problem counts once, even if
        it appears in several versions of a document.
      </p>

      <h2 className="mt-8 text-xl font-bold">Rules that may be unclear</h2>
      {unclear.length === 0 ? (
        <p className="mt-2 max-w-prose">
          No rules stand out yet. A rule appears here after at least {MIN_DECISIONS} decisions, if half were dismissed or
          two people said it is unclear.
        </p>
      ) : (
        <ul className="mt-3 max-w-prose space-y-4">
          {unclear.map((insight) => (
            <li key={insight.code} className="border-l-4 border-marker pl-4">
              <Link href={`/rulebook/${insight.ruleId}`} className="font-bold text-pencil underline">
                {insight.code}: {insight.title}
              </Link>
              <p className="mt-1">
                Dismissed {insight.dismissed} of {insight.decided} decisions ({Math.round(insight.dismissalRate * 100)}%).
              </p>
              {insight.dismissed > 0 && <p className="text-sm text-muted">Reasons: {reasonSummary(insight)}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-8 text-xl font-bold">Most repeated problems</h2>
      {insights.length === 0 ? (
        <p className="mt-2 max-w-prose">No findings yet. Check a document to start building insights.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">Findings by rule, most frequent first.</caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Rule</th>
                <th scope="col" className="py-2 pr-4">Documents</th>
                <th scope="col" className="py-2 pr-4">Flagged</th>
                <th scope="col" className="py-2 pr-4">Fixed</th>
                <th scope="col" className="py-2 pr-4">Dismissed</th>
                <th scope="col" className="py-2">Open</th>
              </tr>
            </thead>
            <tbody>
              {insights.map((insight) => (
                <tr key={insight.code} className="border-b border-line">
                  <td className="py-2 pr-4">
                    <span className="font-bold">{insight.code}</span> {insight.title}
                  </td>
                  <td className="py-2 pr-4">{insight.documents}</td>
                  <td className="py-2 pr-4">{insight.flagged}</td>
                  <td className="py-2 pr-4">{insight.resolved}</td>
                  <td className="py-2 pr-4">{insight.dismissed}</td>
                  <td className="py-2">{insight.open}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
