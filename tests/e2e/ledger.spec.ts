import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const password = process.env.DEMO_USER_PASSWORD!;
const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signIn(page: Page, email: string, secret = password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/workspace$/);
}

async function withTemporaryAdmin(run: (orgId: string, email: string, secret: string) => Promise<void>) {
  const org = await service.from("organizations").select("id").eq("name", "Fictional RLS Test Organisation A").single();
  const email = `rls-test-e2e-${randomUUID()}@example.com`;
  const secret = randomBytes(24).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
  if (created.error || org.error) throw new Error("Could not prepare test user");
  try {
    const member = await service
      .from("memberships")
      .insert({ org_id: org.data.id, user_id: created.data.user.id, role: "admin" });
    if (member.error) throw new Error("Could not add test user");
    await run(org.data.id, email, secret);
  } finally {
    await service.from("facts").delete().eq("org_id", org.data.id);
    await service.from("assets").delete().eq("org_id", org.data.id);
    await service.auth.admin.deleteUser(created.data.user.id);
  }
}

test("an Admin adds, approves, edits and retires a fact", async ({ page }) => {
  await withTemporaryAdmin(async (orgId, email, secret) => {
    const code = `TST-${Math.floor(1000 + Math.random() * 9000)}`;
    await signIn(page, email, secret);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Claim Ledger" }).click();
    await expect(page.getByText("No facts yet.")).toBeVisible();
    await page.getByRole("link", { name: "Add fact" }).click();

    await page.getByLabel("Fact ID").fill(code);
    await page.getByLabel("Approved statement").fill("The transfer fee is zero.");
    await page.getByLabel("Source name").fill("Fictional fee schedule");
    await page.getByLabel("Source link").fill("javascript:alert(1)");
    await page.getByLabel("Valid from").fill("2026-01-01");
    await page.getByLabel("Expires on").fill("2099-12-31");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator('form [role="alert"]')).toContainText("must start with http");
    await expect(page.getByLabel("Approved statement")).toHaveValue("The transfer fee is zero.");
    await expect(page.getByLabel("Expires on")).toHaveValue("2099-12-31");

    await page.getByLabel("Source link").fill("https://example.com/fees");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name: "The transfer fee is zero." })).toBeVisible();
    await expect(page.getByRole("link", { name: "https://example.com/fees" })).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.getByText("2099-12-31")).toBeVisible();

    const concurrent = await service
      .from("facts")
      .update({ statement: "The transfer fee is one rupee." })
      .eq("org_id", orgId)
      .eq("code", code);
    if (concurrent.error) throw new Error("Could not simulate a concurrent edit");
    await page.getByRole("button", { name: "Approve fact" }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("nothing was applied");
    await expect(page.getByRole("heading", { name: "The transfer fee is one rupee." })).toBeVisible();

    await page.getByRole("button", { name: "Approve fact" }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();

    await page.getByRole("link", { name: "Edit fact" }).click();
    await page.getByLabel("Approved statement").fill("The transfer fee is two rupees.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "The transfer fee is two rupees." })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Version 3, saved/)).toBeVisible();

    await page.getByRole("button", { name: "Retire fact" }).click();
    await expect(page.getByText("Retired", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit fact" })).toHaveCount(0);
    await page.getByRole("button", { name: "Restore as draft" }).click();
    await expect(page.getByRole("button", { name: "Approve fact" })).toBeVisible();

    // Another Admin retires the fact while this page still offers Approve.
    const retired = await service.from("facts").update({ status: "retired" }).eq("org_id", orgId).eq("code", code);
    if (retired.error) throw new Error("Could not simulate a concurrent status change");
    await page.getByRole("button", { name: "Approve fact" }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("nothing was applied");
    await expect(page.getByText("Retired", { exact: true })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("cell", { name: "fact.edited" }).first()).toBeVisible();
  });
});

test("an Admin adds, approves and retires a colour", async ({ page }) => {
  await withTemporaryAdmin(async (orgId, email, secret) => {
    const code = `TST-${Math.floor(1000 + Math.random() * 9000)}`;
    await signIn(page, email, secret);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Assets" }).click();
    await expect(page.getByText("No colours yet.")).toBeVisible();
    await page.getByRole("link", { name: "Add colour" }).click();

    await page.getByLabel("Colour ID").fill(code);
    await page.getByLabel("Colour name").fill("Test blue");
    await page.getByLabel("Hex value").fill("blue");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.locator('form [role="alert"]')).toContainText("hex value");
    await expect(page.getByLabel("Colour name")).toHaveValue("Test blue");

    await page.getByLabel("Hex value").fill("#2340d6");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page).toHaveURL(/\/assets$/);
    const row = page.getByRole("row", { name: new RegExp(code) });
    await expect(row.getByRole("cell", { name: "#2340D6" })).toBeVisible();
    await expect(row.getByRole("cell", { name: "Draft", exact: true })).toBeVisible();

    await row.getByRole("button", { name: `Approve ${code}` }).click();
    await expect(row.getByRole("cell", { name: "Approved", exact: true })).toBeVisible();
    await row.getByRole("button", { name: `Retire ${code}` }).click();
    await expect(row.getByRole("cell", { name: "Retired", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Restore as draft" }).click();
    await expect(row.getByRole("cell", { name: "Draft", exact: true })).toBeVisible();

    // Another Admin retires the colour while this page still offers Approve.
    const retired = await service.from("assets").update({ status: "retired" }).eq("org_id", orgId).eq("code", code);
    if (retired.error) throw new Error("Could not simulate a concurrent status change");
    await row.getByRole("button", { name: `Approve ${code}` }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("nothing was applied");
    await expect(row.getByRole("cell", { name: "Retired", exact: true })).toBeVisible();
  });
});

test("a Creator reads approved facts and colours, and cannot change them", async ({ page }) => {
  await signIn(page, "zentra-creator@example.com");
  await page.goto("/ledger");
  await expect(page.getByRole("link", { name: "FACT-01" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FACT-06" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add fact" })).toHaveCount(0);

  await page.getByRole("link", { name: "FACT-01" }).click();
  await expect(page.getByText("Zentra Fee Schedule (fictional)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve|Retire/ })).toHaveCount(0);
  await expect(page.getByText("Version history")).toHaveCount(0);
  await page.goto(`${page.url()}/edit`);
  await expect(page).toHaveURL(/\/ledger$/);
  await page.goto("/ledger/new");
  await expect(page).toHaveURL(/\/ledger$/);

  await page.goto("/assets");
  await expect(page.getByRole("cell", { name: "CLR-01" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "CLR-05" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add colour" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Approve|Retire/ })).toHaveCount(0);
  await page.goto("/assets/new");
  await expect(page).toHaveURL(/\/assets$/);
});

test("an expired fact is clearly marked", async ({ page }) => {
  await signIn(page, "zentra-creator@example.com");
  await page.goto("/ledger");
  const row = page.getByRole("row", { name: /FACT-03/ });
  await expect(row.getByText("Expired")).toBeVisible();
  await row.getByRole("link", { name: "FACT-03" }).click();
  await expect(page.getByText("This fact expired on 2026-06-30.")).toBeVisible();
});

test("a Creator cannot open a draft fact by its address", async ({ page }) => {
  const draft = await service.from("facts").select("id").eq("code", "FACT-06").single();
  await signIn(page, "zentra-creator@example.com");
  await page.goto(`/ledger/${draft.data?.id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(await page.content()).not.toContain("Weekend support");
});

test("a Reviewer sees drafts and history, but cannot approve", async ({ page }) => {
  await signIn(page, "zentra-reviewer@example.com");
  await page.goto("/ledger");
  await page.getByRole("link", { name: "FACT-06" }).click();
  await expect(page.getByText(/^Version 1, saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve fact" })).toHaveCount(0);
  await page.goto("/assets");
  await expect(page.getByRole("cell", { name: "CLR-05" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve/ })).toHaveCount(0);
});

test("Ledger and Assets pages have no automated accessibility violations", async ({ page }) => {
  await signIn(page, "zentra-admin@example.com");
  for (const path of ["/ledger", "/ledger/new", "/assets", "/assets/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  }
});
