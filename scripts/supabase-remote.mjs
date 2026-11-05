// Runs a Supabase CLI command against the hosted project through the Session Pooler,
// because the direct database host is IPv6-only. Output is redacted.
// Usage: node --env-file=.env.local scripts/supabase-remote.mjs db push --dry-run
import { spawnSync } from "node:child_process";

const POOLER_HOST = "aws-0-ap-southeast-1.pooler.supabase.com";

export function connectionUrl(projectUrl, password) {
  const ref = new URL(projectUrl).hostname.split(".")[0];
  return `postgresql://postgres.${ref}:${encodeURIComponent(password)}@${POOLER_HOST}:5432/postgres?sslmode=require`;
}

export const redact = (text, secrets) =>
  secrets.reduce((output, secret) => output.replaceAll(secret, "[REDACTED]"), text);

if (process.argv[1]?.endsWith("supabase-remote.mjs")) {
  const { NEXT_PUBLIC_SUPABASE_URL: projectUrl, SUPABASE_DB_PASSWORD: password } = process.env;
  if (!projectUrl || !password) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_DB_PASSWORD. Use --env-file=.env.local.");
    process.exit(1);
  }

  const url = connectionUrl(projectUrl, password);
  const result = spawnSync(
    process.execPath,
    ["node_modules/supabase/dist/supabase.js", ...process.argv.slice(2), `--remote=${url}`],
    { encoding: "utf8", input: "" },
  );
  const secrets = [url, password, encodeURIComponent(password)];
  process.stdout.write(redact(result.stdout ?? "", secrets));
  process.stderr.write(redact(result.stderr ?? "", secrets));
  process.exit(result.status ?? 1);
}
