import "server-only";
import { runDeterministicChecks } from "@/lib/analysis/deterministic";
import type { ApprovedRule, DocumentImage, FindingDraft, TextColour } from "@/lib/analysis/types";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type CheckableVersion = {
  id: string;
  org_id: string;
  plain_text: string;
  images: DocumentImage[];
  colours: TextColour[];
};

const toRow = ({ start, end, citation, ...finding }: FindingDraft) => ({
  ...finding,
  start_offset: start,
  end_offset: end,
  rule_id: citation.id,
  rule_version: citation.version,
  citation,
});

// shortcut: AI checks are not connected, so every run is partial. Add them after the approved Gemini retest.
export async function runChecks(supabase: Client, version: CheckableVersion) {
  const secret = process.env.CHECK_WRITER_SECRET;
  if (!secret) throw new Error("The check writer is not configured");

  const [rules, assets] = await Promise.all([
    supabase.from("rules").select("*").eq("org_id", version.org_id).eq("status", "approved").returns<ApprovedRule[]>(),
    supabase.from("assets").select("value").eq("org_id", version.org_id).eq("status", "approved"),
  ]);
  if (rules.error || assets.error) throw new Error("Could not load the brand rules");

  const findings = runDeterministicChecks(
    { text: version.plain_text, images: version.images, colours: version.colours },
    rules.data,
    assets.data.map(({ value }) => value),
  );

  const { error } = await supabase.rpc("record_check_run", {
    p_secret: secret,
    p_version_id: version.id,
    p_status: "partial",
    p_failure_reason: "ai_not_run",
    p_provider: null,
    p_model: null,
    p_dropped_count: 0,
    p_findings: findings.map(toRow),
  });
  if (error) throw new Error("Could not record the check");
}
