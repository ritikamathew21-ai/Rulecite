import { describe, expect, it } from "vitest";
import { parseRule, ruleCodeSchema } from "@/lib/rules/schema";

const base = {
  type: "messaging",
  severity: "high",
  title: " Superlatives ",
  instruction: "Need a source.",
  sourceExcerpt: "Excerpt.",
  sourceName: "Guide",
};

describe("ruleCodeSchema", () => {
  it.each(["MSG-04", "TERM-12", "AB-1234"])("accepts %s", (code) => {
    expect(ruleCodeSchema.safeParse(code).success).toBe(true);
  });

  it.each(["msg-04", "MSG04", "M-04", "MSG-4", "MSG-12345", "TOOLONG-01", ""])("rejects %s", (code) => {
    expect(ruleCodeSchema.safeParse(code).success).toBe(false);
  });
});

describe("parseRule", () => {
  it("maps a rule to database fields and trims text", () => {
    expect(parseRule(base)).toEqual({
      data: {
        type: "messaging",
        severity: "high",
        title: "Superlatives",
        instruction: "Need a source.",
        source_excerpt: "Excerpt.",
        source_name: "Guide",
        config: {},
      },
    });
  });

  it("builds terminology settings from commas and new lines", () => {
    const result = parseRule({ ...base, type: "terminology", preferred: "Zentra Wallet", terms: "e-wallet, ewallet\n digital wallet ,," });
    expect(result).toMatchObject({
      data: { config: { preferred: "Zentra Wallet", variants: ["e-wallet", "ewallet", "digital wallet"] } },
    });
  });

  it("builds banned phrase settings", () => {
    expect(parseRule({ ...base, type: "banned_phrase", terms: "risk-free" })).toMatchObject({
      data: { config: { phrases: ["risk-free"] } },
    });
  });

  it("ignores term fields left over from another rule type", () => {
    expect(parseRule({ ...base, preferred: "Old", terms: "old" })).toMatchObject({ data: { config: {} } });
  });

  it.each([
    ["no approved term", { ...base, type: "terminology", terms: "x" }, "Enter the approved term."],
    ["no terms", { ...base, type: "terminology", preferred: "X", terms: " , " }, "List at least one term or phrase to flag."],
    ["no banned phrases", { ...base, type: "banned_phrase" }, "List at least one term or phrase to flag."],
    ["a blank title", { ...base, title: "   " }, "Enter the title."],
    ["a missing excerpt", { ...base, sourceExcerpt: undefined }, "Enter the source excerpt."],
    ["an unknown type", { ...base, type: "other" }, "Choose a rule type."],
    ["an unknown severity", { ...base, severity: "extreme" }, "Choose a severity."],
    ["an oversized title", { ...base, title: "x".repeat(121) }, "The title must be 120 characters or fewer."],
  ])("rejects %s with a clear message", (_name, values, message) => {
    expect(parseRule(values)).toEqual({ error: message });
  });
});
