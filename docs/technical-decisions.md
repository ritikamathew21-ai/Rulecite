# Rulecite technical decisions

Status: **approved by the project owner on 2026-11-04**. Last updated 2026-11-06.

The product is built and deployed. Early decisions below keep the reasoning from the time, and they are updated where the build differs. Gemini facts dated 2026-11-04 come from Google's documentation, the SDK's type definitions and the live tests under TD-05.

## Summary

| ID | Decision | Status |
|---|---|---|
| TD-01 | Next.js, TypeScript, route handlers on Vercel | In use |
| TD-02 | Supabase for Postgres, Auth and row-level security | In use. Storage is not used, because uploads are not kept |
| TD-03 | No pgvector. Rules are selected by type, and full-text search is planned | In use, changes deck slide 11 |
| TD-04 | Gemini API free tier as the AI provider | Decided by project owner, changes deck slide 11 |
| TD-05 | `gemini-3.1-flash-lite` as the default model | Decided by project owner, in use, with temporary provider errors seen |
| TD-06 | `generateContent` as the provisional route | In use, with temporary provider errors seen |
| TD-07 | Provider-neutral analysis engine | In use |
| TD-08 | Deterministic checks never depend on AI | In use |
| TD-09 | AI failure produces a `partial` run | In use |
| TD-10 | Validate, then verify, before saving AI findings | In use |
| TD-11 | Fictional or synthetic data only through the free tier | Decided by project owner, changes deck slide 14 |
| TD-12 | API budget of ₹0, with no billing | Decided by project owner |

## TD-01: Application stack

Use Next.js 16, TypeScript, Tailwind, Zod and route handlers, hosted on Vercel Hobby. One language covers the full stack, and Vercel's 300-second function limit is enough to run a check inside a request, so no job queue is needed.

## TD-02: Data, authentication and files

Use Supabase. Every organisation-owned table is protected by row-level security. The service role key stays on the server.

## TD-03: Retrieval without pgvector

Select rules by type, and send the whole fact ledger while it is small. Channel selection and Postgres full-text search are not built, so there is no retrieval step yet. Full-text search is the planned way to narrow facts as the ledger grows.

A demo rulebook does not justify an embedding pipeline. Slide 11 named pgvector, so this change appears in the Round 2 submission.

## TD-04: AI provider

Use the Gemini API free tier through the official `@google/genai` SDK, pinned below version 3.0.0. The Anthropic API is not used, and no Anthropic dependency is installed.

Verified on 2026-11-04:

| Item | Finding |
|---|---|
| SDK | `@google/genai` 2.32.0, Apache-2.0, requires Node 20 or later. Version 3.0.0 will require Node 22 or later |
| Region | India is a supported country |
| Free-tier data use | Google may use prompts and responses to improve its products, and human reviewers may read them |
| Sensitive data | Google's terms say not to submit sensitive, confidential or personal information to unpaid services |
| Age | Users of the API must be 18 or older. The app must not be aimed at, or likely to be accessed by, under-18s |
| UK, EEA, Switzerland | Clients made available to users in these places must use paid services only |

Consequences:
- The deployed app stays behind login.
- Test accounts go only to judges and adult testers outside the UK, EEA and Switzerland.
- Paid-tier data protections are not available in this configuration, and the product must not imply that they are.

## TD-05: Default model

Default: `gemini-3.1-flash-lite`, set through `GEMINI_MODEL`. The project owner chose it from the project's AI Studio rate-limit dashboard.

| Model | Role | Docs status | Free tier | Structured output evidence |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | Default | Stable | Yes | Not stated in the docs. One live success through `generateContent` |
| `gemini-3.8-flash` | Optional alternative | New | Yes | Used in Google's structured-output examples |

Changing model means changing `GEMINI_MODEL` only. The app does not switch models automatically, because each model has its own quota and accuracy.

Integration gate: Gemini integration does not start until the project owner approves it after the retest below.

Rejected:
- `gemini-4-argon` and `gemini-3.1-pro-preview`: no free tier.
- `gemini-2.5-flash` and `gemini-2.5-pro`: deprecated, and requests are rerouted to other models from 2026-12-01.

### Live verification

Status on 2026-11-04: **model ID recognised and structured JSON succeeded once. Reliability is not proven.**

