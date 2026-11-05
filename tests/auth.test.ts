import { describe, expect, it } from "vitest";
import { DEFAULT_PATH, safeNextPath } from "@/lib/auth/redirects";
import { loginSchema } from "@/lib/auth/schema";

describe("safeNextPath", () => {
  it.each(["/workspace", "/rulebook/MSG-04", "/documents?status=draft"])("keeps the internal path %s", (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ["another site", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash URL", "/\\evil.example"],
    ["an encoded slash", "/%2Fevil.example"],
    ["an encoded backslash", "/%5Cevil.example"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a control character", "/work\tspace"],
    ["a relative path", "workspace"],
    ["the login page", "/login"],
    ["an empty value", ""],
    ["a missing value", null],
    ["a non-string value", 42],
  ])("falls back for %s", (_name, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_PATH);
  });
});

describe("loginSchema", () => {
  it("accepts an email and password", () => {
    expect(loginSchema.safeParse({ email: "person@example.com", password: "secret" }).success).toBe(true);
  });

  it.each([
    ["a malformed email", { email: "person", password: "secret" }],
    ["an empty password", { email: "person@example.com", password: "" }],
    ["an oversized password", { email: "person@example.com", password: "x".repeat(201) }],
    ["missing fields", {}],
  ])("rejects %s", (_name, values) => {
    expect(loginSchema.safeParse(values).success).toBe(false);
  });
});
