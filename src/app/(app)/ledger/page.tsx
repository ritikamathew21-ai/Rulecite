import type { Metadata } from "next";
import Link from "next/link";
import { requireMember } from "@/lib/auth/member";
import type { Fact } from "@/lib/facts/queries";
import { factValidity, todayInIndia } from "@/lib/facts/schema";
import { STATUS_LABELS } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Claim Ledger" };

const VALIDITY_LABELS = { not_yet_valid: "Not yet valid", current: "", expired: "Expired" };

export default async function LedgerPage() {
  const member = await requireMember();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("facts")
    .select("*")
    .eq("org_id", member.organization.id)
    .order("code")
    .returns<Fact[]>();
  if (error) throw new Error("Could not load the Claim Ledger");

  const today = todayInIndia();

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Claim Ledger</h1>
        {member.role === "admin" && (
          <Link href="/ledger/new" className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink">
            Add fact
          </Link>
        )}
      </div>
      <p className="mt-4 max-w-prose">Approved facts that content is allowed to claim, each with its source.</p>

      {data.length === 0 ? (
        <p className="mt-4 max-w-prose">
          {member.role === "admin"
            ? "No facts yet. Add your first approved fact."
            : "No approved facts yet. An Admin needs to add and approve them."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              {member.role === "creator" ? "Approved facts for your organisation." : "All facts for your organisation."}
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Fact</th>
                <th scope="col" className="py-2 pr-4">Statement</th>
                <th scope="col" className="py-2 pr-4">Expires</th>
                <th scope="col" className="py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((fact) => (
                <tr key={fact.id} className="border-b border-line">
                  <td className="py-2 pr-4 font-bold whitespace-nowrap">
                    <Link href={`/ledger/${fact.id}`} className="text-pencil underline">
                      {fact.code}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{fact.statement}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{fact.expires_on ?? "No expiry"}</td>
                  <td className="py-2 whitespace-nowrap">
                    {STATUS_LABELS[fact.status]}
                    {VALIDITY_LABELS[factValidity(fact.valid_from, fact.expires_on, today)] && (
                      <span className="highlighted ml-2 px-1">
                        {VALIDITY_LABELS[factValidity(fact.valid_from, fact.expires_on, today)]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