The test lists the models visible to the project, then sends one fictional sentence. A structured request passes only if it completes, the output passes Zod, and a finding's quote and rule ID verify.

| Check | Result |
|---|---|
| No key | Stopped before any network call, as expected |
| Deliberately fake key | Rejected by Google with HTTP 400 `API_KEY_INVALID`, and the key did not appear in the output |
| Model ID | `gemini-3.1-flash-lite` recognised, listed for the project |
| Interactions API, structured request | 0 of 5 succeeded, all HTTP 503 |
| `generateContent`, structured request | 1 success and 1 HTTP 503 |
| API key in test output | 0 occurrences |

The failures were repeated HTTP 503 high-demand errors. The successful request finished normally, used 114 tokens, passed Zod, and passed quote and rule-ID verification.

Limits of this evidence:
- All requests ran in one short evening window, so they do not establish a normal failure rate.
- Both routes returned 503, so these results do not show that one route is more reliable than the other.
- The SDK may have retried Interactions requests internally, so the real number of attempts may be higher than 5.
- It is unknown whether HTTP 503 responses count against quota.
- No HTTP 429 occurred, so 429 handling has not been tested against the real API.

### Approved retest, 2026-11-05 20:21 IST

One structured request per route, using `gemini-3.1-flash-lite` and the same fictional sentence, with SDK retries disabled.

| Route | Result | HTTP calls | Time | Quote returned |
|---|---|---|---|---|
| `generateContent` | Passed Zod, quote and rule ID verification | 1 | 1.2s | "lowest fees" |
| Interactions | Passed Zod, quote and rule ID verification | 1 | 1.2s | "lowest fees in India" |

Totals so far: `generateContent` 2 of 3 requests succeeded, and Interactions 1 of 6.

- The Interactions route retries up to 4 times by default, so the earlier 5 failed calls may have been up to 25 attempts. Retries are turned off with `{ retries: { strategy: "none" } }`, and on `generateContent` with `httpOptions.retryOptions.attempts: 1`.
- Both routes returned valid output, so the earlier failures fit a temporary demand problem rather than a fault in either route. Two evenings of samples are not enough to call either reliable.
- The two responses quoted different spans of the same claim, so tests must not expect one exact quote from the model.
- The project owner approved integration through `generateContent` after this retest.

### Retest rules

A retest happens only after explicit approval from the project owner.

- Send one structured request per route initially, using the same model and fictional sentence.
- Use no automatic retries, including SDK retries.
- Send nothing further without new approval.

## TD-06: Gemini request shape

Use `client.models.generateContent` as the provisional integration route. It is the only route with a successful structured response so far, but one success is not proof of reliability. Google still supports it, and describes it as the original API.

- Set `responseMimeType` to `application/json`, and `responseJsonSchema` to a JSON Schema generated from the Zod schema.
- Read `response.text` only when the finish reason is `STOP`. Treat any other finish reason as a failure.
- Set SDK retries to one attempt, so retry behaviour is controlled in one place by TD-09.
- Google's free-tier data-use terms in TD-04 apply to this route.

The Interactions API is Google's recommended interface for new projects, so it stays under review. If a later retest favours it, the change stays inside `src/lib/ai/gemini.ts`. It would use `store: false`, because Interaction storage is on by default.

## TD-07: Provider-neutral engine

The analysis engine owns the prompt, Zod schema, verification and persistence. A provider adapter only sends the request and returns raw output, or throws a typed error.

```ts
interface AnalysisProvider {
  readonly name: string;
  readonly model: string;
  analyze(request: AnalysisRequest): Promise<string>;
}
```

Layout:

```text
src/lib/analysis/run.ts          orchestrates a check run
src/lib/analysis/deterministic/  rule-based checks, no AI imports
src/lib/analysis/ai.ts           prompt, Zod schema, and quote, rule and fact verification
src/lib/ai/provider.ts           interface, typed errors and the single retry
src/lib/ai/select.ts             AI_PROVIDER selection
src/lib/ai/gemini.ts             only file that imports @google/genai
```

Adding a provider means adding one adapter and one selection entry. No other adapter is built now.

Secrets:
- `GEMINI_API_KEY` is read only on the server, from `.env.local` locally and from Vercel environment settings when deployed.
- The modules that read the key or call Gemini use the `server-only` package, so importing them into browser code fails the build.
- `.env*` is ignored by git, except `.env.example`.
- It never uses a `NEXT_PUBLIC_` prefix.
- Keys never appear in source code, API responses, logs or commits.
- Raw provider errors are never logged or returned. Only the mapped `failure_reason` and a redacted status are kept.
- Each release is checked by searching the built browser files for secret values.

