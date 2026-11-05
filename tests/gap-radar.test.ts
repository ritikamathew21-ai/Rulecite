import { describe, expect, it } from "vitest";
import { buildGapRadar, type InsightDecision, type InsightFinding } from "@/lib/insights/gap-radar";

let nextId = 0;
const finding = (overrides: Partial<InsightFinding> & { code?: string } = {}): InsightFinding => {
  const { code = "MSG-04", ...rest } = overrides;
  nextId++;
  return {
    id: `finding-${nextId}`,
    document_id: `document-${nextId}`,
    quote: `quote ${nextId}`,
    state: "open",
    created_at: `2026-11-05T10:00:${String(nextId % 60).padStart(2, "0")}Z`,
    citation: { id: `rule-${code}`, code, title: `Title ${code}` },
    ...rest,
  };
};

const dismissal = (item: InsightFinding, reason = "false_positive", at = "2026-11-05T11:00:00Z"): InsightDecision => ({
  finding_id: item.id,
  action: "dismissed",
  reason_code: reason,
  created_at: at,
});

const dismissed = (reason = "false_positive") => {
  const item = finding({ state: "dismissed" });
  return { item, decision: dismissal(item, reason) };
};

describe("buildGapRadar", () => {
  it("returns nothing with no findings", () => {
    expect(buildGapRadar([], [])).toEqual([]);
  });

  it("counts outcomes for each rule", () => {
    const one = dismissed();
    const [insight] = buildGapRadar(
      [finding(), finding({ state: "accepted" }), finding({ state: "edited" }), one.item],
      [one.decision],
    );
    expect(insight).toMatchObject({
      code: "MSG-04",
      flagged: 4,
      documents: 4,
      open: 1,
      resolved: 2,
      dismissed: 1,
      decided: 3,
      reasons: { false_positive: 1 },
    });
    expect(insight.dismissalRate).toBeCloseTo(1 / 3);
  });

  it("counts a problem repeated across versions once, using the latest outcome", () => {
    const shared = { document_id: "document-x", quote: "same words" };
    const first = finding({ ...shared, state: "dismissed", created_at: "2026-11-05T10:00:00Z" });
    const second = finding({ ...shared, state: "accepted", created_at: "2026-11-05T12:00:00Z" });
    const [insight] = buildGapRadar([second, first], [dismissal(first)]);
    expect(insight).toMatchObject({ flagged: 1, resolved: 1, dismissed: 0, reasons: {} });
  });

  it("treats the same words in two documents as two problems", () => {
    const [insight] = buildGapRadar([finding({ quote: "same" }), finding({ quote: "same" })], []);
    expect(insight).toMatchObject({ flagged: 2, documents: 2 });
  });

  it("uses the latest decision on a finding", () => {
    const item = finding({ state: "accepted" });
    const decisions = [dismissal(item, "rule_unclear", "2026-11-05T09:00:00Z"), { finding_id: item.id, action: "accepted", reason_code: null, created_at: "2026-11-05T10:00:00Z" }];
    expect(buildGapRadar([item], decisions)[0]).toMatchObject({ resolved: 1, reasons: {} });
  });

  describe("likely unclear rules", () => {
    const build = (count: number, reason = "false_positive", accepted = 0) => {
      const dismissals = Array.from({ length: count }, () => dismissed(reason));
      const accepts = Array.from({ length: accepted }, () => finding({ state: "accepted" }));
      return buildGapRadar([...dismissals.map(({ item }) => item), ...accepts], dismissals.map(({ decision }) => decision))[0];
    };

    it("needs at least three decisions", () => {
      expect(build(2).likelyUnclear).toBe(false);
    });

    it("flags a rule dismissed at least half the time", () => {
      expect(build(3).likelyUnclear).toBe(true);
      expect(build(2, "false_positive", 2).likelyUnclear).toBe(true);
    });

    it("does not flag a rule mostly accepted", () => {
      expect(build(1, "false_positive", 3).likelyUnclear).toBe(false);
    });

    it("flags a rule two people called unclear, even at a low dismissal rate", () => {
      expect(build(2, "rule_unclear", 5).likelyUnclear).toBe(true);
    });

    it("ignores open findings when judging clarity", () => {
      const item = dismissed();
      const open = Array.from({ length: 5 }, () => finding());
      expect(buildGapRadar([item.item, ...open], [item.decision])[0].likelyUnclear).toBe(false);
    });
  });

  it("lists unclear rules first, then the most flagged", () => {
    const dismissals = Array.from({ length: 3 }, () => {
      const item = finding({ code: "AAA-01", state: "dismissed" });
      return { item, decision: dismissal(item) };
    });
    const frequent = Array.from({ length: 6 }, () => finding({ code: "BBB-01" }));
    const rare = finding({ code: "CCC-01" });
    const result = buildGapRadar([rare, ...frequent, ...dismissals.map(({ item }) => item)], dismissals.map(({ decision }) => decision));
    expect(result.map(({ code }) => code)).toEqual(["AAA-01", "BBB-01", "CCC-01"]);
  });
});
