import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Scores the golden set. Use npm run eval:golden.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["tests/golden/run.eval.ts"],
    testTimeout: 0,
  },
});
