import type { Metadata } from "next";
import { requireMember } from "@/lib/auth/member";
import { DocumentForm } from "../document-form";

export const metadata: Metadata = { title: "Check a document" };

export default async function NewDocumentPage() {
  await requireMember();

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Check a document</h1>
      <p className="mt-4 max-w-prose">Rulecite compares your content with your approved brand rules.</p>
      <DocumentForm />
    </>
  );
}
