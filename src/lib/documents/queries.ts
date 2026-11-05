import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { CheckableVersion } from "@/lib/analysis/run";
import type { Citation } from "@/lib/analysis/types";
import type { DocumentStatus } from "@/lib/documents/labels";
import type { RuleSeverity, RuleType } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export type DocumentRow = {
  id: string;
  org_id: string;
  title: string;
  status: DocumentStatus;
  created_at: string;
  created_by: string;
  approved_version_id: string | null;
  approved_at: string | null;
};

export type VersionRow = CheckableVersion & {
  number: number;
  source_type: "text" | "docx";
  synthetic_confirmed_at: string | null;
  created_at: string;
};

export type RunRow = { id: string; status: string; failure_reason: string | null; created_at: string };

export type FindingState = "open" | "accepted" | "edited" | "dismissed";

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
  replacement: string | null;
  resolution: string | null;
  state: FindingState;
  citation: Citation;
};

export type CommentRow = { id: string; author_name: string; body: string; created_at: string };

// Row-level security decides visibility, so a hidden document looks the same as a missing one.
export async function getDocumentOr404(id: string, requestedVersion?: number) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: document, error } = await supabase.from("documents").select("*").eq("id", id).maybeSingle<DocumentRow>();
  if (error) throw new Error("Could not load the document");
  if (!document) notFound();

  const { data: versions, error: versionsError } = await supabase
    .from("document_versions")
    .select("*")
    .eq("document_id", id)
    .order("number", { ascending: false })
    .returns<VersionRow[]>();
  if (versionsError) throw new Error("Could not load the document versions");

  const latest = versions[0];
  const version = versions.find(({ number }) => number === requestedVersion) ?? latest;

  const { data: comments, error: commentsError } = await supabase
    .from("comments")
    .select("id, author_name, body, created_at")
    .eq("document_id", id)
    .order("created_at")
    .returns<CommentRow[]>();
  if (commentsError) throw new Error("Could not load the comments");

  const { data: run, error: runError } = await supabase
    .from("check_runs")
    .select("*")
    .eq("version_id", version.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();
  if (runError) throw new Error("Could not load the check");

  const base = { document, versions, version, isLatest: version.id === latest.id, comments };
  if (!run) return { ...base, run: null, findings: [] as FindingRow[] };

  const { data: findings, error: findingsError } = await supabase
    .from("findings")
    .select("*")
    .eq("run_id", run.id)
    .returns<FindingRow[]>();
  if (findingsError) throw new Error("Could not load the findings");

  return { ...base, run, findings };
}
