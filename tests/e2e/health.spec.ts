import { expect, test } from "@playwright/test";

test("the health check is public and reveals only its status", async ({ request }) => {
  const response = await request.get("/api/health", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", database: "ok" });
  expect(response.headers()["cache-control"]).toBe("no-store");
});

test("the health check also works for signed-in users", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("zentra-creator@example.com");
  await page.getByLabel("Password").fill(process.env.DEMO_USER_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/workspace$/);
  const response = await page.request.get("/api/health", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});

test("other API paths stay protected", async ({ request }) => {
  const response = await request.get("/api/health-admin", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain("/login");
});
