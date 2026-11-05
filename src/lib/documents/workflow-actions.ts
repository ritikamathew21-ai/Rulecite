"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { IntakeError, parseText } from "@/lib/analysis/intake";
import { requireMember } from "@/lib/auth/member";
import { applyFixes } from "@/lib/documents/apply-fixes";
import { checkLatestVersion } from "@/lib/documents/check-latest";
import type { FindingRow, VersionRow } from "@/lib/documents/queries";
import { createClient } from "@/lib/supabase/server";

export type VersionFormState = { error: string } | undefined;

const reference = z.object({
  documentId: z.uuid(),
  number: z.coerce.number().int().positive(),
});

const finish = (documentId: string, problem?: string): never => {
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}${problem ? `?error=${problem}` : ""}`);
};

const problemFor = (error: { code?: string; message?: string }) => {
  if (error.message?.includes("High severity")) return "open-high";
  if (error.message?.includes("not been checked")) return "not-checked";
  if (error.code === "55000") return "stale";
  return "failed";
};

export async function decideFinding(formData: FormData) {
  await requireMember();
  const values = z
    .object({
      documentId: z.uuid(),
      findingId: z.uuid(),
      action: z.enum(["accepted", "edited", "dismissed"]),
      reasonCode: z.string().optional(),
      reasonText: z.string().optional(),
      finalText: z.string().optional(),
    })
    .parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_finding", {
    p_finding_id: values.findingId,
    p_action: values.action,
    p_reason_code: values.reasonCode || null,
    p_reason_text: values.reasonText || null,
    p_final_text: values.finalText || null,
  });

  if (error?.code === "22023") finish(values.documentId, values.action === "edited" ? "edit-text" : "reason");
  finish(values.documentId, error ? problemFor(error) : undefined);
}

export async function applyAcceptedFixes(formData: FormData) {
  await requireMember();
  const { documentId, number } = reference.parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", documentId)
    .eq("number", number)
    .single<VersionRow>();
  if (versionError) finish(documentId, "stale");

  const { data: run } = await supabase
    .from("check_runs")
    .select("id")
    .eq("version_id", version!.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!run) finish(documentId, "no-fixes");

  const { data: findings, error: findingsError } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", run!.id)
    .in("state", ["accepted", "edited"])
    .returns<FindingRow[]>();
  if (findingsError) finish(documentId, "failed");

  const fixes = findings!.flatMap(({ state, quote, start_offset, end_offset, replacement, resolution }) => {
    const text = state === "edited" ? resolution : replacement;
    return quote && text && start_offset !== null && end_offset !== null
      ? [{ start: start_offset, end: end_offset, quote, replacement: text }]
      : [];
  });

  const { text, applied } = applyFixes(version!.plain_text, fixes);
  if (applied === 0) finish(documentId, "no-fixes");

  const { error } = await supabase.rpc("add_document_version", {
    p_document_id: documentId,
    p_expected_number: number,
    p_text: text,
    p_synthetic: version!.synthetic_confirmed_at !== null,
  });
  if (error) finish(documentId, problemFor(error));

  const checked = await checkLatestVersion(supabase, documentId);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}${checked ? "" : "?check=failed"}`);
}

export async function saveNewVersion(
  documentId: string,
  number: number,
  _state: VersionFormState,
  formData: FormData,
): Promise<VersionFormState> {
  await requireMember();

  let text: string;
  try {
    text = parseText(String(formData.get("text") ?? "")).text;
  } catch (error) {
    if (error instanceof IntakeError) return { error: error.message };
    throw error;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_document_version", {
    p_document_id: documentId,
    p_expected_number: number,
    p_text: text,
    p_synthetic: formData.get("synthetic") === "on",
  });
  if (error?.code === "55000") return { error: "This document changed after you opened it. Reload the page and try again." };
  if (error) return { error: "The new version could not be saved. Try again." };

  const checked = await checkLatestVersion(supabase, documentId);
  revalidatePath(`/documents/${documentId}`);
  redirect(`/documents/${documentId}${checked ? "" : "?check=failed"}`);
}

export async function submitForReview(formData: FormData) {
  await requireMember();
  const { documentId, number } = reference.parse(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_document", { p_document_id: documentId, p_expected_number: number });
  finish(documentId, error ? problemFor(error) : undefined);
}

export async function reviewDocument(formData: FormData) {
  await requireMember();
  const values = Object.fromEntries(formData.entries());
  const { documentId, number } = reference.parse(values);
  const decision = z.enum(["approved", "changes_requested"]).parse(values.decision);

  const supabase = await createClient();
  const { error } = await supabase.rpc("review_document", {
    p_document_id: documentId,
    p_expected_number: number,
    p_decision: decision,
    p_comment: String(values.comment ?? ""),
  });

  if (error?.code === "22023") finish(documentId, "comment");
  finish(documentId, error ? problemFor(error) : undefined);
}

export async function addComment(formData: FormData) {
  await requireMember();
  const documentId = z.uuid().parse(formData.get("documentId"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) finish(documentId, "empty-comment");

  const supabase = await createClient();
  const { error } = await supabase.rpc("add_comment", { p_document_id: documentId, p_body: body.slice(0, 2000) });
  finish(documentId, error ? "failed" : undefined);
}
