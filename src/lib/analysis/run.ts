import "server-only";
import { analyzeWithRetry, ProviderError } from "@/lib/ai/provider";
import { aiTimeoutMs, selectProvider } from "@/lib/ai/select";
import { aiFacts, aiRules, buildPrompt, verifyAiOutput } from "@/lib/analysis/ai";
import { runDeterministicChecks } from "@/lib/analysis/deterministic";
import type { ApprovedFact, ApprovedRule, DocumentImage, FindingDraft, TextColour } from "@/lib/analysis/types";
import { todayInIndia } from "@/lib/facts/schema";
import type { createClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createClient>>;

export type CheckableVersion = {
  id: string;
  org_id: string;
  plain_text: string;
  images: DocumentImage[];
  colours: TextColour[];
  synthetic_confirmed_at: string | null;
};

const toRow = ({ start, end, citation, claimStatus, factId, ...finding }: FindingDraft) => ({
  ...finding,
  start_offset: start,
  end_offset: end,
  rule_id: citation.id,
  rule_version: citation.version,
  citation,
  claim_status: claimStatus ?? null,
  fact_id: factId ?? null,
});

type AiResult = {
  findings: FindingDraft[];
  dropped: number;
  failureReason: string | null;
  provider: string | null;
  model: string | null;
};

const skipped = (failureReason: string): AiResult => ({
  findings: [],
  dropped: 0,
  failureReason,
  provider: null,
  model: null,
});

async function runAiChecks(
  supabase: Client,
  secret: string,
  version: CheckableVersion,
  rules: ApprovedRule[],
  facts: ApprovedFact[],
): Promise<AiResult> {
  // Only content confirmed as fictional or synthetic may reach the free tier.
  if (!version.synthetic_confirmed_at) return skipped("ai_not_confirmed");

  const provider = selectProvider();
  if (!provider) return skipped("ai_not_configured");

  const today = todayInIndia();
  const usableRules = aiRules(rules);
  const usableFacts = aiFacts(facts, today);
  if (usableRules.length === 0) return skipped("ai_no_rules");

  const { data: reserved, error } = await supabase.rpc("reserve_ai_check", {
    p_secret: secret,
    p_org_id: version.org_id,
  });
  if (error) return skipped("provider_request");
  if (!reserved) return skipped("daily_limit");

  const used = { provider: provider.name, model: provider.model };
  try {
    const raw = await analyzeWithRetry(provider, buildPrompt(version.plain_text, usableRules, usableFacts), aiTimeoutMs());
    return { ...verifyAiOutput(raw, version.plain_text, usableRules, usableFacts, today), failureReason: null, ...used };
  } catch (failure) {
    const reason = failure instanceof ProviderError ? failure.reason : "provider_unavailable";
    return { findings: [], dropped: 0, failureReason: reason, ...used };
  }
}

export async function runChecks(supabase: Client, version: CheckableVersion) {
  const secret = process.env.CHECK_WRITER_SECRET;
  if (!secret) throw new Error("The check writer is not configured");

  const [rules, facts, assets] = await Promise.all([
    supabase.from("rules").select("*").eq("org_id", version.org_id).eq("status", "approved").returns<ApprovedRule[]>(),
    supabase.from("facts").select("*").eq("org_id", version.org_id).eq("status", "approved").returns<ApprovedFact[]>(),
    supabase.from("assets").select("value").eq("org_id", version.org_id).eq("status", "approved"),
  ]);
  if (rules.error || facts.error || assets.error) throw new Error("Could not load the brand rules");

  const codeFindings = runDeterministicChecks(
    { text: version.plain_text, images: version.images, colours: version.colours },
    rules.data,
    assets.data.map(({ value }) => value),
  );

  const ai = await runAiChecks(supabase, secret, version, rules.data, facts.data);

  const { error } = await supabase.rpc("record_check_run", {
    p_secret: secret,
    p_version_id: version.id,
    p_status: ai.failureReason ? "partial" : "complete",
    p_failure_reason: ai.failureReason,
    p_provider: ai.provider,
    p_model: ai.model,
    p_dropped_count: ai.dropped,
    p_findings: [...codeFindings, ...ai.findings].map(toRow),
  });
  if (error) throw new Error("Could not record the check");
}
