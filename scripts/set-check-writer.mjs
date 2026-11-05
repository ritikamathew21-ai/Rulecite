// Creates the check writer secret if needed, and stores only its hash in the database.
// Usage: npm run db:writer. The secret stays in .env.local and is never printed.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

let secret = process.env.CHECK_WRITER_SECRET;
if (!secret) {
  secret = randomBytes(32).toString("base64url");
  const env = readFileSync(".env.local", "utf8");
  appendFileSync(".env.local", `${env.endsWith("\n") ? "" : "\n"}CHECK_WRITER_SECRET=${secret}\n`);
}

const hash = createHash("sha256").update(secret).digest("hex");
const sql = `insert into private.check_writer (secret_hash) values (decode('${hash}', 'hex')) on conflict (id) do update set secret_hash = excluded.secret_hash`;

const result = spawnSync(process.execPath, ["scripts/supabase-remote.mjs", "db", "query", sql, "--yes"], {
  encoding: "utf8",
  input: "",
});
if (result.status !== 0) {
  console.error("Could not store the writer hash.");
  process.exit(1);
}
console.log("Check writer is set.");
