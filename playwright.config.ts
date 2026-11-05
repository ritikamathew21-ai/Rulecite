import { defineConfig, devices } from "@playwright/test";

const port = 3100;

// Tests the production build. Use npm run build, then npm run test:e2e.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  reporter: "line",
  // Traces can contain typed passwords. They stay in the Git-ignored test-results folder.
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run start -- -p ${port}`,
    port,
    reuseExistingServer: false,
    stdout: "ignore",
    // Browser tests must never spend real AI quota.
    env: { AI_PROVIDER: "disabled" },
  },
});
