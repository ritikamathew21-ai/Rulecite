import { describe, expect, it } from "vitest";
import { DEMO_ASSETS, DEMO_FACTS, DEMO_ORG_NAME, DEMO_RULES, DEMO_USERS } from "../scripts/seed-demo.mjs";

describe("demo seed data", () => {
  it("labels the organisation as a fictional demonstration", () => {
    expect(DEMO_ORG_NAME).toMatch(/fictional demo/i);
  });

  it("uses only the reserved example.com domain", () => {
    expect(DEMO_USERS.every((user) => user.email.endsWith("@example.com"))).toBe(true);
  });

  it("uses generic demo names", () => {
    expect(DEMO_USERS.every((user) => user.name.startsWith("Demo "))).toBe(true);
  });

  it("cites a fictional source on every rule", () => {
    expect(DEMO_RULES.every((rule) => rule.source_name.includes("(fictional)"))).toBe(true);
  });

  it("cites a fictional source on every fact", () => {
    expect(DEMO_FACTS.every((fact) => fact.source_name.includes("(fictional)"))).toBe(true);
  });

  it("includes an expired fact and valid hex colours", () => {
    expect(DEMO_FACTS.some((fact) => fact.expires_on === "2026-06-30")).toBe(true);
    expect(DEMO_ASSETS.every((asset) => /^#[0-9A-F]{6}$/.test(asset.value))).toBe(true);
  });

  it("uses valid, unique rule IDs", () => {
    const codes = DEMO_RULES.map((rule) => rule.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z]{2,6}-[0-9]{2,4}$/.test(code))).toBe(true);
  });

  it("covers each role exactly once", () => {
    expect(DEMO_USERS.map((user) => user.role).sort()).toEqual(["admin", "creator", "reviewer"]);
  });
});
