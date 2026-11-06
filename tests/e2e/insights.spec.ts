import { randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

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

const orgId = async (name: string) => {
  const org = await service.from("organizations").select("id").eq("name", name).single();
  if (org.error) throw new Error("Could not find a test organisation");
  return org.data.id as string;
};

async function addDismissedFinding(org: string, author: string, code: string, title: string) {
  const document = await service.from("documents").insert({ org_id: org, title: "Fictional insight", created_by: author }).select("id").single();
  if (document.error) throw new Error(`Could not add a document: ${document.error.code}`);
  const version = await service
    .from("document_versions")
    .insert({ document_id: document.data.id, org_id: org, number: 1, source_type: "text", plain_text: "Fictional text.", created_by: author })
    .select("id")
    .single();
  if (version.error) throw new Error(`Could not add a version: ${version.error.code}`);
  const run = await service
    .from("check_runs")
    .insert({ document_id: document.data.id, version_id: version.data.id, org_id: org, status: "partial" })
    .select("id")
    .single();
  if (run.error) throw new Error(`Could not add a run: ${run.error.code}`);
  const finding = await service
    .from("findings")
    .insert({
      run_id: run.data.id,
      document_id: document.data.id,
      version_id: version.data.id,
      org_id: org,
      origin: "rule",
      category: "terminology",
      severity: "medium",
      quote: "text",
      start_offset: 10,
      end_offset: 14,
      explanation: "Fictional.",
      suggestion: "Fictional.",
      citation: { id: randomUUID(), code, title },
      state: "dismissed",
    })
    .select("id")
    .single();
  if (finding.error) throw new Error(`Could not add a finding: ${finding.error.code}`);
  const decision = await service.from("finding_decisions").insert({
    finding_id: finding.data.id,
    document_id: document.data.id,
    org_id: org,
    actor_id: author,
    action: "dismissed",
    reason_code: "rule_unclear",
  });
  if (decision.error) throw new Error(`Could not add a decision: ${decision.error.code}`);
}

test("Reviewers see their own organisation's unclear rules", async ({ page }) => {
  test.setTimeout(90_000);
  const orgA = await orgId("Fictional RLS Test Organisation A");
  const orgB = await orgId("Fictional RLS Test Organisation B");
  await service.from("documents").delete().in("org_id", [orgA, orgB]);

  const email = `rls-test-e2e-${randomUUID()}@example.com`;
  const secret = randomBytes(24).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
  if (created.error) throw new Error("Could not create a test user");
  const userId = created.data.user.id;

  try {
    const member = await service.from("memberships").insert({ org_id: orgA, user_id: userId, role: "reviewer" });
    if (member.error) throw new Error("Could not add a test user");
    for (let i = 0; i < 3; i++) await addDismissedFinding(orgA, userId, "TST-2001", "A confusing rule");
    await addDismissedFinding(orgB, userId, "TST-2002", "Another organisation's rule");

    await signIn(page, email, secret);
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Insights" }).click();
    await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();

    await expect(page.getByRole("link", { name: "TST-2001: A confusing rule" })).toBeVisible();
    await expect(page.getByText("Dismissed 3 of 3 decisions (100%).")).toBeVisible();
    await expect(page.getByText("Reasons: The rule is unclear (3)")).toBeVisible();
    const row = page.getByRole("row", { name: /TST-2001/ });
    await expect(row.getByRole("cell").nth(2)).toHaveText("3");

    await expect(page.getByText("TST-2002")).toHaveCount(0);
    await expect(page.getByText("Another organisation's rule")).toHaveCount(0);

    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
  } finally {
    await service.from("documents").delete().in("org_id", [orgA, orgB]);
    await service.auth.admin.deleteUser(userId);
  }
});

test("Creators cannot open Insights", async ({ page }) => {
  await signIn(page, "vornelle-creator@example.com", process.env.DEMO_USER_PASSWORD!);
  await expect(page.getByRole("link", { name: "Insights" })).toHaveCount(0);
  await page.goto("/insights");
  await expect(page).toHaveURL(/\/documents$/);
});

test("Insights explains itself when there is too little data", async ({ page }) => {
  await signIn(page, "vornelle-reviewer@example.com", process.env.DEMO_USER_PASSWORD!);
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Rules that may be unclear" })).toBeVisible();
  await expect(page.getByText("No rules stand out yet.")).toBeVisible();
});
