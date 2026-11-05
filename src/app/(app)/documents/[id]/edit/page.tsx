import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/auth/member";
import { getDocumentOr404 } from "@/lib/documents/queries";
import { saveNewVersion } from "@/lib/documents/workflow-actions";
import { VersionForm } from "./version-form";

export const metadata: Metadata = { title: "Edit draft" };

export default async function EditDocumentPage({ params }: PageProps<"/documents/[id]/edit">) {
  const member = await requireMember();
  const { id } = await params;
  const { document, version } = await getDocumentOr404(id);

  if (document.created_by !== member.userId || document.status === "in_review") redirect(`/documents/${id}`);

  return (
    <>
      <h1 className="text-4xl font-bold tracking-tight">Edit {document.title}</h1>
      <p className="mt-4 max-w-prose">
        Saving creates version {version.number + 1} and checks it again. Earlier versions are kept.
        {document.status === "approved" && " The current approval will no longer apply."}
      </p>
      <VersionForm
        action={saveNewVersion.bind(null, document.id, version.number)}
        text={version.plain_text}
        synthetic={version.synthetic_confirmed_at !== null}
        cancelHref={`/documents/${document.id}`}
      />
    </>
  );
}
