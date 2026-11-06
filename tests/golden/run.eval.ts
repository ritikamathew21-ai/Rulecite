import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "vitest";
import { ProviderError } from "@/lib/ai/provider";
import { aiTimeoutMs, selectProvider } from "@/lib/ai/select";
import { aiFacts, aiRules, buildPrompt, verifyAiOutput } from "@/lib/analysis/ai";
import { runDeterministicChecks } from "@/lib/analysis/deterministic";
import type { ApprovedFact, ApprovedRule, FindingDraft } from "@/lib/analysis/types";
import { DEMO_ASSETS, DEMO_FACTS, DEMO_RULES } from "../../scripts/seed-demo.mjs";
import { applyAdjudications } from "./adjudication";
import { GOLDEN_DOCUMENTS, type GoldenDocument } from "./documents";
import { addTally, emptyTally, metrics, scoreDocument, type Miss, type Tally } from "./score";

// Usage: npm run eval:golden. Scores saved responses and makes no AI calls.
// Add GOLDEN_CALLS=1 to fetch missing responses. Each is one request, with no retry.
// GOLDEN_VIEW=adjudicated or adjudicated-best rescores against the post-result labels, in a separate report.
const LABEL = process.env.GOLDEN_LABEL || "baseline";
const VIEW = process.env.GOLDEN_VIEW;
const RUNS = Number(process.env.GOLDEN_RUNS) || 3;
const SPACING_MS = Number(process.env.GOLDEN_SPACING_MS) || 8_000;
const MAX_CALLS = Number(process.env.GOLDEN_MAX_CALLS) || 60;
const SPLITS = (process.env.GOLDEN_SPLITS || "dev,holdout").split(",");
// Pinned so an expired fact stays expired in every run.
const TODAY = "2026-11-06";

type Saved = { doc: string; run: number; labels: string; model: string; raw: string | null; failure: string | null };

const folder = "tests/golden/results";
const responsesFile = `${folder}/${LABEL}.jsonl`;
const reportFile = `${folder}/${LABEL}${VIEW ? `.${VIEW}` : ""}.md`;
const note = (line: string) => appendFileSync(`${folder}/${LABEL}.log`, `${new Date().toISOString()} ${line}\n`);
const labelsHash = createHash("sha256").update(readFileSync("tests/golden/documents.ts", "utf8").replace(/\r\n/g, "\n")).digest("hex").slice(0, 12);

const approved = <T extends { status: string }>(rows: T[]) => rows.filter(({ status }) => status === "approved");
const rules = approved(DEMO_RULES).map((rule) => ({ ...rule, id: rule.code, version: 1 })) as unknown as ApprovedRule[];
const facts = approved(DEMO_FACTS).map((fact) => ({ ...fact, id: fact.code })) as ApprovedFact[];
const palette = approved(DEMO_ASSETS).map(({ value }) => value);
const usableRules = aiRules(rules);
const usableFacts = aiFacts(facts, TODAY);
const labelled = VIEW ? applyAdjudications(GOLDEN_DOCUMENTS, VIEW === "adjudicated-best") : GOLDEN_DOCUMENTS;
const documents = labelled.filter(({ split }) => SPLITS.includes(split));

const readSaved = (): Saved[] =>
  existsSync(responsesFile)
    ? readFileSync(responsesFile, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];

const codeFindings = ({ text, images = [], colours = [] }: GoldenDocument) =>
  runDeterministicChecks({ text, images, colours }, rules, palette);

