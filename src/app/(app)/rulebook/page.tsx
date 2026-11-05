import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { RULE_TYPE_LABELS, SEVERITY_LABELS, STATUS_LABELS, type RuleSeverity, type RuleStatus, type RuleType } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Rulebook" };

type RuleRow = { id: string; code: string; title: string; type: RuleType; severity: RuleSeverity; status: RuleStatus };

export default async function RulebookPage() {
  const member = await requireMember();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rules")
    .select("id, code, title, type, severity, status")
    .eq("org_id", member.organization.id)
    .order("code")
    .returns<RuleRow[]>();
  if (error) throw new Error("Could not load the rulebook");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Rulebook</h1>
        {member.role === "admin" && (
          <Link href="/rulebook/new" className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink">
            Add rule
          </Link>
        )}
      </div>

      {data.length === 0 ? (
        <p className="mt-4 max-w-prose">
          {member.role === "admin"
            ? "No rules yet. Add your first rule from your brand guidelines."
            : "No approved rules yet. An Admin needs to add and approve them."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              {member.role === "creator" ? "Approved rules for your organisation." : "All rules for your organisation."}
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Rule</th>
                <th scope="col" className="py-2 pr-4">Title</th>
                <th scope="col" className="py-2 pr-4">Type</th>
                <th scope="col" className="py-2 pr-4">Severity</th>
                <th scope="col" className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((rule) => (
                <tr key={rule.id} className="border-b border-line">
                  <td className="py-2 pr-4 font-bold whitespace-nowrap">
                    <Link href={`/rulebook/${rule.id}`} className="text-pencil underline">
                      {rule.code}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{rule.title}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{RULE_TYPE_LABELS[rule.type]}</td>
                  <td className="py-2 pr-4">{SEVERITY_LABELS[rule.severity]}</td>
                  <td className="py-2">{STATUS_LABELS[rule.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
