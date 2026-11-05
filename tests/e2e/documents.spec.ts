import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { buildPdf } from "../fixtures/pdf";

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signIn(page: Page, email: string, secret: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/workspace$/);
}

type Account = { id: string; email: string; secret: string };

// Everything happens in a fictional test organisation, so Zentra's demo data stays clean.
async function withTestOrganisation(run: (org: string, creator: Account, otherCreator: Account, reviewer: Account) => Promise<void>) {
  const org = await service.from("organizations").select("id").eq("name", "Fictional RLS Test Organisation A").single();
  if (org.error) throw new Error("Could not find the test organisation");
  const orgId = org.data.id;
  const accounts: Account[] = [];

  // A timed-out test cannot clean up, so clear anything it left before starting.
  await service.from("documents").delete().eq("org_id", orgId);
  await service.from("rules").delete().eq("org_id", orgId);

  const addAccount = async (role: string) => {
    const email = `rls-test-e2e-${randomUUID()}@example.com`;
    const secret = randomBytes(24).toString("base64url");
    const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
    if (created.error) throw new Error("Could not create a test user");
    const account = { id: created.data.user.id, email, secret };
    accounts.push(account);
    const member = await service.from("memberships").insert({ org_id: orgId, user_id: account.id, role });
    if (member.error) throw new Error("Could not add a test user");
    return account;
  };

  const base = { org_id: orgId, severity: "high", status: "approved", source_name: "Fictional guide, section 2", config: {} };
  const rules = await service.from("rules").insert([
    {
      ...base,
      code: "TST-1001",
      type: "terminology",
      title: "Use the product name",
      instruction: "Write Example Wallet.",
      source_excerpt: "Our product is always called Example Wallet.",
      config: { preferred: "Example Wallet", variants: ["e-wallet"] },
    },
    {
      ...base,
      code: "TST-1002",
      type: "banned_phrase",
      title: "Avoid unsafe phrases",
      instruction: "Do not hide risk.",
      source_excerpt: "Never say risk-free.",
      config: { phrases: ["risk-free"] },
    },
    {
      ...base,
      code: "TST-1003",
      type: "accessibility",
      title: "Describe every image",
      instruction: "Images need alt text.",
      source_excerpt: "All images need alternative text.",
    },
    {
      ...base,
      code: "TST-1004",
      type: "contrast",
      title: "Keep text readable",
      instruction: "Text needs 4.5:1 contrast.",
      source_excerpt: "Text must meet WCAG AA contrast.",
    },
    {
      ...base,
      status: "draft",
      code: "TST-1005",
      type: "banned_phrase",
      title: "Draft rule",
      instruction: "Not approved yet.",
      source_excerpt: "Draft excerpt.",
      config: { phrases: ["sunshine"] },
    },
  ]);
  if (rules.error) throw new Error(`Could not add test rules: ${rules.error.code}`);

  try {
    await run(orgId, await addAccount("creator"), await addAccount("creator"), await addAccount("reviewer"));
  } finally {
    await service.from("documents").delete().eq("org_id", orgId);
    await service.from("rules").delete().eq("org_id", orgId);
    for (const account of accounts) await service.auth.admin.deleteUser(account.id);
  }
}

const submitText = async (page: Page, title: string, text: string) => {
  await page.goto("/documents/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Paste your text").fill(text);
  await page.getByRole("button", { name: "Save and check" }).click();
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);
};

test("a Creator checks text and sees cited findings, with AI clearly skipped", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Documents" }).click();
    await expect(page.getByText("No documents yet.")).toBeVisible();

    await submitText(page, "Fictional launch email", "Try the new e-wallet. It is risk-free and full of sunshine.");

    await expect(page.getByRole("heading", { name: "Fictional launch email" })).toBeVisible();
    await expect(page.getByText("AI checks skipped.")).toBeVisible();
    await expect(page.getByText("this is not a full review", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Findings (2)" })).toBeVisible();

    await expect(page.locator("mark")).toHaveText(["e-wallet", "risk-free"]);
    await expect(page.getByText("TST-1001: Use the product name (version 1)")).toBeVisible();
    await expect(page.getByText("Our product is always called Example Wallet.")).toBeVisible();
    await expect(page.getByText('Replace it with "Example Wallet".')).toBeVisible();
    await expect(page.getByText("High severity, Banned phrase, rule-based")).toBeVisible();

    // A draft rule must not produce findings.
    await expect(page.getByText("TST-1005")).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);

    await page.getByRole("button", { name: "Run check again" }).click();
    await expect(page.getByRole("heading", { name: "Findings (2)" })).toBeVisible();
  });
});

test("AI is skipped with a clear reason, whether or not content is confirmed", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "Not confirmed", "A sentence.");
    await expect(page.getByText("This content was not marked as fictional or synthetic, so it was not sent to AI.")).toBeVisible();

    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Confirmed");
    await page.getByLabel("Paste your text").fill("A sentence.");
    await page.getByLabel("This content is fictional or synthetic", { exact: false }).check();
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.getByText("AI checks are not set up.")).toBeVisible();
  });
});

