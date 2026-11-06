import { describe, expect, it } from "vitest";
import type { FindingDraft } from "@/lib/analysis/types";
import { applyAdjudications } from "./golden/adjudication";
import { GOLDEN_DOCUMENTS, type GoldenDocument } from "./golden/documents";
import { metrics, scoreDocument } from "./golden/score";

const document: GoldenDocument = {
  id: "sample",
  split: "dev",
  text: "The lowest fees and free cash.",
  expected: [{ rule: "A", quote: "lowest fees", status: "unsupported" }],
  allowed: [{ rule: "B", quote: "free cash" }],
};

const finding = (rule: string, quote: string | null, claimStatus?: FindingDraft["claimStatus"]) => {
  const start = quote === null ? null : document.text.indexOf(quote);
  return {
    quote,
    start,
    end: start === null ? null : start + quote!.length,
    claimStatus,
    citation: { code: rule },
  } as FindingDraft;
};

describe("scoreDocument", () => {
  it("counts an overlapping finding with the right rule as correct", () => {
    const { tally, misses } = scoreDocument(document, [finding("A", "The lowest", "unsupported")]);
    expect(tally).toMatchObject({ truePositives: 1, falsePositives: 0, falseNegatives: 0, statusRight: 1, statusTotal: 1 });
    expect(misses).toEqual([]);
  });

  it("does not credit the right words under the wrong rule", () => {
    const { tally } = scoreDocument(document, [finding("C", "lowest fees")]);
    expect(tally).toMatchObject({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it("does not credit the right rule on other words", () => {
    const { tally } = scoreDocument(document, [finding("A", "free cash")]);
    expect(tally).toMatchObject({ truePositives: 0, falsePositives: 1, falseNegatives: 1 });
  });

  it("counts a repeat of a found problem once", () => {
    const { tally } = scoreDocument(document, [finding("A", "lowest"), finding("A", "fees")]);
    expect(tally).toMatchObject({ truePositives: 1, duplicates: 1, falsePositives: 0 });
  });

  it("ignores an allowed finding", () => {
    const { tally } = scoreDocument(document, [finding("A", "lowest fees"), finding("B", "free")]);
    expect(tally).toMatchObject({ truePositives: 1, ignored: 1, falsePositives: 0 });
  });

  it("reports a wrong claim status without losing the match", () => {
    const { tally, misses } = scoreDocument(document, [finding("A", "lowest fees", "contradicted")]);
    expect(tally).toMatchObject({ truePositives: 1, statusRight: 0, statusTotal: 1 });
    expect(misses).toEqual([{ kind: "wrong status", rule: "A", quote: "lowest fees" }]);
  });

  it("matches document-level findings only to document-level labels", () => {
    const whole: GoldenDocument = { ...document, expected: [{ rule: "A", quote: null }], allowed: [] };
    expect(scoreDocument(whole, [finding("A", null)]).tally.truePositives).toBe(1);
    expect(scoreDocument(whole, [finding("A", "lowest fees")]).tally).toMatchObject({ truePositives: 0, falsePositives: 1 });
  });
});

describe("adjudicated labels", () => {
  const byId = (documents: GoldenDocument[], id: string) => documents.find((candidate) => candidate.id === id)!;

  it("leaves the original labels untouched", () => {
    const before = JSON.stringify(GOLDEN_DOCUMENTS);
    applyAdjudications(GOLDEN_DOCUMENTS, true);
    expect(JSON.stringify(GOLDEN_DOCUMENTS)).toBe(before);
  });

  it("moves an allowed finding to a required one, without double counting", () => {
    const d04 = byId(applyAdjudications(GOLDEN_DOCUMENTS), "d04-wrong-fee");
    expect(d04.expected).toHaveLength(2);
    expect(d04.allowed).toEqual([]);
  });

  it("counts two rules on the same problem as one problem", () => {
    const d04 = byId(applyAdjudications(GOLDEN_DOCUMENTS), "d04-wrong-fee");
    const onWords = (rule: string) => {
      const start = d04.text.indexOf("less than");
      return { quote: "less than", start, end: start + 9, citation: { code: rule } } as FindingDraft;
    };
    expect(scoreDocument(d04, [onWords("CLM-02"), onWords("MSG-04")]).tally).toMatchObject({ truePositives: 1, duplicates: 1, falsePositives: 0 });
  });

  it("only counts the word best as a violation in the sensitivity view", () => {
    expect(byId(applyAdjudications(GOLDEN_DOCUMENTS), "d09-innocent-words").expected).toEqual([]);
    expect(byId(applyAdjudications(GOLDEN_DOCUMENTS, true), "d09-innocent-words").expected).toEqual([{ rule: "MSG-04", quote: "best" }]);
  });

  it("quotes only words that appear in the document", () => {
    for (const { text, expected } of applyAdjudications(GOLDEN_DOCUMENTS, true)) {
      for (const { quote } of expected) if (quote !== null) expect(text).toContain(quote);
    }
  });
});

describe("metrics", () => {
  it("calculates precision, recall and F1", () => {
    const tally = { truePositives: 3, falsePositives: 1, falseNegatives: 2, duplicates: 0, ignored: 0, statusRight: 0, statusTotal: 0 };
    expect(metrics(tally)).toEqual({ precision: 0.75, recall: 0.6, f1: 6 / 9 });
  });

  it("has no precision when nothing was reported", () => {
    const tally = { truePositives: 0, falsePositives: 0, falseNegatives: 2, duplicates: 0, ignored: 0, statusRight: 0, statusTotal: 0 };
    expect(metrics(tally)).toEqual({ precision: null, recall: 0, f1: 0 });
  });
});

describe("golden documents", () => {
  it("quotes only words that appear in the document", () => {
    for (const { text, expected, allowed = [] } of GOLDEN_DOCUMENTS) {
      for (const { quote } of [...expected, ...allowed]) if (quote !== null) expect(text).toContain(quote);
    }
  });

  it("has unique ids and both splits", () => {
    expect(new Set(GOLDEN_DOCUMENTS.map(({ id }) => id)).size).toBe(GOLDEN_DOCUMENTS.length);
    expect(new Set(GOLDEN_DOCUMENTS.map(({ split }) => split))).toEqual(new Set(["dev", "holdout"]));
  });
});
