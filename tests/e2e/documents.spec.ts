import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

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
    await page.getByLabel("Or upload a Word document").setInputFiles({
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

test("invalid submissions keep what was typed and explain why", async ({ page }) => {
  await withTestOrganisation(async (_org, creator) => {
    await signIn(page, creator.email, creator.secret);
    await page.goto("/documents/new");
    await page.getByLabel("Title").fill("Empty draft");
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("Enter some text to check.");
    await expect(page.getByLabel("Title")).toHaveValue("Empty draft");

    await page.getByLabel("Or upload a Word document").setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a word document"),
    });
    await page.getByRole("button", { name: "Save and check" }).click();
    await expect(page.locator('form [role="alert"]')).toHaveText("Upload a .docx file.");
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
