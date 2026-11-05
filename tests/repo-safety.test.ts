import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findLeaks, readSecrets } from "../scripts/check-client-secrets.mjs";

const envExample = readFileSync(".env.example", "utf8");
const isIgnored = (path: string) => {
  try {
    execFileSync("git", ["check-ignore", "-q", path]);
    return true;
  } catch {
    return false;
  }
};

describe(".env.example", () => {
  it("leaves every secret blank", () => {
    for (const name of ["GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_PASSWORD", "DEMO_USER_PASSWORD", "CHECK_WRITER_SECRET"]) {
      expect(envExample).toMatch(new RegExp(`^${name}=$`, "m"));
    }
  });

  it("gives server secrets no NEXT_PUBLIC_ name", () => {
    const publicNames = envExample.match(/^NEXT_PUBLIC_\w+/gm) ?? [];
    expect(publicNames.filter((name) => /SECRET|SERVICE|GEMINI|PASSWORD/.test(name))).toEqual([]);
  });
});

describe(".gitignore", () => {
  it.each([".env", ".env.local", ".env.production", "key.pem", "survey_links.md"])(
    "ignores %s",
    (path) => expect(isIgnored(path)).toBe(true),
  );

  it("keeps .env.example trackable", () => {
    expect(isIgnored(".env.example")).toBe(false);
  });
});

describe("client secret scan", () => {
  const secrets = readSecrets('GEMINI_API_KEY="fake-secret-value"\nSOME_PUBLIC=visible\nSUPABASE_SERVICE_ROLE_KEY=\n');

  it("reads only named, non-empty secrets", () => {
    expect(secrets).toEqual([{ name: "GEMINI_API_KEY", value: "fake-secret-value" }]);
  });

  it("finds a leaked value and passes clean files", () => {
    const dir = mkdtempSync(join(tmpdir(), "rulecite-scan-"));
    try {
      writeFileSync(join(dir, "clean.js"), "const a = 1;");
      expect(findLeaks(dir, secrets)).toEqual([]);
      writeFileSync(join(dir, "bad.js"), 'const k = "fake-secret-value";');
      expect(findLeaks(dir, secrets)).toEqual([{ name: "GEMINI_API_KEY", path: join(dir, "bad.js") }]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
