import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import type { Manifest } from "../../src/types/dataset";
import type { LedgerSupplement } from "../../src/lib/ledger/manifestSupplement";
import { ledgerSupplementFrom } from "../../scripts/ledger/run.mts";
import { emptyState } from "../../scripts/ledger/state.mts";
import { computeVersion } from "../../scripts/ledger/capture.mts";

describe("manifest supplements.ledger", () => {
  it("is declared as an optional, type-safe field without editing the rule-path type file", async () => {
    const ledger: LedgerSupplement = ledgerSupplementFrom(emptyState("2026-11-01T00:00:00Z"));
    // Compile-time: Manifest.supplements accepts the optional ledger field (checked by `npm run typecheck`).
    const m: Pick<Manifest, "supplements"> = { supplements: { activity: null, announcements: null, ledger } };
    expect(m.supplements?.ledger).toMatchObject({ status: "idle", liveReceipts: 0, liveLateReceipts: 0 });
    // Existing consumers: a manifest without the field is still valid, and the field is optional.
    const without: Pick<Manifest, "supplements"> = { supplements: { activity: null, announcements: null } };
    expect(without.supplements?.ledger).toBeUndefined();
    // The rule-path file src/types/dataset.ts was not touched, so the rule version is unchanged.
    expect(await readFile("src/types/dataset.ts", "utf-8")).not.toMatch(/LedgerSupplement|ledger/i);
    expect((await computeVersion(".")).ruleVersion).toBe("mv1-8ecef864");
  });
  it("nothing in the application reads supplements.ledger", async () => {
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync("grep", ["-rln", "--exclude-dir=ledger", "supplements.ledger\\|supplements?.ledger", "src"], { encoding: "utf-8" });
    expect(r.status).toBe(1); // grep: no match
    expect(r.stdout.trim()).toBe("");
  }, 20_000);
});
