import { defineConfig } from "vitest/config";

// Ledger governance tests (immutability, golden hashes, schema, receipts, watchdog). Run by
// .github/workflows/ledger-governance.yml and `npm run test:ledger`. Deliberately NOT part of `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/ledger/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
