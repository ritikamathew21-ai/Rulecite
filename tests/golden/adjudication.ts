import type { Expected, GoldenDocument } from "./documents";
import type { Label } from "./score";

type Adjudication = { doc: string; item: string; decision: string; add?: Label; sensitivityOnly?: boolean };

const D12_TEXT =
  "Notwithstanding the aforementioned considerations, comprehensive organisational documentation regarding transactional reconciliation procedures necessitates authorisation from appropriately designated administrative representatives, particularly whenever international remittance obligations require additional regulatory verification throughout subsequent operational reporting periods and associated quarterly compliance assessments.";

// Post-result adjudication from the label review on 2026-11-06. The reviewer could see the results,
// so these never replace the original labels in documents.ts.
export const ADJUDICATIONS: Adjudication[] = [
  { doc: "d09-innocent-words", item: "No payment app is risk-free", decision: "Clean. Same as the original label." },
  {
    doc: "d09-innocent-words",
    item: "The best way to reach us",
    decision:
      "Clean, because the source excerpt limits MSG-04 to superlative claims. The instruction names the word best, so the sensitivity view counts it as a violation.",
    add: { rule: "MSG-04", quote: "best" },
    sensitivityOnly: true,
  },
  {
    doc: "d06-banned-phrases",
    item: "Tone finding on risk-free and 100% safe",
    decision: "Violation. An absolute safety assurance is inappropriate.",
    add: { rule: "TONE-01", quote: "risk-free and 100% safe" },
  },
  {
    doc: "d04-wrong-fee",
    item: "less than most apps charge",
    decision: "Violation, because no approved fact gives comparative evidence.",
    add: { rule: "MSG-04", alsoRules: ["CLM-02"], quote: "less than most apps charge" },
  },
  { doc: "d06-banned-phrases", item: "instant approval", decision: "Violation. Already labelled under BAN-03, so nothing is added." },
  {
    doc: "h04-mixed-terms",
    item: "never run out",
    decision: "Violation, because no approved fact supports it.",
    add: { rule: "MSG-07", alsoRules: ["CLM-02"], quote: "never run out" },
  },
  { doc: "h06-careful-wording", item: "We cannot promise you will save", decision: "Clean. Same as the original label." },
  {
    doc: "d12-hard-to-read",
    item: "Jargon-heavy paragraph",
    decision: "Violation, because TONE-01 says to avoid jargon, which meets the reviewer's condition.",
    add: { rule: "TONE-01", quote: D12_TEXT },
  },
];

const sameWords = (first: string | null, second: string | null) =>
  first !== null && second !== null && (first.includes(second) || second.includes(first));

const isReplacedBy = (allowed: Expected, label: Label) =>
  [label.rule, ...(label.alsoRules ?? [])].includes(allowed.rule) && sameWords(allowed.quote, label.quote);

export function applyAdjudications(documents: GoldenDocument[], sensitivity = false): GoldenDocument[] {
  return documents.map((document) => {
    const added = ADJUDICATIONS.flatMap(({ doc, add, sensitivityOnly }) =>
      doc === document.id && add && (sensitivity || !sensitivityOnly) ? [add] : [],
    );
    return {
      ...document,
      expected: [...document.expected, ...added],
      allowed: document.allowed?.filter((allowed) => !added.some((label) => isReplacedBy(allowed, label))),
    };
  });
}