## TD-08: Deterministic checks

Terminology, banned phrases, readability, alt text, contrast and palette checks run first, in code. They pass their tests with no AI key configured. `deterministic/` has no AI imports, but no lint rule or test enforces that yet.

## TD-09: Failure handling

Code and AI findings are saved together when a check finishes, so a provider failure keeps the code findings. This differs from the original plan to save code findings first: an unexpected crash during the AI step loses that run, although the document stays saved and can be rechecked.

The adapter maps errors from the numeric HTTP `status`, never from the error class or message text. Live testing returned `InternalServerError` from Interactions and `ApiError` from `generateContent` for the same 503. A provider code only refines a 429 or 400 when it is present.

The application allows at most one retry per check. The retry must fit inside `AI_TIMEOUT_MS`, and quota reset times are never calculated or displayed.

| Provider result | Application retry | Run status | `failure_reason` |
|---|---|---|---|
| Success | None | `complete` | None |
| 429 with `quota_exceeded` | No | `partial` | `quota_exhausted` |
| Any other 429 | Once, after a short backoff | `partial` if it still fails | `rate_limited` |
| 500 | Once, after a short backoff | `partial` if it still fails | `provider_unavailable` |
| 502 | Once, after a short backoff | `partial` if it still fails | `provider_unavailable` |
| 503 | Once, after a short backoff | `partial` if it still fails | `provider_unavailable` |
| 504 | No | `partial` | `timeout` |
| Client timeout (`AI_TIMEOUT_MS` reached) | No | `partial` | `timeout` |
| Network failure with no HTTP status | Once, after a short backoff | `partial` if it still fails | `provider_unavailable` |
| Any other 5xx | No | `partial` | `provider_unavailable` |
| 400 with `API_KEY_INVALID`, 401, 403 | No | `partial` | `provider_auth` |
| Other 400, 404 | No | `partial` | `provider_request` |
| Blocked output | No | `partial` | `provider_blocked` |
| Incomplete, invalid JSON or Zod failure | No | `partial` | `invalid_output` |
| Synthetic-data confirmation absent | Not attempted | `partial` | `ai_not_confirmed` |
| Missing key or disabled provider | Not attempted | `partial` | `ai_not_configured` |

If a check cannot finish, no run is saved. The document stays saved, and the page says the check failed.

A `partial` run must show "AI checks skipped" with the reason. It must never display "no issues found". The Reviewer sees the same notice, and the Creator can rerun the check later.

An invalid key returned HTTP 400 with `API_KEY_INVALID` in testing, not 401, so the mapping reads the error reason as well as the HTTP status.

Not yet tested: how a real 429 appears through the SDK. Google's docs list `quota_exceeded`, but `generateContent` errors use Google's older format. A 429 without a recognised code follows the "any other 429" row, so it still ends as `partial`.

Required tests, using mocked responses and no API calls:
- Each status in the table produces the expected retry count, run status and `failure_reason`.
- Saved deterministic findings survive every failure.
- A `partial` run never displays "no issues found".
- Logs and API responses contain no key or raw provider error.

## TD-10: Validation and verification

Every AI result passes these steps in order:

1. Parse the provider output as JSON.
2. Validate the whole response with Zod. Failure gives a `partial` run.
3. Find the returned quote in the document's normalised text. The code calculates the offsets and never trusts model offsets.
4. Confirm the rule ID is an approved rule sent in this run.
5. Confirm any fact ID is an approved fact sent in this run.
6. Set the claim label in code, from the model's relation and the fact's expiry date.
7. Save the findings that pass, recording the rule version.

Findings that fail steps 3 to 5 are dropped and counted in `dropped_count`. Draft content is treated as data, so instructions inside a draft have no authority.

## TD-11: Free-tier data boundary

Only fictional or synthetic content may reach Gemini.

- Seed data uses Vornelle, a fictional brand. Golden documents are synthetic.
- The submission form states the rule and requires the user to confirm the content is fictional or synthetic.
- The server enforces this. Without confirmation, deterministic checks run, Gemini is not called, and the run is `partial` with `ai_not_confirmed`.
- The confirmation is stored on the document version with the user and time.
- User testers receive synthetic sample documents and must not use their own.
- `/trust` and the README disclose Gemini, the free tier, Google's data use and possible human review.

