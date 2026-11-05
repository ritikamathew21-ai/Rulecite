import { z } from "zod";

export const RULE_TYPE_LABELS = {
  tone: "Tone",
  terminology: "Terminology",
  banned_phrase: "Banned phrase",
  messaging: "Messaging",
  claim: "Claims",
  readability: "Readability",
  accessibility: "Alt text",
  contrast: "Contrast",
  visual: "Visual",
} as const;

export const SEVERITY_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;
export const STATUS_LABELS = { draft: "Draft", approved: "Approved", retired: "Retired" } as const;

export type RuleType = keyof typeof RULE_TYPE_LABELS;
export type RuleSeverity = keyof typeof SEVERITY_LABELS;
export type RuleStatus = keyof typeof STATUS_LABELS;

export type RuleConfig = { preferred?: string; variants?: string[]; phrases?: string[] };

const enumOf = <T extends Record<string, string>>(labels: T, message: string) =>
  z.enum(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]], { error: message });

const text = (label: string, max: number) =>
  z
    .string({ error: `Enter the ${label}.` })
    .trim()
    .min(1, `Enter the ${label}.`)
    .max(max, `The ${label} must be ${max} characters or fewer.`);

export const ruleCodeSchema = z
  .string({ error: "Enter a rule ID." })
  .trim()
  .regex(/^[A-Z]{2,6}-[0-9]{2,4}$/, "Use a rule ID like MSG-04: capital letters, a hyphen, then numbers.");

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);

const ruleSchema = z
  .object({
    type: enumOf(RULE_TYPE_LABELS, "Choose a rule type."),
    severity: enumOf(SEVERITY_LABELS, "Choose a severity."),
    title: text("title", 120),
    instruction: text("instruction", 1000),
    sourceExcerpt: text("source excerpt", 2000),
    sourceName: text("source name", 200),
    preferred: z.string().trim().max(120, "The approved term must be 120 characters or fewer.").optional(),
    terms: z.string().max(2000, "The list must be 2000 characters or fewer.").optional(),
  })
  .superRefine(({ type, preferred, terms }, context) => {
    if (type === "terminology" && !preferred) {
      context.addIssue({ code: "custom", message: "Enter the approved term." });
    }
    if ((type === "terminology" || type === "banned_phrase") && splitList(terms).length === 0) {
      context.addIssue({ code: "custom", message: "List at least one term or phrase to flag." });
    }
  })
  .transform(({ type, severity, title, instruction, sourceExcerpt, sourceName, preferred, terms }) => {
    const config: RuleConfig =
      type === "terminology"
        ? { preferred, variants: splitList(terms) }
        : type === "banned_phrase"
          ? { phrases: splitList(terms) }
          : {};
    return { type, severity, title, instruction, source_excerpt: sourceExcerpt, source_name: sourceName, config };
  });

export type RuleContent = z.output<typeof ruleSchema>;

export function parseRule(values: unknown): { data: RuleContent } | { error: string } {
  const parsed = ruleSchema.safeParse(values);
  return parsed.success ? { data: parsed.data } : { error: parsed.error.issues[0].message };
}
