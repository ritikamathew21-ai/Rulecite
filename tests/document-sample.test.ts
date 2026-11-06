import { describe, expect, it } from "vitest";
import { runDeterministicChecks } from "@/lib/analysis/deterministic";
import type { ApprovedRule } from "@/lib/analysis/types";
import { SAMPLE_DOCUMENT, titleFromFileName } from "@/lib/documents/labels";
import { DEMO_RULES } from "../scripts/seed-demo.mjs";

describe("titleFromFileName", () => {
  it.each([
    ["launch-email.docx", "launch email"],
    ["spring_launch_v2.pdf", "spring launch v2"],
    ["no extension", "no extension"],
    ["release.notes.final.pdf", "release.notes.final"],
  ])("turns %s into %s", (name, title) => {
    expect(titleFromFileName(name)).toBe(title);
  });

  it("stays within the title limit", () => {
    expect(titleFromFileName(`${"a".repeat(300)}.pdf`)).toHaveLength(200);
  });
});

describe("the sample document", () => {
  const rules = DEMO_RULES.map((rule) => ({ ...rule, id: rule.code, version: 1 })) as unknown as ApprovedRule[];

  it("triggers code findings against the demo rules, without AI", () => {
    const findings = runDeterministicChecks({ text: SAMPLE_DOCUMENT.text, images: [], colours: [] }, rules, []);
    const found = findings.map(({ citation, quote }) => `${citation.code}: ${quote}`);
    expect(found).toEqual(expect.arrayContaining(["TERM-12: e-wallet", "TERM-15: reward points", "BAN-03: risk-free"]));
  });

  it("is labelled as a sample", () => {
    expect(SAMPLE_DOCUMENT.title).toContain("(sample)");
  });
});
