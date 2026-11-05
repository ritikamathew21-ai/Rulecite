import { describe, expect, it } from "vitest";
import { parseAsset } from "@/lib/assets/schema";
import { factCodeSchema, factValidity, parseFact, todayInIndia } from "@/lib/facts/schema";

const base = { statement: " No transfer fee. ", sourceName: "Fee schedule", validFrom: "2026-01-01" };

describe("parseFact", () => {
  it("maps a fact to database fields and treats blanks as empty", () => {
    expect(parseFact({ ...base, sourceUrl: "", expiresOn: "" })).toEqual({
      data: {
        statement: "No transfer fee.",
        source_name: "Fee schedule",
        source_url: null,
        valid_from: "2026-01-01",
        expires_on: null,
      },
    });
  });

  it("keeps a valid link and expiry date", () => {
    expect(parseFact({ ...base, sourceUrl: "https://example.com/fees", expiresOn: "2026-12-31" })).toMatchObject({
      data: { source_url: "https://example.com/fees", expires_on: "2026-12-31" },
    });
  });

  it("allows a fact that expires on its start date", () => {
    expect(parseFact({ ...base, expiresOn: "2026-01-01" })).toHaveProperty("data");
  });

  it.each([
    ["a script link", { ...base, sourceUrl: "javascript:alert(1)" }, "The source link must start with http:// or https://."],
    ["a data link", { ...base, sourceUrl: "data:text/html,x" }, "The source link must start with http:// or https://."],
    ["an expiry before the start", { ...base, expiresOn: "2025-12-31" }, "The expiry date cannot be before the start date."],
    ["a blank statement", { ...base, statement: "  " }, "Enter the approved statement."],
    ["a missing source", { ...base, sourceName: undefined }, "Enter the source name."],
    ["an invalid start date", { ...base, validFrom: "01/02/2026" }, "Enter the date this fact starts."],
  ])("rejects %s", (_name, values, message) => {
    expect(parseFact(values)).toEqual({ error: message });
  });
});

describe("factCodeSchema", () => {
  it("accepts FACT-07 and rejects lowercase", () => {
    expect(factCodeSchema.safeParse("FACT-07").success).toBe(true);
    expect(factCodeSchema.safeParse("fact-07").success).toBe(false);
  });
});

describe("factValidity", () => {
  it.each([
    ["2026-01-01", null, "2026-11-05", "current"],
    ["2026-01-01", "2026-11-06", "2026-11-05", "current"],
    ["2026-01-01", "2026-11-05", "2026-11-05", "current"],
    ["2026-01-01", "2026-11-04", "2026-11-05", "expired"],
    ["2026-11-05", null, "2026-11-05", "current"],
    ["2026-11-06", null, "2026-11-05", "not_yet_valid"],
    ["2026-11-06", "2026-12-31", "2026-11-05", "not_yet_valid"],
  ])("from %s to %s on %s is %s", (validFrom, expiresOn, today, expected) => {
    expect(factValidity(validFrom, expiresOn, today)).toBe(expected);
  });

  it("expires exactly at midnight in India", () => {
    const last = todayInIndia(new Date("2026-11-05T18:29:59Z"));
    const next = todayInIndia(new Date("2026-11-05T18:30:00Z"));
    expect(factValidity("2026-01-01", "2026-11-05", last)).toBe("current");
    expect(factValidity("2026-01-01", "2026-11-05", next)).toBe("expired");
  });
});

describe("todayInIndia", () => {
  it("uses the India date, not the server's UTC date", () => {
    expect(todayInIndia(new Date("2026-11-05T19:00:00Z"))).toBe("2026-11-06");
    expect(todayInIndia(new Date("2026-11-05T18:00:00Z"))).toBe("2026-11-05");
  });
});

describe("parseAsset", () => {
  it("normalises hex values to capitals", () => {
    expect(parseAsset({ code: "CLR-01", name: " Indigo ", value: " #2b2d8c " })).toEqual({
      data: { code: "CLR-01", name: "Indigo", value: "#2B2D8C" },
    });
  });

  it.each([
    ["a colour name", { code: "CLR-01", name: "Red", value: "red" }, "Enter the colour as a hex value like #2340D6."],
    ["a short hex", { code: "CLR-01", name: "Red", value: "#FFF" }, "Enter the colour as a hex value like #2340D6."],
    ["a bad ID", { code: "red", name: "Red", value: "#FF0000" }, "Use a colour ID like CLR-01: capital letters, a hyphen, then numbers."],
    ["a blank name", { code: "CLR-01", name: " ", value: "#FF0000" }, "Enter the colour name."],
  ])("rejects %s", (_name, values, message) => {
    expect(parseAsset(values)).toEqual({ error: message });
  });
});
