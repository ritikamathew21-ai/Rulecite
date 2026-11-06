import type { FindingDraft } from "@/lib/analysis/types";
import type { Expected, GoldenDocument } from "./documents";

export type Tally = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  duplicates: number;
  ignored: number;
  statusRight: number;
  statusTotal: number;
};

export type Miss = { kind: "missed" | "false alarm" | "wrong status"; rule: string; quote: string | null };

export const emptyTally = (): Tally => ({
  truePositives: 0,
  falsePositives: 0,
  falseNegatives: 0,
  duplicates: 0,
  ignored: 0,
  statusRight: 0,
  statusTotal: 0,
});

export function addTally(total: Tally, part: Tally) {
  for (const key of Object.keys(total) as (keyof Tally)[]) total[key] += part[key];
}

// alsoRules is for a problem that more than one rule fairly covers. It still counts as one problem.
export type Label = Expected & { alsoRules?: string[] };

const covers = (text: string, label: Label, finding: FindingDraft) => {
  if (label.rule !== finding.citation.code && !label.alsoRules?.includes(finding.citation.code)) return false;
  if (label.quote === null || finding.start === null) return label.quote === null && finding.start === null;
  const start = text.indexOf(label.quote);
  return start < finding.end! && finding.start < start + label.quote.length;
};

// A finding is correct when it names the labelled rule and overlaps the labelled words.
export function scoreDocument(document: GoldenDocument, findings: FindingDraft[]) {
  const tally = emptyTally();
  const misses: Miss[] = [];
  const found = new Set<Expected>();

  for (const finding of findings) {
    const matches = document.expected.filter((label) => covers(document.text, label, finding));
    const label = matches.find((candidate) => !found.has(candidate));

    if (label) {
      found.add(label);
      tally.truePositives++;
      if (label.status) {
        tally.statusTotal++;
        if (finding.claimStatus === label.status) tally.statusRight++;
        else misses.push({ kind: "wrong status", rule: label.rule, quote: label.quote });
      }
    } else if (matches.length > 0) {
      tally.duplicates++;
    } else if (document.allowed?.some((allowed) => covers(document.text, allowed, finding))) {
      tally.ignored++;
    } else {
      tally.falsePositives++;
      misses.push({ kind: "false alarm", rule: finding.citation.code, quote: finding.quote });
    }
  }

  for (const label of document.expected) {
    if (found.has(label)) continue;
    tally.falseNegatives++;
    misses.push({ kind: "missed", rule: label.rule, quote: label.quote });
  }

  return { tally, misses };
}

export function metrics({ truePositives: tp, falsePositives: fp, falseNegatives: fn }: Tally) {
  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? null : tp / (tp + fn);
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  return { precision, recall, f1 };
}
