import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { DEMO_ORG_NAME, DEMO_USERS } from "../../scripts/seed-demo.mjs";

const password = process.env.DEMO_USER_PASSWORD!;
const creator = "zentra-creator@example.com";
let clickedAt = 0;

async function signIn(page: Page, email: string, secret = password) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(secret);
  clickedAt = Date.now();
  await page.getByRole("button", { name: "Sign in" }).click();
}

// A one-off sign-in failure left no evidence of its cause, so failures report what the page showed.
test.afterEach(async ({ page }, testInfo) => {
  const started = clickedAt;
  clickedAt = 0;
  if (!started || testInfo.status === testInfo.expectedStatus) return;
  const alerts = await page.locator('form [role="alert"]').allTextContents();
  console.log(
    `Sign-in diagnostics: ${Date.now() - started}ms after click, at ${new URL(page.url()).pathname}, alerts: ${JSON.stringify(alerts)}`,
  );
});

test("signed-out visitors are sent to sign-in, keeping their destination", async ({ page }) => {
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkspace$/);
  await expect(page.getByRole("heading", { name: "Sign in to Rulecite" })).toBeVisible();
});

test("the home page sends signed-out visitors to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("a wrong password shows one generic message and does not sign in", async ({ page, context }) => {
  await page.goto("/login");
  await signIn(page, creator, "definitely-wrong");
  await expect(page.locator('form [role="alert"]')).toHaveText("Incorrect email or password.");
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toEqual([]);
});

test("an unknown email shows the same message", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, `nobody-${randomUUID()}@example.com`, "definitely-wrong");
  await expect(page.locator('form [role="alert"]')).toHaveText("Incorrect email or password.");
});

for (const { email, role, name } of DEMO_USERS) {
  test(`${role} signs in and sees the role from the database`, async ({ page }) => {
    await page.goto("/login");
    await signIn(page, email);
    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByText(DEMO_ORG_NAME, { exact: true })).toBeVisible();
    const label = role[0].toUpperCase() + role.slice(1);
    await expect(page.getByText(`Signed in as ${name} (${label})`)).toBeVisible();
  });
}

test("a crafted next link cannot redirect off the site", async ({ page }) => {
  await page.goto("/login?next=//evil.example");
  await signIn(page, creator);
  await expect(page).toHaveURL(/localhost:3100\/workspace$/);
});

test("signed-in users skip the sign-in page", async ({ page }) => {
  await page.goto("/login");
  await signIn(page, creator);
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto("/login");
  await expect(page).toHaveURL(/\/workspace$/);
});

test("signing out ends access", async ({ page, context }) => {
  await page.goto("/login");
  await signIn(page, creator);
  await expect(page).toHaveURL(/\/workspace$/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toEqual([]);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login\?next=%2Fworkspace$/);
});

test("a forged session cookie gives no access", async ({ page, context }) => {
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ sub: randomUUID(), role: "authenticated", exp: 4102444800 }),
  ).toString("base64url");
  const session = { access_token: `${header}.${payload}.forged`, refresh_token: "forged", expires_at: 4102444800 };
  await context.addCookies([
    {
      name: `sb-${ref}-auth-token`,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      url: "http://localhost:3100",
    },
  ]);
  await page.goto("/workspace");
  await expect(page).toHaveURL(/\/login/);
});

test("a signed-in user with no organisation sees the no-access page", async ({ page }) => {
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `rls-test-e2e-${randomUUID()}@example.com`;
  const secret = randomBytes(24).toString("base64url");
  const created = await service.auth.admin.createUser({ email, password: secret, email_confirm: true });
  if (created.error) throw new Error("Could not create test user");

  try {
    await page.goto("/login");
    await signIn(page, email, secret);
    await expect(page).toHaveURL(/\/no-access$/);
    await expect(page.getByRole("heading", { name: "No organisation access" })).toBeVisible();
    await page.goto("/workspace");
    await expect(page).toHaveURL(/\/no-access$/);
  } finally {
    await service.auth.admin.deleteUser(created.data.user.id);
  }
});

test("protected pages keep the security headers", async ({ request }) => {
  const response = await request.get("/login");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});