Limitation: the app cannot detect whether confirmed content is really fictional, so this control relies on the user's confirmation. Real organisations would need a paid or self-hosted provider, which TD-07 allows.

Deck impact: slide 14 says only the text being checked and relevant rules are sent to the model. That remains true, but the free-tier conditions must be disclosed alongside it.

## TD-12: API budget of ₹0

- Do not link a Cloud Billing account or prepay credits on the Google project.
- Do not use paid API access.
- Create the key in a project with no billing.
- Keep the per-organisation daily check limit, to protect shared quota.

## Quota plan

Limits vary by model, can change, and are shown at <https://aistudio.google.com/rate-limit>. They apply per project, not per key.

- Quota numbers and reset times are not hardcoded. The app reacts to provider errors instead of predicting when quota returns.
- The UI says AI checks can be rerun later, and it does not show a reset time.
- The golden-set runner is throttled and resumable.
- Saved responses record the model. Reports record the pinned date and any missing responses.
- Avoid evaluation runs immediately before a demo.

## Known dependency alerts

Recorded on 2026-11-04.

- `npm audit --omit=dev` reports 0 vulnerabilities in production dependencies.
- `npm audit` reported 16 moderate alerts in dev tooling at the end of Stage 1. They trace to one `minimatch` denial-of-service issue inside ESLint and its plugins.
- On 2026-11-05, after the Supabase packages were installed, the same command reported 8 moderate alerts. The reason for the drop has not been investigated.
- These packages run on the developer's machine and in linting, and they do not ship with the app.
- ESLint is not downgraded to silence them. npm's suggested fix would move to ESLint 4 and an obsolete `eslint-config-next`.
- Review again when `eslint-config-next` updates its dependencies.

## Supabase environment variables

| Variable | Purpose | Visible in browser | Where it is set |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project address | Yes, by design | `.env.local`, Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Identifies the app to Supabase. Access is limited by row-level security | Yes, by design | `.env.local`, Vercel |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin access that bypasses row-level security. Used only by local seed and test scripts | Never | `.env.local` only |
| `SUPABASE_DB_PASSWORD` | Direct database access for migrations | Never | `.env.local` only |
| `DEMO_USER_PASSWORD` | Shared password for the fictional Vornelle accounts, set by hand and used by the seed and tests | Never | `.env.local` only |
| `CHECK_WRITER_SECRET` | Lets the server save check results. Only its hash is stored in the database | Never | `.env.local`, Vercel |

The running app does not read the service role key or database password. If a later feature needs admin access, that needs a recorded decision first.

## Database access

- The hosted project is reached through the Supabase Session Pooler in Singapore (`ap-southeast-1`), because the direct database host is IPv6-only and could not be reached from the development network.
- Migrations live in `supabase/migrations` and run with `npm run db -- db push`, which redacts the connection string from output.
- Every table starts with row-level security on and client access revoked, so a table is never open between migrations.
- Docker is not installed, so migrations run against the hosted project. There is no local database to test them on first.

## Access model

Access is enforced in the database by row-level security, column grants and triggers. Frontend role checks are only for display.

| Action | Creator | Reviewer | Admin | Non-member or anonymous |
|---|---|---|---|---|
| Read own organisation and its members | Yes | Yes | Yes | No |
| Read audit log | No | Yes | Yes | No |
| Rename organisation | No | No | Yes | No |
| Change another member's role | No | No | Yes | No |
| Change own role | No | No | No | No |
| Write or alter audit log | No | No | No | No |

- Adding and removing members has no client path yet, because invites are postponed.
- Audit entries have no client write path, so they cannot be forged. Database triggers write them.
- `audit_log` is append-only, even for service-role connections.
- `npm run test:rls` proves this against the hosted project, using temporary users deleted after each run.
- Each run adds 2 permanent audit rows to the fictional test organisations, because audit rows cannot be deleted.

## Rulebook

