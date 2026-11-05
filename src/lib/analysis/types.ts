import type { RuleConfig, RuleSeverity, RuleType } from "@/lib/rules/schema";

export type ApprovedRule = {
  id: string;
  code: string;
  version: number;
  type: RuleType;
  severity: RuleSeverity;
  title: string;
  instruction: string;
  source_excerpt: string;
  source_name: string;
  config: RuleConfig & { maxGrade?: number };
};

export type DocumentImage = { name: string; alt: string };
export type TextColour = { text: string; colour: string; background: string | null };

export type ParsedDocument = {
  text: string;
  images: DocumentImage[];
  colours: TextColour[];
};

export type ApprovedFact = {
  id: string;
  code: string;
  statement: string;
  source_name: string;
  valid_from: string;
  expires_on: string | null;
};

export type ClaimStatus = "unsupported" | "contradicted" | "outdated";

// A finding keeps its own copy of the rule and fact, so it stays readable if they later change.
export type Citation = Pick<
  ApprovedRule,
  "id" | "code" | "version" | "title" | "instruction" | "source_excerpt" | "source_name"
> & { fact?: Pick<ApprovedFact, "code" | "statement" | "source_name" | "expires_on"> };

export type FindingDraft = {
  origin: "rule" | "ai";
  category: RuleType;
  severity: RuleSeverity;
  quote: string | null;
  start: number | null;
  end: number | null;
  explanation: string;
  suggestion: string;
  // Exact replacement text, when the fix can be applied without judgement.
  replacement: string | null;
  claimStatus?: ClaimStatus | null;
  factId?: string | null;
  citation: Citation;
};
