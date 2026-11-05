import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { CheckableVersion } from "@/lib/analysis/run";
import type { Citation } from "@/lib/analysis/types";
import type { RuleSeverity, RuleType } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export type DocumentRow = { id: string; org_id: string; title: string; created_at: string; created_by: string };

export type VersionRow = CheckableVersion & {
  number: number;
  source_type: "text" | "docx";
  synthetic_confirmed_at: string | null;
};

export type RunRow = { id: string; status: string; failure_reason: string | null; created_at: string };

export type FindingRow = {
  id: string;
  origin: "rule" | "ai";
  category: RuleType;
  severity: RuleSeverity;
  quote: string | null;
  start_offset: number | null;
  end_offset: number | null;
  explanation: string;
  suggestion: string;
  citation: Citation;
};

// Row-level security decides visibility, so a hidden document looks the same as a missing one.
export async function getDocumentOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: document, error } = await supabase.from("documents").select("*").eq("id", id).maybeSingle<DocumentRow>();
  if (error) throw new Error("Could not load the document");
  if (!document) notFound();

  const { data: version, error: versionError } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", id)
    .order("number", { ascending: false })
    .limit(1)
    .single<VersionRow>();
  if (versionError) throw new Error("Could not load the document version");

  const { data: run, error: runError } = await supabase
    .from("check_runs")
    .select("*")
    .eq("version_id", version.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();
  if (runError) throw new Error("Could not load the check");

  if (!run) return { document, version, run: null, findings: [] };

  const { data: findings, error: findingsError } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", run.id)
    .returns<FindingRow[]>();
  if (findingsError) throw new Error("Could not load the findings");

  return { document, version, run, findings };
}
