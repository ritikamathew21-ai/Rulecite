import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePublicEnv } from "@/lib/env";

const valid = { url: "https://example.supabase.co", publishableKey: "sb_publishable_fake" };

describe("parsePublicEnv", () => {
  it("accepts a valid URL and publishable key", () => {
    expect(parsePublicEnv(valid)).toEqual(valid);
  });

  it.each([
    ["a secret key", { ...valid, publishableKey: "sb_secret_fake" }],
    ["a missing key", { url: valid.url }],
    ["a missing URL", { publishableKey: valid.publishableKey }],
    ["an http URL", { ...valid, url: "http://example.supabase.co" }],
  ])("rejects %s", (_name, values) => {
    expect(() => parsePublicEnv(values)).toThrow("Check .env.local");
  });

  it("does not repeat the rejected value in the error", () => {
    expect(() => parsePublicEnv({ ...valid, publishableKey: "sb_secret_do_not_print" })).toThrow(
      expect.not.objectContaining({ message: expect.stringContaining("do_not_print") }),
    );
  });
});

describe("application source", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? sourceFiles(path) : [path];
    });

  it("never references privileged variables", () => {
    const offenders = sourceFiles("src").filter((path) =>
      /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_PASSWORD|GEMINI_API_KEY|DEMO_USER_PASSWORD/.test(readFileSync(path, "latin1")),
    );
    expect(offenders).toEqual([]);
  });

  it("reads the check writer secret in one server-only file", () => {
    const readers = sourceFiles("src").filter((path) => readFileSync(path, "latin1").includes("CHECK_WRITER_SECRET"));
    expect(readers.map((path) => path.replaceAll("\\", "/"))).toEqual(["src/lib/analysis/run.ts"]);
    expect(readFileSync("src/lib/analysis/run.ts", "utf8")).toMatch(/^import "server-only";/);
  });

  it("marks the server client server-only", () => {
    expect(readFileSync("src/lib/supabase/server.ts", "utf8")).toMatch(/^import "server-only";/);
  });
});
