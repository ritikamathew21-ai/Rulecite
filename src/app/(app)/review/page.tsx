import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { canReadAudit, requireMember } from "@/lib/auth/member";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Review queue" };

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function ReviewPage() {
  const member = await requireMember();
  if (!canReadAudit(member.role)) redirect("/documents");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, updated_at, created_by")
    .eq("org_id", member.organization.id)
    .eq("status", "in_review")
    .order("updated_at");
  if (error) throw new Error("Could not load the review queue");

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Review queue</h1>
      {data.length === 0 ? (
        <p className="mt-4 max-w-prose">Nothing is waiting for review.</p>
      ) : (
        <ul className="mt-6 max-w-prose space-y-3">
          {data.map((document) => (
            <li key={document.id}>
              <Link href={`/documents/${document.id}`} className="font-bold text-pencil underline">
                {document.title}
              </Link>
              <p className="text-sm text-muted">
                Submitted {formatTime.format(new Date(document.updated_at))}
                {document.created_by === member.userId && ". You wrote this, so someone else must review it"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
