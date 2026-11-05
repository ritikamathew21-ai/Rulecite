import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Documents" };

const formatTime = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

export default async function DocumentsPage() {
  const member = await requireMember();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, created_at")
    .eq("org_id", member.organization.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Could not load the documents");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Documents</h1>
        <Link href="/documents/new" className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink">
          Check a document
        </Link>
      </div>

      {data.length === 0 ? (
        <p className="mt-4 max-w-prose">No documents yet. Check your first document against your brand rules.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              {member.role === "creator" ? "Your documents." : "All documents for your organisation."}
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Title</th>
                <th scope="col" className="py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {data.map((document) => (
                <tr key={document.id} className="border-b border-line">
                  <td className="py-2 pr-4">
                    <Link href={`/documents/${document.id}`} className="font-bold text-pencil underline">
                      {document.title}
                    </Link>
                  </td>
                  <td className="py-2 whitespace-nowrap">{formatTime.format(new Date(document.created_at))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
