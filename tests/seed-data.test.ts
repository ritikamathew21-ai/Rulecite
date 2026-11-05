import { describe, expect, it } from "vitest";
import { DEMO_ORG_NAME, DEMO_USERS } from "../scripts/seed-demo.mjs";

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

  it("covers each role exactly once", () => {
    expect(DEMO_USERS.map((user) => user.role).sort()).toEqual(["admin", "creator", "reviewer"]);
  });
});