- Rules have an ID, type, severity, instruction and source excerpt. New rules start as drafts, and only Admins can add, approve or retire them.
- Creators see approved rules only. Reviewers and Admins also see drafts, retired rules and version history.
- Database triggers own the version number, approval details, revisions and audit entries, so clients cannot forge them.
- Editing a rule's content creates a new version and returns it to draft, even if an approval is requested in the same change. Changing status alone does not create a version.
- Approving, retiring, restoring and editing apply only to the version and status the Admin was viewing. If either changed, nothing is applied and the Admin is told. Colours bind to status only, because their content cannot change. This binding is in the server actions, so a direct API call by an Admin is not covered.
- A retired rule cannot be edited or approved until it is restored to draft. The database enforces this.
- Seeded rules are approved by the seed script signing in as the Demo Admin, so the approver and audit entry are real.
- The seed runs once. It refuses if a Vornelle organisation or any demo account exists, so it can never overwrite accounts, roles or brand data. A failed run reports its stages and created IDs and is not rolled back. Recovery is manual, and is described in `seed-recovery.md`.
- Rules are retired, not deleted, so past findings can always cite them. Creators cannot read retired rules or old versions, so findings must store their own copy of the cited rule. This is required before findings ship.
- While an edited rule waits for re-approval, it is not approved, so it will not be applied by the check engine.
- Rule pages stream, so a hidden or missing rule shows the not-found page with HTTP 200. Row-level security keeps its content out of the response. Tests check the content rather than the status code.
- Channel-specific rules from the Round 1 plan are postponed until documents exist.

## Claim Ledger and Assets

- Facts have a source, a start date and an optional expiry date. They follow the Rulebook's approval, versioning and audit rules.
- Validity is calculated from today's date in India and never stored as a status. `factValidity()` is the single definition: a fact applies from its start date through its expiry date, inclusive.
- Only approved facts that are `current` can support a claim. An approved fact that has not started supports nothing, and one that has expired makes the claim Outdated.
- Source links must start with http:// or https://, enforced in the app and the database.
- Assets currently cover brand colours only. Logos and image files need Storage, and are planned with the image checks.
- Colours are immutable. To change one, retire it and add a replacement, so they need no versions.

## Documents and checks

- Clients have no direct write access to documents, versions, check runs or findings.
- `create_document()` creates a document and its first version together, for members of that organisation only.
- `record_check_run()` is the only way to save results. It requires `CHECK_WRITER_SECRET`, so a user cannot record a fake clean run through the API. Only its hash is stored, in the unexposed `private` schema.
- This secret is the one exception to keeping privileged credentials out of the running app. The project owner chose it over the service key, because a leak could only fake check results, not read or change other data.
- Authors, Reviewers and Admins can read a document and its results. Other Creators cannot.
- Uploaded files are parsed in memory and never stored. Only the extracted text, image descriptions and colours are kept.
- DOCX parsing uses `jszip` rather than `mammoth` from the deck, because `mammoth` discards text colours. It reads the main body only.
- Uploads are limited to 4 MB, because Vercel rejects request bodies over 4.5 MB.
- PDF intake uses `unpdf`, with a 100-page limit, and is parsed in memory. It reads text only, so images, alt text and colours in PDFs are not checked, and the document page says so. Scanned PDFs have no text and are rejected with a clear message. OCR is not included.
- Findings keep their own copy of the rule, so they stay readable if a rule is edited or retired.
- A run is `complete` only when AI checks finished. Otherwise it is `partial`, the page gives the reason, and it never claims a full review.
- AI runs only on content confirmed as fictional or synthetic. Otherwise the reason is `ai_not_confirmed`. A missing key or disabled provider gives `ai_not_configured`, and no approved AI rules gives `ai_no_rules`.
- The daily limit is reserved atomically in the database, per organisation, per India date. Reaching it gives `daily_limit`.
- `GEMINI_API_KEY` is read only in `src/lib/ai/select.ts`, and the SDK is imported only in `src/lib/ai/gemini.ts`.
- Automated tests never call Gemini. Unit tests use fake providers, and the browser suite runs with `AI_PROVIDER=disabled`.
- The model never sets severity or claim labels. Severity comes from the rule. Claim labels are decided in code: no match is Unsupported, a contradiction is Contradicted, an expired fact is Outdated, and a supported claim produces no finding.

## Review workflow