async function collect() {
  const provider = selectProvider();
  if (!provider) throw new Error("No AI provider is configured");

  const done = new Set(readSaved().map(({ doc, run }) => `${doc}:${run}`));
  const pending = Array.from({ length: RUNS }, (_, index) => index + 1).flatMap((run) =>
    documents.filter(({ id }) => !done.has(`${id}:${run}`)).map((document) => ({ document, run })),
  );

  let calls = 0;
  let failuresInARow = 0;
  for (const { document, run } of pending) {
    if (calls >= MAX_CALLS) return note(`Stopped at the limit of ${MAX_CALLS} calls. Run again to resume.`);
    if (calls > 0) await new Promise((resolve) => setTimeout(resolve, SPACING_MS));
    calls++;

    const saved = { doc: document.id, run, labels: labelsHash, model: provider.model };
    try {
      const prompt = buildPrompt(document.text, usableRules, usableFacts, TODAY);
      const raw = await provider.analyze({ ...prompt, signal: AbortSignal.timeout(aiTimeoutMs()) });
      appendFileSync(responsesFile, `${JSON.stringify({ ...saved, raw, failure: null })}\n`);
      failuresInARow = 0;
    } catch (error) {
      const reason = error instanceof ProviderError ? error.reason : "provider_unavailable";
      note(`${document.id} run ${run}: ${reason}`);
      // Bad output is a real result. Anything else says nothing about quality, so a later run fetches it again.
      if (reason === "invalid_output") {
        appendFileSync(responsesFile, `${JSON.stringify({ ...saved, raw: null, failure: reason })}\n`);
        continue;
      }
      if (["quota_exhausted", "rate_limited", "provider_auth"].includes(reason) || ++failuresInARow === 3) {
        return note(`Stopped after ${calls} calls: ${reason}. Run again later to resume.`);
      }
    }
  }
  note(`Finished with ${calls} calls.`);
}

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const row = (name: string, tally: Tally) => {
  const { precision, recall, f1 } = metrics(tally);
  const { truePositives: tp, falsePositives: fp, falseNegatives: fn, duplicates, ignored } = tally;
  return `| ${name} | ${percent(precision)} | ${percent(recall)} | ${percent(f1)} | ${tp} | ${fp} | ${fn} | ${duplicates} | ${ignored} |`;
};

function scorePass(findingsFor: (document: GoldenDocument) => FindingDraft[], split: string) {
  const tally = emptyTally();
  const misses: (Miss & { doc: string })[] = [];
  for (const document of documents.filter((candidate) => candidate.split === split)) {
    const scored = scoreDocument(document, findingsFor(document));
    addTally(tally, scored.tally);
    misses.push(...scored.misses.map((miss) => ({ ...miss, doc: document.id })));
  }
  return { tally, misses };
}

function report() {
  const saved = readSaved();
  const runs = [...new Set(saved.map(({ run }) => run))].sort();
  const lines = [`# Golden set: ${LABEL}`, "", `Labels ${labelsHash}. Today pinned to ${TODAY}.`];
  if (VIEW) lines.push("", `POST-RESULT ADJUDICATION (${VIEW}). These labels were changed after the results were seen.`);

  const stale = saved.filter(({ labels }) => labels !== labelsHash).length;
  if (stale > 0) lines.push("", `WARNING: ${stale} saved responses used different labels.`);

  const header = ["| Pass | Precision | Recall | F1 | Correct | False alarms | Missed | Repeats | Ignored |", "|---|---|---|---|---|---|---|---|---|"];

  for (const split of SPLITS) {
    lines.push("", `## ${split}`, "", ...header);
    const code = scorePass(codeFindings, split);
    lines.push(row("Code checks only", code.tally));

    const issues = new Map<string, number>();
    const count = (miss: Miss & { doc: string }) => {
      const key = `${miss.doc} | ${miss.kind} | ${miss.rule} | ${miss.quote ?? "(whole document)"}`;
      issues.set(key, (issues.get(key) ?? 0) + 1);
    };

    const combined = emptyTally();
    let missing = 0;
    let invalid = 0;
    let dropped = 0;
    for (const run of runs) {
      const scored = scorePass((document) => {
        const response = saved.find(({ doc, run: savedRun }) => doc === document.id && savedRun === run);
        if (!response) missing++;
        if (response?.failure) invalid++;
        if (!response?.raw) return codeFindings(document);
        const verified = verifyAiOutput(response.raw, document.text, usableRules, usableFacts, TODAY);
        dropped += verified.dropped;
        return [...codeFindings(document), ...verified.findings];
      }, split);
      lines.push(row(`Code and AI, run ${run}`, scored.tally));
      addTally(combined, scored.tally);
      scored.misses.forEach(count);
    }

    if (runs.length > 0) {
      lines.push(row("Code and AI, all runs", combined));
      lines.push("", `Claim status right: ${combined.statusRight} of ${combined.statusTotal}. Missing responses: ${missing}. Invalid output: ${invalid}. Findings dropped by verification: ${dropped}.`);
    } else {
      code.misses.forEach(count);
    }

    lines.push("", `### Errors (${runs.length > 0 ? `count across ${runs.length} runs` : "code checks only"})`, "");
    for (const [key, times] of [...issues].sort()) lines.push(`- ${times}x ${key}`);
  }

  writeFileSync(reportFile, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

test("golden set", async () => {
  mkdirSync(folder, { recursive: true });
  if (VIEW && process.env.GOLDEN_CALLS === "1") throw new Error("Adjudicated views only rescore saved responses");
  if (process.env.GOLDEN_CALLS === "1") await collect();
  report();
});
