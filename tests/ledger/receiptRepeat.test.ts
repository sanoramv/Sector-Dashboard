import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyReceipts } from "../../scripts/ledger/receipt.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { applyVerificationToState, ledgerSupplementFrom, writeManifestSupplement } from "../../scripts/ledger/run.mts";
import { applyPublication, emptyState, strongerStatus, validateState, type DateRecord } from "../../scripts/ledger/state.mts";
import { H, captureInto, fakeGitFor, last, pushAt, receiptInto, tmpDir } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const rec = (status: DateRecord["status"], extra: Partial<DateRecord> = {}): DateRecord => ({ status, reasons: [], sourceDataDate: last, generatedAt: "t", publicationClass: "pending", earliestCutoffUtc: null, cutoffUtc: null, updatedAt: "2026-11-01T00:00:00Z", ...extra });

describe("regression: an existing live-late receipt never becomes live", () => {
  it("receipt, ledger state and manifest all keep live-late across repeated verification", async () => {
    const root = path.join(tmp.dir, "late");
    const { ruleVersion, date } = await captureInto(root);
    const state = emptyState("2026-11-01T00:00:00Z");
    state.dates[date] = rec("recorded");

    // First verification: late publication => receipt written as live-late.
    const first = await receiptInto(root, ruleVersion, true);
    expect(first[0]).toMatchObject({ result: "receipt-written", class: "live-late" });
    applyVerificationToState(state, first, "2026-11-02T00:00:00Z");
    expect(state.dates[date].publicationClass).toBe("live-late");
    expect(state.dates[date].status).toBe("recorded-late");

    // Second verification of the SAME existing receipt, with the evidence now unavailable: still live-late.
    const p = ledgerPaths(root);
    const before = await readFile(p.receiptFile(date), "utf-8");
    const second = await verifyReceipts({ ledgerRoot: root, ruleVersion, now: new Date("2026-11-03T00:00:00Z"), activity: { ok: false, reason: "HTTP 403" }, git: fakeGitFor(), statuses: {} });
    expect(second[0]).toMatchObject({ result: "receipt-exists", class: "live-late" });
    applyVerificationToState(state, second, "2026-11-03T00:00:00Z");
    expect(state.dates[date].publicationClass).toBe("live-late");
    expect(state.dates[date].status).toBe("recorded-late");
    expect(await readFile(p.receiptFile(date), "utf-8")).toBe(before); // receipt untouched (create-only)
    expect(JSON.parse(before).class).toBe("live-late");

    // Manifest and watchdog inputs follow the actual class.
    const sup = ledgerSupplementFrom(state);
    expect(sup).toMatchObject({ liveReceipts: 0, liveLateReceipts: 1 });
    const manifest = path.join(tmp.dir, "manifest.json");
    await writeFile(manifest, JSON.stringify({ latestMarketDate: last, refresh: { outcome: "complete" }, supplements: { activity: null, announcements: null } }));
    await writeManifestSupplement(manifest, state);
    const written = JSON.parse(await readFile(manifest, "utf-8"));
    expect(written.supplements.ledger).toMatchObject({ liveReceipts: 0, liveLateReceipts: 1 });
    expect(written.supplements.activity).toBeNull(); // existing supplements preserved
    expect(validateState(state)).toEqual([]);
  });

  it("a live receipt stays live on repeat, and a corrupt receipt is never promoted", async () => {
    const root = path.join(tmp.dir, "live");
    const { ruleVersion, date } = await captureInto(root);
    const first = await receiptInto(root, ruleVersion, false);
    expect(first[0]).toMatchObject({ result: "receipt-written", class: "live" });
    const again = await verifyReceipts({ ledgerRoot: root, ruleVersion, now: new Date(), activity: { ok: false, reason: "x" }, git: fakeGitFor(), statuses: {} });
    expect(again[0]).toMatchObject({ result: "receipt-exists", class: "live" });
    await writeFile(ledgerPaths(root).receiptFile(date), "{ not json");
    const bad = await verifyReceipts({ ledgerRoot: root, ruleVersion, now: new Date(), activity: { ok: true, pushes: [pushAt(`${last}T21:00:00Z`)] }, git: fakeGitFor(), statuses: {} });
    expect(bad[0]).toMatchObject({ result: "receipt-invalid", class: "unverified" });
    await writeFile(ledgerPaths(root).receiptFile(date), JSON.stringify({ kind: "momentum-ledger.receipt", class: "unverified" }));
    expect((await verifyReceipts({ ledgerRoot: root, ruleVersion, now: new Date(), activity: { ok: true, pushes: [] }, git: fakeGitFor(), statuses: {} }))[0].class).toBe("unverified");
  });
});

