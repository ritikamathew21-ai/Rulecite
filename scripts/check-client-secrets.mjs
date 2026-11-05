// Fails if a server-only secret value reached the browser build. Never prints values.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const SECRET_NAMES = ["GEMINI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_DB_PASSWORD", "DEMO_USER_PASSWORD"];
const BUILD_DIR = ".next/static";

export function readSecrets(envText) {
  const secrets = [];
  for (const line of envText.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    const value = match?.[2].trim().replace(/^["']|["']$/g, "");
    if (match && SECRET_NAMES.includes(match[1]) && value) secrets.push({ name: match[1], value });
  }
  return secrets;
}

export function findLeaks(dir, secrets) {
  const leaks = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      leaks.push(...findLeaks(path, secrets));
      continue;
    }
    const content = readFileSync(path, "latin1");
    for (const { name, value } of secrets) {
      if (content.includes(value)) leaks.push({ name, path });
    }
  }
  return leaks;
}

if (process.argv[1]?.endsWith("check-client-secrets.mjs")) {
  if (!existsSync(BUILD_DIR)) {
    console.error(`FAIL: ${BUILD_DIR} not found. Run npm run build first.`);
    process.exit(1);
  }
  const secrets = existsSync(".env.local") ? readSecrets(readFileSync(".env.local", "utf8")) : [];
  const leaks = findLeaks(BUILD_DIR, secrets);
  for (const { name, path } of leaks) console.error(`LEAK: ${name} found in ${path}`);
  console.log(`Checked ${secrets.length} secret value(s) in ${BUILD_DIR}: ${leaks.length} leak(s).`);
  process.exit(leaks.length ? 1 : 0);
}
