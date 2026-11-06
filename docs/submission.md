# Rulecite: Round 2 submission details

Team Nexora, CodeNexus India 2026. Sole participant: Ritika Mathew.

- **Live app:** <https://rulecite-eight.vercel.app/>. This is the only deployed address for this project.
- **Not this project:** `rulecite.vercel.app` is not our deployment. It redirects to `www.rulecites.com`, a separate marketing-compliance product called RuleCites.
- **Source:** <https://github.com/ritikamathew21-ai/Rulecite>. The repository is private, so this link only works for accounts with access. Judge access is to be arranged before submission.
- **Build dates:** every commit is dated within the official window of 4 to 7 November 2026. The first commit is dated 5 November 2026.

## Progress against the Round 1 plan

| Round 2 plan item | Status | Notes |
|---|---|---|
| Rulebook and Claim Ledger management | Done | Includes versions, approvals and audit entries |
| Text and DOCX checks, rule-based and AI | Done | |
| Explained findings with accept, edit, dismiss | Done | Accept applies an exact fix where one exists. Editing is done by saving a new version |
| Three-role workflow, comments, versions | Done | |
| Golden set v1 and baseline accuracy | Done | 18 documents, against about 15 planned |
| Deployed on Vercel | Done | |

### Three named improvements

These were planned for Round 3. Work has started early.

