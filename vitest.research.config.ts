import { defineConfig } from "vitest/config";

// Research tests (scripts/research). Run with `npx vitest run --config vitest.research.config.ts`.
// Deliberately NOT part of `npm test`: that suite gates the scheduled data and live-capture commit, and research must
// never be able to block live capture. Files are named *.spec.ts so the default config's *.test.ts pattern skips them.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/research/**/*.spec.ts"],
    testTimeout: 120_000,
  },
});
