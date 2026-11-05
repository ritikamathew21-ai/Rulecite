"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { IntakeError, parseDocx, parseText } from "@/lib/analysis/intake";
import { runChecks } from "@/lib/analysis/run";
import type { ParsedDocument } from "@/lib/analysis/types";
import { requireMember } from "@/lib/auth/member";
import { checkLatestVersion } from "@/lib/documents/check-latest";
import { createClient } from "@/lib/supabase/server";

export type DocumentFormState = { error: string } | undefined;

const titleSchema = z
  .string({ error: "Enter a title." })
  .trim()
  .min(1, "Enter a title.")
  .max(200, "The title must be 200 characters or fewer.");

async function readSubmission(formData: FormData): Promise<{ parsed: ParsedDocument; sourceType: "text" | "docx" }> {
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    if (!file.name.toLowerCase().endsWith(".docx")) throw new IntakeError("Upload a .docx file.");
    return { parsed: await parseDocx(await file.arrayBuffer()), sourceType: "docx" };
  }
  return { parsed: parseText(String(formData.get("text") ?? "")), sourceType: "text" };
}

export async function createDocument(_state: DocumentFormState, formData: FormData): Promise<DocumentFormState> {
  const member = await requireMember();

  const title = titleSchema.safeParse(formData.get("title"));
  if (!title.success) return { error: title.error.issues[0].message };

  let submission;
  try {
    submission = await readSubmission(formData);
  } catch (error) {
    if (error instanceof IntakeError) return { error: error.message };
    throw error;
  }
  const { parsed, sourceType } = submission;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_document", {
    p_org_id: member.organization.id,
    p_title: title.data,
    p_source_type: sourceType,
    p_text: parsed.text,
    p_images: parsed.images,
    p_colours: parsed.colours,
    p_synthetic: formData.get("synthetic") === "on",
  });
  if (error) return { error: "The document could not be saved. Try again." };

  const { document_id: documentId, version_id: versionId } = data as { document_id: string; version_id: string };

  // The document stays saved if the check fails, and its page says it was not checked.
  let checked = true;
  try {
    await runChecks(supabase, {
      id: versionId,
      org_id: member.organization.id,
      plain_text: parsed.text,
      images: parsed.images,
      colours: parsed.colours,
    });
  } catch {
    checked = false;
  }

  redirect(`/documents/${documentId}${checked ? "" : "?check=failed"}`);
}

export async function rerunCheck(formData: FormData) {
  await requireMember();
  const documentId = z.uuid().parse(formData.get("documentId"));

  const supabase = await createClient();
  const checked = await checkLatestVersion(supabase, documentId);

  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}${checked ? "" : "?check=failed"}`);
}
