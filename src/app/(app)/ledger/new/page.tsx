import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/member";
import { createFact } from "@/lib/facts/actions";
import { todayInIndia } from "@/lib/facts/schema";
import { FactForm } from "../fact-form";

export const metadata: Metadata = { title: "Add fact" };

export default async function NewFactPage() {
  await requireAdmin("/ledger");

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Add a fact</h1>
      <p className="mt-4 max-w-prose">New facts start as drafts. They are not used until you approve them.</p>
      <FactForm
        action={createFact}
        cancelHref="/ledger"
        submitLabel="Save draft"
        showCode
        initial={{ validFrom: todayInIndia() }}
      />
    </>
  );
}
