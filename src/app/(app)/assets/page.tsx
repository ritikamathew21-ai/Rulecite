import type { Metadata } from "next";
import Link from "next/link";
import { setAssetStatus } from "@/lib/assets/actions";
import { requireMember } from "@/lib/auth/member";
import { STATUS_LABELS, type RuleStatus } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";
import { StatusActions } from "../status-actions";

export const metadata: Metadata = { title: "Assets" };

type AssetRow = { id: string; code: string; name: string; value: string; status: RuleStatus };

export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const member = await requireMember();
  const { changed } = await searchParams;
  const isAdmin = member.role === "admin";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .select("id, code, name, value, status")
    .eq("org_id", member.organization.id)
    .order("code")
    .returns<AssetRow[]>();
  if (error) throw new Error("Could not load the assets");

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-4xl font-bold tracking-tight">Brand colours</h1>
        {isAdmin && (
          <Link href="/assets/new" className="rounded bg-pencil px-4 py-2 font-bold text-white hover:bg-ink">
            Add colour
          </Link>
        )}
      </div>
      <p className="mt-4 max-w-prose">The approved palette that visual checks compare content against.</p>
      {changed && isAdmin && (
        <p role="alert" className="highlighted mt-4 inline-block px-1.5">
          A colour changed after you opened this page, so nothing was applied. Review it, then try again.
        </p>
      )}

      {data.length === 0 ? (
        <p className="mt-4 max-w-prose">
          {isAdmin
            ? "No colours yet. Add your first brand colour."
            : "No approved colours yet. An Admin needs to add and approve them."}
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-2 text-left text-muted">
              {member.role === "creator" ? "Approved colours." : "All colours for your organisation."}
            </caption>
            <thead>
              <tr className="border-b-2 border-ink">
                <th scope="col" className="py-2 pr-4">Colour</th>
                <th scope="col" className="py-2 pr-4">ID</th>
                <th scope="col" className="py-2 pr-4">Name</th>
                <th scope="col" className="py-2 pr-4">Value</th>
                <th scope="col" className="py-2 pr-4">Status</th>
                {isAdmin && <th scope="col" className="py-2">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((asset) => (
                <tr key={asset.id} className="border-b border-line">
                  <td className="py-2 pr-4">
                    <span
                      aria-hidden="true"
                      className="block size-6 rounded border border-muted"
                      style={{ backgroundColor: asset.value }}
                    />
                  </td>
                  <td className="py-2 pr-4 font-bold whitespace-nowrap">{asset.code}</td>
                  <td className="py-2 pr-4">{asset.name}</td>
                  <td className="py-2 pr-4">{asset.value}</td>
                  <td className="py-2 pr-4">{STATUS_LABELS[asset.status]}</td>
                  {isAdmin && (
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <StatusActions action={setAssetStatus} id={asset.id} status={asset.status} noun={asset.code} />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
