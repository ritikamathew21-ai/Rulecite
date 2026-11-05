import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canReadAudit, requireMember } from "@/lib/auth/member";
import { DEFAULT_PATH } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Audit log" };

const AUDIT_PAGE_SIZE = 50;

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function AuditPage() {
  const member = await requireMember();
  if (!canReadAudit(member.role)) redirect(DEFAULT_PATH);

  const supabase = await createClient();
  const { data: entries, error } = await supabase
    .from("audit_log")
    .select("id, action, entity_type, entity_id, actor_id, created_at")
    .eq("org_id", member.organization.id)
    .order("created_at", { ascending: false })
    .limit(AUDIT_PAGE_SIZE);
  if (error) throw new Error("Could not load the audit log");

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Audit log</h1>
      {entries.length === 0 ? (
        <p className="mt-4 max-w-prose">
          No activity is recorded yet. Rule changes and review decisions will appear here once those features are
          available.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              Most recent {AUDIT_PAGE_SIZE} entries, in India Standard Time. Entries cannot be changed or deleted.
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Time</th>
                <th scope="col" className="py-2 pr-4">Action</th>
                <th scope="col" className="py-2 pr-4">Item</th>
                <th scope="col" className="py-2">Account</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line">
                  <td className="py-2 pr-4 whitespace-nowrap">{formatTime.format(new Date(entry.created_at))}</td>
                  <td className="py-2 pr-4">{entry.action}</td>
                  <td className="py-2 pr-4">{entry.entity_type}</td>
                  <td className="py-2">{entry.actor_id?.slice(0, 8) ?? "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