- Every step is a checked database function, so clients have no direct write access to decisions, comments or status.
- Only the author decides findings. Dismissing needs a reason, stored in `finding_decisions` for Gap Radar.
- Accepting applies a fix only when the finding has exact replacement text. Otherwise it is an acknowledgement, and the author edits the draft.
- High severity findings must be decided before submitting. Lower severity findings may stay open.
- A document cannot change while it is in review.
- Reviewers and Admins approve or request changes. Nobody can approve their own document, including Admins.
- Approval records the exact version, and a new version clears it.
- Each new version is checked again, so decisions do not carry over and a dismissed finding on unchanged text must be decided again.

## Gap Radar

- Insights is read-only and available to Reviewers and Admins. It uses existing findings and decisions, so it needs no extra tables.
- A problem is identified by document, rule and quote, using its latest outcome, so reruns and new versions do not inflate the counts.
- A rule "may be unclear" after at least 3 decisions, if half were dismissed or 2 dismissals said the rule is unclear.
- This is a signal for a person to review, not a measure of rule quality. Small numbers can mislead.
- It reads the latest 5,000 rows, which suits the demo. Larger organisations would need aggregation in the database.

## Accuracy measurement

- The golden set in `tests/golden` has 18 fictional documents and 28 labelled problems: 12 documents for development and 6 held out for measurement. Labels were written before any model run.
- The golden documents and saved responses keep the demo brand's earlier name, Zentra, because changing the text would invalidate the measured results. The runner uses that name for its rules and facts too.
- A finding is correct when it names the labelled rule and overlaps the labelled words. Some borderline findings are listed as allowed and count neither way.
- `npm run eval:golden` rescores saved responses with no AI calls. `GOLDEN_CALLS=1` fetches missing responses, one request each with no retry.
- Baseline, 3 runs on `gemini-3.1-flash-lite`, held-out documents: precision 87.5%, recall 87.5%, F1 87.5%. Expired offers were missed 6 of 6 times across both splits.
- The first attempt asked the model to report every claim. It failed: the expired offer was still missed 3 of 3 times on development documents, so it was reverted. The held-out documents were not used.
- The kept change marks expired facts in the prompt. Code decides what has expired. Held-out documents had one evaluation pass on the final prompt: 6 documents, 3 repeated model runs each, 18 responses. Precision 95.8%, recall 95.8%, F1 95.8%. Expired offers were caught 6 of 6 times across both splits.
- A label review after the results changed 4 labels, plus a sensitivity check on "best" in `d09`. It is recorded in `tests/golden/adjudication.ts`. The original labels in `documents.ts` were not changed, and they are the only labels set in advance.

| Set | Labels | Version | Precision | Recall | F1 | TP | FP | FN |
|---|---|---|---|---|---|---|---|---|
| Held-out | Original | Baseline | 87.5% | 87.5% | 87.5% | 21 | 3 | 3 |
| Held-out | Original | Expired facts marked | 95.8% | 95.8% | 95.8% | 23 | 1 | 1 |
| Held-out | Post-result adjudication | Baseline | 88.0% | 81.5% | 84.6% | 22 | 3 | 5 |
| Held-out | Post-result adjudication | Expired facts marked | 95.8% | 85.2% | 90.2% | 23 | 1 | 4 |
| Development | Original | Baseline | 82.1% | 91.7% | 86.6% | 55 | 12 | 5 |
| Development | Original | Expired facts marked | 84.5% | 100.0% | 91.6% | 60 | 11 | 0 |
| Development | Post-result adjudication | Baseline | 87.7% | 92.8% | 90.1% | 64 | 9 | 5 |
| Development | Post-result adjudication | Expired facts marked | 88.3% | 98.6% | 93.2% | 68 | 9 | 1 |

- Counts add up across 3 runs. Held-out: 6 documents, 18 responses per version, 24 label instances originally and 27 after adjudication. Development: 12 documents, 36 responses per version, 60 and 69. True negatives are not defined, because there is no fixed list of non-problems.
- Limits: the sample is small, and the original labels were written by the same AI-assisted author. Held-out F1 per run overlapped at 93.3% on the original labels (baseline 82.4% to 93.3%, after 93.3% to 100%). The held-out set was not fully blind, because the baseline report showed its errors before the fix was chosen, although tuning used development documents only. The adjudication was not blind either, because score effects were visible. These are benchmark results, not a general accuracy claim.
- Known errors that remain: "risk-free" is flagged in a sentence that denies it, "best" is flagged in ordinary use, and "never run out" was not caught under an accepted rule in any kept-change run.

