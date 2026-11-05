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

test("an Admin adds, approves, edits and retires a rule", async ({ page }) => {
  const org = await service.from("organizations").select("id").eq("name", "Fictional RLS Test Organisation A").single();
  const email = `rls-test-e2e-${randomUUID()}@example.com`;
  const secret = randomBytes(24).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
  if (created.error || org.error) throw new Error("Could not prepare test user");
  const code = `TST-${Math.floor(1000 + Math.random() * 9000)}`;

  try {
    const member = await service
      .from("memberships")
      .insert({ org_id: org.data.id, user_id: created.data.user.id, role: "admin" });
    if (member.error) throw new Error("Could not add test user");

    await signIn(page, email, secret);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Rulebook" }).click();
    await expect(page.getByText("No rules yet.")).toBeVisible();
    await page.getByRole("link", { name: "Add rule" }).click();

    await page.getByLabel("Rule ID").fill("bad code");
    await page.getByLabel("Rule type").selectOption("terminology");
    await page.getByLabel("Severity").selectOption("high");
    await page.getByLabel("Title").fill("Use the approved product name");
    await page.getByLabel("Instruction").fill("Always write the full product name.");
    await page.getByLabel("Approved term").fill("Example Wallet");
    await page.getByLabel("Terms to replace").fill("e-wallet, ewallet");
    await page.getByLabel("Source excerpt").fill("Fictional guide excerpt.");
    await page.getByLabel("Source name").fill("Fictional guide, section 2");
    await page.getByRole("button", { name: "Save draft" }).click();

    await expect(page.locator('form [role="alert"]')).toContainText("Use a rule ID like MSG-04");
    await expect(page.getByLabel("Title")).toHaveValue("Use the approved product name");
    await expect(page.getByLabel("Approved term")).toHaveValue("Example Wallet");
    await expect(page.getByLabel("Terms to replace")).toHaveValue("e-wallet, ewallet");
    await expect(page.getByLabel("Rule type")).toHaveValue("terminology");
    await expect(page.getByLabel("Severity")).toHaveValue("high");

    await page.getByLabel("Rule ID").fill(code);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByRole("heading", { name: "Use the approved product name" })).toBeVisible();
    await expect(page.getByText("Terminology", { exact: true })).toBeVisible();
    await expect(page.getByText("High", { exact: true })).toBeVisible();
    await expect(page.getByText("Example Wallet", { exact: true })).toBeVisible();
    await expect(page.getByText("e-wallet, ewallet")).toBeVisible();
    await expect(page.getByText("Fictional guide excerpt.")).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    // Another Admin edits the rule while this page is open, so the approval must not apply.
    const concurrent = await service
      .from("rules")
      .update({ instruction: "Always write the full product name, every time." })
      .eq("org_id", org.data.id)
      .eq("code", code);
    if (concurrent.error) throw new Error("Could not simulate a concurrent edit");
    await page.getByRole("button", { name: "Approve rule" }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("nothing was applied");
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText("Always write the full product name, every time.")).toBeVisible();

    await page.getByRole("button", { name: "Approve rule" }).click();
    await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);

    await page.getByRole("link", { name: "Edit rule" }).click();
    await page.getByLabel("Title").fill("Use the full product name");

    // A second concurrent edit must not be overwritten.
    await service.from("rules").update({ severity: "medium" }).eq("org_id", org.data.id).eq("code", code);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator('form [role="alert"]')).toContainText("changed after you opened it");

    await page.reload();
    await expect(page.getByLabel("Severity")).toHaveValue("medium");
    await page.getByLabel("Title").fill("Use the full product name");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { name: "Use the full product name" })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Version 4, saved/)).toBeVisible();
    await expect(page.getByText(/^Version 1, saved/)).toBeVisible();
    await expect(page.getByText("e-wallet, ewallet")).toBeVisible();

    await page.getByRole("button", { name: "Retire rule" }).click();
    await expect(page.getByText("Retired", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit rule" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve rule" })).toHaveCount(0);

    await page.goto(`${page.url()}/edit`);
    await expect(page.getByRole("heading", { name: "Use the full product name" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/edit$/);

    await page.getByRole("button", { name: "Restore as draft" }).click();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve rule" })).toBeVisible();

    // Another Admin retires the rule while this page still offers Approve.
    const retired = await service.from("rules").update({ status: "retired" }).eq("org_id", org.data.id).eq("code", code);
    if (retired.error) throw new Error("Could not simulate a concurrent status change");
    await page.getByRole("button", { name: "Approve rule" }).click();
    await expect(page.locator('main [role="alert"]')).toContainText("nothing was applied");
    await expect(page.getByText("Retired", { exact: true })).toBeVisible();

    await page.goto("/audit");
    await expect(page.getByRole("cell", { name: "rule.edited" }).first()).toBeVisible();
    await expect(page.getByRole("cell", { name: "rule.approved" }).first()).toBeVisible();
  } finally {
    await service.from("rules").delete().eq("org_id", org.data.id);
    await service.auth.admin.deleteUser(created.data.user.id);
  }
});

test("a Creator reads approved rules with their source, and cannot change them", async ({ page }) => {
  await signIn(page, "zentra-creator@example.com");
  await page.goto("/rulebook");
  await expect(page.getByRole("link", { name: "MSG-04" })).toBeVisible();
  await expect(page.getByRole("link", { name: "MSG-09" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Add rule" })).toHaveCount(0);

  await page.getByRole("link", { name: "MSG-04" }).click();
  await expect(page.getByText("Zentra Brand Guide (fictional)")).toBeVisible();
  await expect(page.getByRole("button", { name: /Approve|Retire/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit rule" })).toHaveCount(0);
  await expect(page.getByText("Version history")).toHaveCount(0);

  const ruleUrl = page.url();
  await page.goto(`${ruleUrl}/edit`);
  await expect(page).toHaveURL(/\/rulebook$/);
  await page.goto("/rulebook/new");
  await expect(page).toHaveURL(/\/rulebook$/);
});

test("a Creator cannot open a draft by its address", async ({ page }) => {
  const draft = await service.from("rules").select("id").eq("code", "MSG-09").single();
  await signIn(page, "zentra-creator@example.com");
  await page.goto(`/rulebook/${draft.data?.id}`);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  expect(await page.content()).not.toContain("Link to the fee schedule");
  expect(await page.content()).not.toContain("current fee schedule");
});

test("an invalid rule address shows not found", async ({ page }) => {
  await signIn(page, "zentra-creator@example.com");
  await page.goto("/rulebook/not-a-real-id");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("a Reviewer sees drafts and history, but cannot approve", async ({ page }) => {
  await signIn(page, "zentra-reviewer@example.com");
  await page.goto("/rulebook");
  await page.getByRole("link", { name: "MSG-09" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Version 1, saved/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve rule" })).toHaveCount(0);
});

test("Rulebook pages have no automated accessibility violations", async ({ page }) => {
  await signIn(page, "zentra-admin@example.com");
  for (const path of ["/rulebook", "/rulebook/new"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  }
  await page.goto("/rulebook");
  await page.getByRole("link", { name: "MSG-04" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
});