test("clean text never claims a full review", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "Clean text", "Open your Example Wallet today.");
    await expect(page.getByRole("heading", { name: "Findings (0)" })).toBeVisible();
    await expect(page.getByText("Code checks found no problems")).toBeVisible();
    await expect(page.getByText("AI checks skipped.")).toBeVisible();
    await expect(page.getByText("no issues found", { exact: false })).toHaveCount(0);
  });
});

test("draft text is displayed safely", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    let dialogOpened = false;
    page.on("dialog", (dialog) => {
      dialogOpened = true;
      void dialog.dismiss();
    });
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "<img src=x onerror=alert(1)>", "<script>alert(1)</script> and an e-wallet");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("<img src=x onerror=alert(1)>");
    await expect(page.getByText("<script>alert(1)</script>")).toBeVisible();
    expect(dialogOpened).toBe(false);
  });
});

test("a Word document is checked for text, alt text and contrast", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    const zip = new JSZip();
    zip.file(
      "word/document.xml",
      `<?xml version="1.0"?><w:document xmlns:w="w" xmlns:wp="wp"><w:body>
        <w:p><w:r><w:t>Our e-wallet is here.</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:color w:val="DDDDDD"/></w:rPr><w:t>Pale small print</w:t></w:r></w:p>
        <wp:docPr id="1" name="Hero banner"/>
      </w:body></w:document>`,
    );
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    await signIn(page, creator.email, creator.secret);
    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Fictional brochure");
    await page.getByLabel("Or upload a file").setInputFiles({
      name: "brochure.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer,
    });
    await page.getByRole("button", { name: "Save and check" }).click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);

    await expect(page.getByRole("heading", { name: "Findings (3)" })).toBeVisible();
    await expect(page.getByText('The image "Hero banner" has no alt text.')).toBeVisible();
    await expect(page.getByText("#DDDDDD on white has a contrast ratio")).toBeVisible();
    await expect(page.locator("mark")).toHaveText(["e-wallet", "Pale small print"]);
  });
});

test("a PDF is checked for text, and says what was not checked", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Fictional PDF");
    await page.getByLabel("Or upload a file").setInputFiles({
      name: "flyer.pdf",
      mimeType: "application/pdf",
      buffer: buildPdf([["Try the new e-wallet."], ["It is risk-free."]]),
    });
    await page.getByRole("button", { name: "Save and check" }).click();
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/);

    await expect(page.getByRole("heading", { name: "Findings (2)" })).toBeVisible();
    await expect(page.locator("mark")).toHaveText(["e-wallet", "risk-free"]);
    await expect(page.getByText("This came from a PDF, so only its text was checked.")).toBeVisible();
  });
});

test("a scanned PDF gets a clear message", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Scanned flyer");
    await page.getByLabel("Or upload a file").setInputFiles({
      name: "scan.pdf",
      mimeType: "application/pdf",
      buffer: buildPdf([[]]),
    });
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("This PDF has no readable text. It may be a scan.");
  });
});

test("invalid submissions keep what was typed and explain why", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Empty draft");
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("Enter some text to check.");
    await expect(page.getByLabel("Title")).toHaveValue("Empty draft");

    await page.getByLabel("Or upload a file").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a word document"),
    });
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("Upload a .docx or .pdf file.");
  });
});

