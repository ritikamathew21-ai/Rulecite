import { describe, expect, it } from "vitest";
import { connectionUrl, redact } from "../scripts/supabase-remote.mjs";

describe("connectionUrl", () => {
  it("encodes special characters in the password", () => {
    const url = new URL(connectionUrl("https://abc123.supabase.co", "p@ss/w:rd?"));
    expect(url.username).toBe("postgres.abc123");
    expect(decodeURIComponent(url.password)).toBe("p@ss/w:rd?");
  });
});

describe("redact", () => {
  it("removes every secret and every repeat", () => {
    expect(redact("a secret b secret c other", ["secret", "other"])).toBe("a [REDACTED] b [REDACTED] c [REDACTED]");
  });
});
