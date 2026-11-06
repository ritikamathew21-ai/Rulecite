# Rulecite

Rulecite checks brand content before it is published, and shows the rule or approved fact behind every finding. People make every decision.

Built by Ritika Mathew (Team Nexora) for CodeNexus India 2026, Round 2, on the Inkloom AI brand-governance problem statement.

- **Live app:** <https://rulecite-eight.vercel.app/>. This is the only deployed address for this project.
- **Not this project:** `rulecite.vercel.app` is not our deployment. It redirects to `www.rulecites.com`, a separate marketing-compliance product called RuleCites.
- **Access:** there is no public registration. Demo logins for the three roles are shared privately with judges and are not stored in this repository.
- **Data:** the demo brand, Vornelle, is fictional. Do not enter real, confidential or personal content. AI checks use the Gemini free tier, where Google may use submitted content to improve its products and human reviewers may read it.

## What it does

| Area | What works today |
|---|---|
| Rulebook | Versioned rules with an ID, severity and source excerpt. Only Admins add, approve or retire them |
| Claim Ledger | Approved facts with a source, a start date and an optional expiry date |
| Assets | Approved brand colours |
| Documents | Pasted text, DOCX files, and text-based PDF files up to 4 MB |
| Code checks | Terminology, banned phrases, readability, alt text, contrast and palette. These need no AI. Alt text, contrast and palette work on DOCX files only |
| AI checks | Tone, messaging and claims, using Gemini. Every result is verified in code before it is shown |
| Findings | Quote, cited rule, source excerpt, explanation, suggested fix, and a rule-based or AI-assisted label |
| Claims | Labelled Unsupported, Contradicted or Outdated in code |
| Review | Accept or dismiss with a reason, new versions, comments, submit, request changes, approve |
| Insights | Repeated problems and rules that may be unclear (Gap Radar) |
| Trust | Three roles enforced in the database, an append-only audit log, and an AI and data page |

## How the workflow runs

1. An Admin approves rules, facts and colours.
2. A Creator pastes text or uploads a file, and confirms whether it is fictional.
3. Code checks run. AI checks then run if the content was confirmed as fictional.
4. Each finding shows its quote, rule and suggested fix.
5. The Creator accepts or dismisses findings. Dismissing needs a reason.
6. The Creator submits, and a Reviewer comments, requests changes or approves. Nobody can approve their own document.
7. Decisions feed Insights, which point Admins to rules that may need clarifying.

## Measured accuracy

The golden set has 18 fictional documents with planted problems: 12 for development and 6 held out. Each version was run 3 times on `gemini-3.1-flash-lite`.

| Held-out labels | Version | Precision | Recall | F1 |
|---|---|---:|---:|---:|
| Original, set before any run | Baseline | 87.5% | 87.5% | 87.5% |
| Original, set before any run | Expired facts marked | 95.8% | 95.8% | 95.8% |
| Post-result adjudication | Baseline | 88.0% | 81.5% | 84.6% |
| Post-result adjudication | Expired facts marked | 95.8% | 85.2% | 90.2% |

Expired offers went from 0 of 6 caught to 6 of 6. This is a small benchmark, not a general accuracy claim. A first attempt failed and was reverted. The golden documents and saved responses keep the demo brand's earlier name, Zentra, because they are the measured evidence. See [Accuracy measurement](docs/technical-decisions.md#accuracy-measurement) for counts and limits.

## Known limitations

- PDF checks read text only. Images, alt text and colours in PDFs are not checked, and the document page says so.
- Image files cannot be uploaded, and scanned PDFs are rejected. There is no OCR.
- DOCX parsing reads the main body only, not headers, footers, footnotes or text boxes.
- Accounts are created by a seed script. Member invites are not built.
- All approved AI-type rules and facts are sent with each check. There is no retrieval step yet.
- The Gemini free tier can be slow or unavailable. When that happens the run is marked partial, and it never claims a full review.
- The app relies on the user's confirmation that content is fictional. It cannot detect real content.
- No user testing has been conducted. See [Submission details](docs/submission.md#user-testing).
- Accessibility has automated axe checks on the main pages, but no manual testing with assistive technology.

## Run it locally

You need Node 22 or later, your own hosted Supabase project with public sign-ups turned off and, for AI checks, a Gemini API key. These steps have only been used on this project's own Supabase project, not a fresh one.

```bash
npm install
```

Copy `.env.example` to `.env.local` and fill in the values. Then:

```bash
npm run db -- db push --yes
```

```bash
npm run db:seed
```

```bash
npm run db:writer
```

```bash
npm run dev
```

Set `AI_PROVIDER=disabled` to run without Gemini. Code checks still work.

## Tests

| Command | What it covers | Last result |
|---|---|---|
| `npm test` | Unit tests, with no AI calls | 303 of 303 on 2026-11-06 |
| `npm run test:e2e` | Browser journeys and axe checks on a production build, with AI disabled. Run `npm run build` first | 56 of 56 on 2026-11-06 |
| `npm run test:rls` | Access rules and demo data on the hosted database. Each run adds permanent audit rows to fictional test organisations | 115 of 115 on 2026-11-05, before the demo brand was renamed |
| `npm run eval:golden` | Rescores saved AI responses, with no AI calls | Reports in `tests/golden/results` |

Three one-off test failures were investigated and their causes remain unproven. They are recorded under [Known test issues](docs/technical-decisions.md#known-test-issues).

## Documents

- [Architecture](docs/architecture.md)
- [Technical decisions](docs/technical-decisions.md)
- [Seed recovery](docs/seed-recovery.md)
- [Submission details](docs/submission.md): progress against the plan, the three improvements, APIs, models, libraries, services, template and AI disclosures, user testing and contribution