test("the full journey from draft to approved version", async ({ page, browser }) => {
  test.setTimeout(180_000);
  await withTestOrganisation(async (_org, creator, _other, reviewer) => {
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "Fictional campaign", "Try the new e-wallet. It is risk-free.");
    const address = new URL(page.url()).pathname;
    const card = (code: string) => page.getByRole("listitem", { name: `Finding ${code}` });

    // High severity findings block submission.
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.locator('main [role="alert"]')).toHaveText("Decide every high severity finding before submitting.");

    // Dismissing needs a reason, and an edit can supply custom wording.
    await card("TST-1001").getByRole("button", { name: "Accept fix" }).click();
    await expect(card("TST-1001").getByText("Accepted")).toBeVisible();
    await card("TST-1002").getByText("Edit fix").click();
    await card("TST-1002").getByLabel("Replacement text").fill("low-risk");
    await card("TST-1002").getByRole("button", { name: "Save fix" }).click();
    await expect(card("TST-1002").getByText("Your fix:")).toBeVisible();

    // Accepted fixes create a new version, which is checked again.
    await page.getByRole("button", { name: "Apply fixes as a new version" }).click();
    await expect(page.getByText("showing version 2")).toBeVisible();
    await expect(page.getByText("Try the new Example Wallet. It is low-risk.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Findings (0)" })).toBeVisible();

    // The original version is kept.
    await page.getByRole("link", { name: "Version 1", exact: true }).click();
    await expect(page.getByText("showing version 1 (an older version)")).toBeVisible();
    await expect(page.locator("mark")).toHaveText(["e-wallet", "risk-free"]);
    await expect(page.getByRole("button", { name: "Submit for review" })).toHaveCount(0);
    await page.goto(address);

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);

    // A Reviewer requests changes.
    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await signIn(reviewerPage, reviewer.email, reviewer.secret);
    await reviewerPage.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Review queue" }).click();
    await reviewerPage.getByRole("link", { name: "Fictional campaign" }).click();
    await reviewerPage.getByRole("button", { name: "Request changes" }).click();
    await expect(reviewerPage.locator('main [role="alert"]')).toHaveText("Add a comment explaining what needs to change.");
    await reviewerPage.getByLabel("Review comment").fill("Please add the fee link.");
    await reviewerPage.getByRole("button", { name: "Request changes" }).click();
    await expect(reviewerPage.getByText("Changes requested", { exact: true })).toBeVisible();

    // The Creator revises the draft and resubmits.
    await page.reload();
    await expect(page.getByText("Please add the fee link.")).toBeVisible();
    await page.getByRole("link", { name: "Edit draft" }).click();
    await page.getByLabel("Draft text").fill("Try the new Example Wallet. See our fee schedule.");
    await page.getByRole("button", { name: "Save and check new version" }).click();
    await expect(page.getByText("showing version 3")).toBeVisible();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();

    // The Reviewer approves that exact version.
    await reviewerPage.reload();
    await reviewerPage.getByRole("button", { name: "Approve version 3" }).click();
    await expect(reviewerPage.getByText(/^Version 3 approved/)).toBeVisible();

    await page.reload();
    await expect(page.getByText(/^Version 3 approved/)).toBeVisible();
    await expect(page.getByText("Version 3, saved", { exact: false })).toContainText("(approved)");

    // Editing clears the approval.
    await page.getByRole("link", { name: "Edit draft" }).click();
    await expect(page.getByText("The current approval will no longer apply.")).toBeVisible();
    await page.getByLabel("Draft text").fill("Changed after approval.");
    await page.getByRole("button", { name: "Save and check new version" }).click();
    await expect(page.getByText("showing version 4")).toBeVisible();
    await expect(page.getByText(/^Version 3 approved/)).toHaveCount(0);

    await reviewerPage.goto("/audit");
    await expect(reviewerPage.getByRole("cell", { name: "document.approved" }).first()).toBeVisible();
    await expect(reviewerPage.getByRole("cell", { name: "finding.edited" }).first()).toBeVisible();
    await reviewerContext.close();
  });
});

test("dismissing a finding records a reason, and the page stays accessible", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "Fictional offer", "It is risk-free.");
    const finding = page.getByRole("listitem", { name: "Finding TST-1002" });
    await finding.getByText("Dismiss", { exact: true }).click();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);

    await finding.getByLabel("Reason").selectOption("other");
    await finding.getByRole("button", { name: "Dismiss finding" }).click();
    await expect(page.locator('main [role="alert"]')).toHaveText("Choose a reason, and add details if you choose Other.");

    await finding.getByText("Dismiss", { exact: true }).click();
    await finding.getByLabel("Reason").selectOption("rule_unclear");
    await finding.getByRole("button", { name: "Dismiss finding" }).click();
    await expect(finding.getByText("Dismissed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Run check again" })).toHaveCount(0);

    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("In review", { exact: true })).toBeVisible();
  });
});

test("a Reviewer does not see review controls on their own document", async ({ page }) => {
  await withTestOrganisation(async (_org, _creator, _other, reviewer) => {
    await signIn(page, reviewer.email, reviewer.secret);
    await submitText(page, "Reviewer's own draft", "A clean sentence.");
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("Someone else must review this document, because you wrote it.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
  });
});

test("Creators have no review queue", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await expect(page.getByRole("link", { name: "Review queue" })).toHaveCount(0);
    await page.goto("/review");
    await expect(page).toHaveURL(/\/documents$/);
  });
});

test("documents are private to their author, Reviewers and Admins", async ({ page, browser }) => {
  await withTestOrganisation(async (_org, creator, otherCreator, reviewer) => {
    await signIn(page, creator.email, creator.secret);
    await submitText(page, "Private fictional draft", "A private e-wallet draft.");
    const address = new URL(page.url()).pathname;

    const otherContext = await browser.newContext();
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, otherCreator.email, otherCreator.secret);
    await otherPage.goto(address);
    await expect(otherPage.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(await otherPage.content()).not.toContain("private e-wallet draft");
    await otherPage.goto("/documents");
    await expect(otherPage.getByText("Private fictional draft")).toHaveCount(0);
    await otherContext.close();

    const reviewerContext = await browser.newContext();
    const reviewerPage = await reviewerContext.newPage();
    await signIn(reviewerPage, reviewer.email, reviewer.secret);
    await reviewerPage.goto("/documents");
    await reviewerPage.getByRole("link", { name: "Private fictional draft" }).click();
    await expect(reviewerPage.getByRole("heading", { name: "Findings (1)" })).toBeVisible();
    await reviewerContext.close();
  });
});
