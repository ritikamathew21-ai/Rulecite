import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/member";
import { updateFact } from "@/lib/facts/actions";
import { getFactOr404 } from "@/lib/facts/queries";
import { FactForm } from "../../fact-form";

export const metadata: Metadata = { title: "Edit fact" };

export default async function EditFactPage({ params }: PageProps<"/ledger/[id]/edit">) {
  await requireAdmin("/ledger");

  const { id } = await params;
  const fact = await getFactOr404(id);
  if (fact.status === "retired") redirect(`/ledger/${fact.id}`);

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Edit {fact.code}</h1>
      <FactForm
        action={updateFact.bind(null, fact.id, fact.version)}
        cancelHref={`/ledger/${fact.id}`}
        submitLabel="Save changes"
        initial={{
          statement: fact.statement,
          sourceName: fact.source_name,
          sourceUrl: fact.source_url ?? "",
          validFrom: fact.valid_from,
          expiresOn: fact.expires_on ?? "",
        }}
      />
    </>
  );
}
