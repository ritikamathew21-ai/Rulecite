import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const password = process.env.DEMO_USER_PASSWORD!;
const accounts = {
  creator: "zentra-creator@example.com",
  reviewer: "zentra-reviewer@example.com",
  admin: "zentra-admin@example.com",
};

async function signIn(page: Page, email: string, secret = password) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/workspace$/);
}

// Pages stream in, so wait for the real page before measuring it.
const pageLoaded = (page: Page) => expect(page.getByRole("heading", { level: 1 })).toBeVisible();

const expectNoAccessibilityIssues = async (page: Page) => {
  await pageLoaded(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
};

test("the session token is hidden from page scripts", async ({ page, context }) => {
  await signIn(page, accounts.creator);
  const cookie = (await context.cookies()).find(({ name }) => name.includes("auth-token"));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  expect(cookie?.sameSite).toBe("Lax");
  expect(await page.evaluate(() => document.cookie)).not.toContain("auth-token");
});

test("a session keeps working across pages", async ({ page }) => {
  await signIn(page, accounts.reviewer);
  await page.getByRole("link", { name: "Audit log" }).first().click();
  await expect(page).toHaveURL(/\/audit$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
});

test("a Creator has no audit link and cannot open the page directly", async ({ page }) => {
  await signIn(page, accounts.creator);
  await expect(page.getByRole("link", { name: /audit/i })).toHaveCount(0);
  await page.goto("/audit");
  await expect(page).toHaveURL(/\/workspace$/);
});

for (const role of ["reviewer", "admin"] as const) {
  test(`${role} can open the audit log`, async ({ page }) => {
    await signIn(page, accounts[role]);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
  });
}

test("the audit log shows this organisation's entry and hides another's", async ({ page }) => {
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const org = await service
    .from("organizations")
    .select("id")
    .eq("name", "Fictional RLS Test Organisation A")
    .single();
  const otherOrg = await service
    .from("organizations")
    .select("id")
    .eq("name", "Fictional RLS Test Organisation B")
    .single();
  const marker = randomUUID();
  const ownAction = `e2e.own.${marker}`;
  const otherAction = `e2e.other.${marker}`;
  const email = `rls-test-e2e-${randomUUID()}@example.com`;
  const secret = randomBytes(24).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
  if (created.error || org.error || otherOrg.error) throw new Error("Could not prepare test user");

  try {
    const member = await service
      .from("memberships")
      .insert({ org_id: org.data.id, user_id: created.data.user.id, role: "reviewer" });
    if (member.error) throw new Error("Could not add test user");
    const entries = await service.from("audit_log").insert([
      { org_id: org.data.id, action: ownAction, entity_type: "test" },
      { org_id: otherOrg.data.id, action: otherAction, entity_type: "test" },
    ]);
    if (entries.error) throw new Error("Could not add test audit entries");

    await signIn(page, email, secret);
    await page.goto("/audit");
    await expect(page.getByRole("cell", { name: ownAction, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: otherAction, exact: true })).toHaveCount(0);
  } finally {
    await service.auth.admin.deleteUser(created.data.user.id);
  }
});

test("every navigation link leads to a working page", async ({ page }) => {
  await signIn(page, accounts.admin);
  const nav = page.getByRole("navigation", { name: "Main" });
  const hrefs = await nav.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs).toEqual(["/workspace", "/rulebook", "/ledger", "/assets", "/audit", "/trust"]);

  for (const href of hrefs) {
    const response = await page.goto(href!);
    expect(response?.status()).toBe(200);
    await expect(nav.getByRole("link", { name: /./ }).and(page.locator('[aria-current="page"]'))).toHaveAttribute("href", href!);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("the demo notice is always visible and AI is described honestly", async ({ page }) => {
  await signIn(page, accounts.creator);
  await expect(page.getByText("Fictional demonstration. Use only fictional or synthetic content.")).toBeVisible();
  await page.goto("/trust");
  await expect(page.getByRole("heading", { name: "AI checks are not active yet" })).toBeVisible();
  await expect(page.getByText("Human reviewers at Google may read it.")).toBeVisible();
  await expect(page.getByText("processed in the United States")).toBeVisible();
});

test("keyboard users can skip to the content", async ({ page }) => {
  await signIn(page, accounts.creator);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
});

test("the layout has no sideways scroll on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page, accounts.reviewer);
  for (const path of ["/workspace", "/audit", "/trust"]) {
    await page.goto(path);
    await pageLoaded(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});

test("pages have no automated accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await expectNoAccessibilityIssues(page);
  await signIn(page, accounts.admin);
  for (const path of ["/workspace", "/audit", "/trust"]) {
    await page.goto(path);
    await expectNoAccessibilityIssues(page);
  }
});
