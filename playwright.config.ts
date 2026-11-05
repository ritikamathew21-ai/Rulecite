import { defineConfig, devices } from "@playwright/test";

const port = 3100;

// Tests the production build. Use npm run build, then npm run test:e2e.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  reporter: "line",
  use: { baseURL: `http://localhost:${port}`, ...devices["Desktop Chrome"] },
  webServer: {
    command: `npm run start -- -p ${port}`,
    port,
    reuseExistingServer: false,
    stdout: "ignore",
  },
});
