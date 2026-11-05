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

// A finding keeps its own copy of the rule, so it stays readable if the rule later changes.
export type Citation = Pick<
  ApprovedRule,
  "id" | "code" | "version" | "title" | "instruction" | "source_excerpt" | "source_name"
>;

export type FindingDraft = {
  origin: "rule";
  category: RuleType;
  severity: RuleSeverity;
  quote: string | null;
  start: number | null;
  end: number | null;
  explanation: string;
  suggestion: string;
  citation: Citation;
};
