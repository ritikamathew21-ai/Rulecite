import { defineConfig } from "vitest/config";

// Runs against the hosted Supabase project. Use npm run test:rls.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