## Authentication

- There is no public registration. Accounts are created by the seed script until invites exist.
- `src/proxy.ts` refreshes the session and redirects early. It is not the security boundary.
- `requireMember()` verifies the token signature with `getClaims()` and reads the role from the database under row-level security.
- Every protected page and server action must call `requireMember()`.
- A failed token check caused by a network or Supabase error is not treated as signed out. The proxy lets the request through, and `requireMember()` throws, so the user sees the error page with no access. Invalid or missing tokens still go to sign-in.
- `safeNextPath()` keeps post-login redirects on this site.
- Sign-in failures show one generic message, so the form does not reveal which emails exist.
- Sign-out uses local scope, because demo accounts may be shared.
- `npm run test:e2e` tests these journeys in a real browser against the production build.
- The session cookie is `HttpOnly`, `Secure` in production and `SameSite=Lax`, because page scripts never need the token. The browser Supabase client therefore has no session and acts as an anonymous visitor. Features that need signed-in data use the server.

## Health endpoint

- `GET /api/health` is public and returns only an overall status and database status, with HTTP 200 or 503. It is never cached.
- It calls `public.health_check()`, which reads no tables, using the publishable key.
- It skips the proxy, so it does not depend on sessions.

## Known test issues

- "a session keeps working across pages" failed once on 2026-11-05. The error was not captured, and the failure did not reproduce in 216 test executions across 8 evidence runs.
- The most likely cause is a response slower than the 5-second assertion on the first visit to `/audit`, but this is unproven.
- The investigation ruled out the proxy change and shared test state, and found token expiry very unlikely.
- Retries are deliberately not enabled. Failed tests now keep a trace and screenshot, so a recurrence can be diagnosed. Traces can contain the demo password, so they must not be shared.
- "does not create a version when only the status changes" failed once on 2026-11-05, then passed 4 of 4 runs. The error was not captured, so the cause is unproven. Possible causes are a duplicate random test ID (about a 1% chance per run), a temporary API error that the test ignored, or a rare real problem. Test IDs now use a sequence, and setup errors and update results now report themselves, so a repeat will show its cause.
- "creator signs in and sees the role from the database" failed once on 2026-11-05: the page stayed on sign-in past the 5-second assertion. It then passed 6 of 6 cold-start runs, and 49 timed sign-ins (25 direct to Supabase, 24 in a browser) stayed under 3 seconds with no errors. The trace was deleted by mistake, so the cause is unknown. A slow Supabase response is possible but unproven. Failed tests in `auth.spec.ts` now print the elapsed time, the page path and any on-page message.
- Fault injection was a one-off check. Slow-page behaviour and outage recovery have no permanent browser test. Unit tests cover how outages are classified.

## Interface

- Visual language: a blue-pencil margin, cool paper and highlighter yellow, taken from editors marking up copy. Highlighter marks the current page and flagged text in drafts.
- Navigation shows only pages that work. Features appear when they are built.
- The AI and data page states the current flow: Vercel Mumbai, processing in the United States (`iad1`), data in Singapore. Update it if the Function Region changes.
- Fonts are self-hosted at build time, so visitors make no requests to Google.
- Automated axe checks run on the main pages covered by the browser tests, not every page state. They do not replace manual accessibility testing.
- Pages show a loading message while slow data streams in. It does not appear until the server starts responding, because the shared layout reads the session.
- The error page's retry refetches from the server, so it recovers once a service returns.

## Schema changes from the plan

- `check_runs`: add `provider` and `failure_reason`. `status` allows `complete`, `partial` or `failed`. The app currently records only `complete` and `partial`.
- `document_versions`: add `synthetic_confirmed_by` and `synthetic_confirmed_at`.

## Sources

Checked 2026-11-04:

- [Models](https://aistudio.google.com/docs/models)
- [Pricing](https://aistudio.google.com/docs/pricing)
- [Rate limits](https://aistudio.google.com/docs/rate-limits)
- [Structured output](https://aistudio.google.com/docs/structured-output)
- [Interactions](https://aistudio.google.com/docs/interactions)
- [API errors](https://aistudio.google.com/docs/api-errors)
- [Terms](https://aistudio.google.com/docs/terms)
- [Available regions](https://aistudio.google.com/docs/available-regions)
- [SDK repository](https://github.com/googleapis/js-genai)