| Improvement | Status | Evidence |
|---|---|---|
| Guideline Gap Radar | Done | Insights page, for Reviewers and Admins |
| PDF and image checks | Partly done | PDF text checks work. Alt-text, contrast and palette checks work on DOCX files. PDF images and uploaded image files are not checked |
| Measured accuracy uplift | Done, with limits | Held-out F1 rose from 87.5% to 95.8% on the original labels, and from 84.6% to 90.2% on labels adjudicated after the results. See [Accuracy measurement](technical-decisions.md#accuracy-measurement) |

### Changes from the plan

| Round 1 plan | What was built | Reason |
|---|---|---|
| pgvector retrieval of relevant rules | No retrieval. All approved AI-type rules and facts are sent with each check | A demo rulebook does not justify an embedding pipeline. This also means the "narrow context" gate is not met as first described |
| Unnamed external LLM | Gemini API free tier | API budget of ₹0 |
| "Only the text being checked and the relevant rules are sent" | The draft, approved AI-type rules and approved facts are sent, and only for content confirmed as fictional | Free-tier terms allow Google to use this content, so the boundary is disclosed in the app |
| `mammoth` for DOCX | `jszip` | `mammoth` discards the text colours that contrast and palette checks need |
| `pdf-parse` for PDF | `unpdf` | Chosen for PDF text extraction in serverless functions |
| `sharp` for images, Supabase Storage for files | Neither is used | Uploaded files are parsed in memory and not kept, and image file checks are not built |
| Supported label on claims | Supported claims produce no finding | Only problems are shown. Unsupported, Contradicted and Outdated labels are shown |
| Every build scored on the golden set | Scored by command, on demand | Each run uses free-tier quota, and automated tests never call Gemini |
| Channel-specific rules | Postponed | Not needed for the core workflow |
| Zentra as the fictional demo brand | Vornelle | A more distinctive synthetic name. The golden set keeps Zentra, because it is the measured evidence |
| PDF to draft rules (stretch goal) | Not built | |

## APIs, models and services

| Name | Used for | Plan or tier |
|---|---|---|
| Google Gemini API, `gemini-3.1-flash-lite`, `generateContent` | Tone, messaging and claim checks | Free tier, no billing |
| Supabase | Postgres, Auth and row-level security, in Singapore | Hosted project |
| Vercel | Hosting, with functions in `iad1` | Hobby |
| GitHub | Source repository | |
| Google Fonts, through `next/font` | Atkinson Hyperlegible Next, self-hosted at build time | Visitors make no requests to Google for fonts |

On the Gemini free tier, Google may use submitted content to improve its products, and human reviewers may read it. That is why only fictional content may be sent. The app is intended for adults, and Google's terms restrict free-tier use in the UK, EEA and Switzerland.

## Libraries

| Library | Version | Licence | Purpose |
|---|---|---|---|
| `next` | 16.4.5 | MIT | Web framework |
| `react`, `react-dom` | 19.3.0 | MIT | Interface |
| `@google/genai` | 2.32.0 | Apache-2.0 | Gemini SDK |
| `@supabase/supabase-js` | 2.119.0 | MIT | Database and auth client |
| `@supabase/ssr` | 0.12.7 | MIT | Session cookies |
| `zod` | 4.6.7 | MIT | Validation |
| `jszip` | 3.10.1 | MIT or GPL-3.0-or-later, used under MIT | DOCX reading |
| `unpdf` | 2.1.0 | MIT | PDF text extraction |
| `server-only` | 0.0.1 | MIT | Keeps server modules out of browser code |
| `tailwindcss` | 4.3.4 | MIT | Styling |
| `typescript` | 5.9.3 | Apache-2.0 | Development |
| `vitest` | 5.1.0 | MIT | Unit tests |
| `@playwright/test` | 1.64.1 | Apache-2.0 | Browser tests |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | Accessibility checks |
| `eslint` | 9.39.5 | MIT | Linting |
| `supabase` | 3.0.0 | MIT | Migrations |

`npm audit --omit=dev` reports 0 vulnerabilities in production dependencies on 2026-11-06. Dev tooling alerts are recorded in [Known dependency alerts](technical-decisions.md#known-dependency-alerts).

## Datasets

- **Vornelle demo data:** a fictional brand with rules, facts and colours in `scripts/seed-demo.mjs`, written for this project.
- **Golden set:** 18 fictional documents in `tests/golden/documents.ts`, written for this project with AI assistance. They use the demo brand's earlier name, Zentra. Changing the text would invalidate the saved responses and scores, so they were left as measured.
- No external or real customer datasets are used.

## Templates and reused code

- The project was started with `create-next-app`. Parts of that scaffold remain, such as configuration files and the favicon.
- No other template, boilerplate or previously written product code was used.

## AI assistance

Significant AI assistance was used, and these are the details:

- **Claude Code, using Claude Opus 5.5 (Anthropic):** wrote most of the application code, database migrations, tests, the golden-set documents and original labels, and drafts of this documentation. Commits carry a `Co-Authored-By` line.
- **Round 1:** AI assistance was used to draft and structure the plan.
- **In the product:** Gemini reviews tone, messaging and claims at run time.

## User testing

**No user testing of the built product has been conducted.** No results are claimed here. The table stays blank unless eligible testers complete the test. Eligible testers are adults outside the UK, EEA and Switzerland who use only the supplied fictional content.

| Tester | Role tried | Date | Tasks completed | Problems found | Changes made |
|---|---|---|---|---|---|
| | | | | | |

Other evidence, which is not user testing of the product:

- A Round 1 survey on 2 November 2026 had 6 responses. It was a small convenience sample, and it tested the problem, not this product.
- The project owner tested the deployed app by hand during the build, including a live PDF upload and a live expired-offer check.

## Contribution statement

> **DRAFT. Ritika must confirm or rewrite this personally before submission.**

**Ritika Mathew (team lead, sole participant)**

- Defined the product, scope, users and Round 1 plan, and ran the Round 1 survey.
- Directed the build stage by stage, and set the constraints on budget, data, security and honest reporting.
- Reviewed each stage and approved every commit, push and Gemini test.
- Chose the AI provider and model, and made the owner decisions recorded in the technical decisions.
- Set up and configured GitHub, Vercel, Supabase and the Gemini key.
- Tested the deployed app by hand, and reviewed and adjudicated the golden-set labels.

**Claude Code** wrote most of the code and documentation under that direction, as disclosed above.

The Round 1 deck planned for the sole developer to own every line of the product. In practice most code was written by Claude Code, while decisions, review and approval stayed with Ritika.