describe("status precedence: a weaker verification result never downgrades a stronger state", () => {
  it("unverified cannot erase review-required or its reasons", () => {
    const r = rec("review-required", { reasons: ["R11: 3 stocks start a price break"] });
    const out = applyPublication(r, "unverified", ["activity endpoint returned HTTP 403"], "t1");
    expect(out.status).toBe("review-required");
    expect(out.publicationClass).toBe("unverified");
    expect(out.reasons[0]).toBe("R11: 3 stocks start a price break");
    expect(out.reasons.some((x) => x.includes("HTTP 403"))).toBe(true);
  });
  it("neither anomaly nor source-revised can be downgraded by any publication result", () => {
    for (const s of ["anomaly", "source-revised"] as const) for (const c of ["live", "live-late", "unverified", "pending"] as const) expect(applyPublication(rec(s), c, ["x"], "t").status).toBe(s);
  });
  it("evidence releases an `unverified` status set only by an earlier weak verdict, but never review-required", () => {
    expect(applyPublication(rec("unverified", { publicationClass: "unverified" }), "live", [], "t").status).toBe("recorded");
    expect(applyPublication(rec("unverified", { publicationClass: "unverified" }), "live-late", [], "t")).toMatchObject({ status: "recorded-late", publicationClass: "live-late" });
    expect(applyPublication(rec("review-required"), "live", [], "t").status).toBe("review-required");
  });
  it("F1: live-late is sticky - no later result, including a bogus `live`, can promote it, and recorded-late is never released", () => {
    const lateRec = rec("recorded-late", { publicationClass: "live-late", reasons: ["publication: Published after the cut-off"] });
    for (const bogus of ["live", "unverified", "pending"] as const) {
      const out = applyPublication(lateRec, bogus, ["whatever"], "2026-11-02T00:00:00Z");
      expect(out.publicationClass, bogus).toBe("live-late");
      expect(out.status, bogus).toBe("recorded-late");
      expect(out.reasons.some((r) => r.includes("ignored a conflicting verification result")), bogus).toBe(true);
    }
    // the same holds for a live record, and the reasons are not erased
    const liveRec = rec("recorded", { publicationClass: "live" });
    expect(applyPublication(liveRec, "live-late", [], "t").publicationClass).toBe("live");
    expect(applyPublication(lateRec, "live-late", [], "t").publicationClass).toBe("live-late"); // consistent repeat is fine
    // review-required plus live-late stays review-required with a live-late class (two distinct vocabularies)
    expect(applyPublication(rec("review-required", { publicationClass: "pending" }), "live-late", [], "t")).toMatchObject({ status: "review-required", publicationClass: "live-late" });
  });
  it("C1: a receipt-derived result is the authority over a contradictory state, in BOTH directions, and the disagreement is an anomaly", () => {
    const run = (stored: "live" | "live-late", outcome: "live" | "live-late") => {
      const state = emptyState("2026-11-01T00:00:00Z");
      state.dates[last] = rec(stored === "live-late" ? "recorded-late" : "recorded", { publicationClass: stored });
      applyVerificationToState(state, [{ date: last, result: "receipt-exists", class: outcome, reasons: ["x"] }], "2026-11-02T00:00:00Z");
      return state;
    };
    // state wrongly says live, the receipt says live-late: the receipt wins (state is corrected DOWN)
    const a = run("live", "live-late");
    expect(a.dates[last]).toMatchObject({ publicationClass: "live-late", status: "anomaly" });
    expect(ledgerSupplementFrom(a)).toMatchObject({ liveReceipts: 0, liveLateReceipts: 1 });
    // state says live-late, a (tampered) receipt says live: the more conservative class is kept, and it is flagged
    const b = run("live-late", "live");
    expect(b.dates[last]).toMatchObject({ publicationClass: "live-late", status: "anomaly" });
    expect(b.dates[last].reasons.join()).toMatch(/state and receipt disagreed/);
    // agreement is not an anomaly
    expect(run("live-late", "live-late").dates[last].status).toBe("recorded-late");
    // a non-receipt result still cannot move a receipt-backed class (sticky) and does not need an anomaly
    const s2 = emptyState("2026-11-01T00:00:00Z");
    s2.dates[last] = rec("recorded-late", { publicationClass: "live-late" });
    applyVerificationToState(s2, [{ date: last, result: "unverified", class: "unverified", reasons: ["no push found"] }], "2026-11-02T00:00:00Z");
    expect(s2.dates[last]).toMatchObject({ publicationClass: "live-late", status: "recorded-late" });
  });
  it("precedence order and repeat verification is idempotent (reasons are not duplicated)", () => {
    const order = ["recorded", "recorded-late", "unverified", "review-required", "source-revised", "anomaly"] as const;
    for (let i = 1; i < order.length; i++) expect(strongerStatus(order[i - 1], order[i])).toBe(order[i]);
    let r = rec("recorded");
    for (let i = 0; i < 3; i++) r = applyPublication(r, "unverified", ["no matching push"], "t");
    expect(r.reasons).toEqual(["publication: no matching push"]);
  });
  it("a missing or unverified result is never promoted to live without evidence", () => {
    const out = applyPublication(rec("recorded"), "pending", ["not yet"], "t");
    expect(out.publicationClass).toBe("pending");
    expect(H("1")).toHaveLength(40);
  });
});
