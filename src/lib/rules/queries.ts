import "server-only";
import { notFound } from "next/navigation";
import { z } from "zod";
import type { RuleConfig, RuleSeverity, RuleStatus, RuleType } from "@/lib/rules/schema";
import { createClient } from "@/lib/supabase/server";

export type Rule = {
  id: string;
  code: string;
  type: RuleType;
  severity: RuleSeverity;
  title: string;
  instruction: string;
  source_excerpt: string;
  source_name: string;
  config: RuleConfig;
  status: RuleStatus;
  version: number;
  approved_at: string | null;
};

// Row-level security decides visibility, so a hidden rule looks the same as a missing one.
export async function getRuleOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.from("rules").select("*").eq("id", id).maybeSingle<Rule>();
  if (error) throw new Error("Could not load the rule");
  if (!data) notFound();
  return data;
}
