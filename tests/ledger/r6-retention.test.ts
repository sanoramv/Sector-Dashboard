/**
 * R6 retention-window exception (design erratum 19). The price files keep ~450 calendar days, pruned by wall-clock time
 * on every refresh, so the re-evaluation of an already-captured session loses its oldest bar and reports a smaller
 * `quality.barsUsed` and a later `quality.usableFrom`. The first live session (2026-11-18) hit exactly this.
 *
 * The real-data tests use the published repository states. They need the full Git history (the governance workflow
 * checks out with fetch-depth 0); a missing object is a test failure, never a silent skip.
 *   d093f0d  data after the 2026-11-18 capture, before the next refresh (no pruning yet)
 *   9e89a3d  data after the 2026-11-19 refresh (2025-08-26 pruned)   - the run that raised the anomaly
 *   0e86cce  latest published data at the time of the fix
 *   9cde568 / 9e89a3d add the immutable 2026-11-18 / 2026-11-19 records; f9c6653 / 1b63cbd their receipts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { checkRetentionOnly, compareR6, evaluateSession, loadSource, readExistingDaily, retentionInputFor, retentionNormalised, runCapture, type CaptureSource, type ExistingDaily, type RetentionInput } from "../../scripts/ledger/capture.mts";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { computeLiveHoldout, type GuardGit } from "../../scripts/ledger/guard.mts";
import { summariseR10 } from "../../scripts/ledger/readiness.mts";
import { applyCaptureToState } from "../../scripts/ledger/run.mts";
import { validateState, type LedgerState } from "../../scripts/ledger/state.mts";
import { prepareUniverse, type PreparedUniverse } from "../../src/lib/momentum/universe.ts";
import { makeEnv, realVersion, tmpDir } from "./fixture";

const RULE_VERSION = "mv1-8ecef864";
const D18 = "2026-11-18";
const D19 = "2026-11-19";
const SHA18_STORED = "ac454375470c738912e2c5c1986458c4f8d877ccd75d9b4adf6601cacf820308";
const SHA18_PRUNED = "601c4d671603eaa0830721534475ba50599011813a1a6d7363528f13adbfb71f";
const SHA19_STORED = "fbc384ee3938dab3b783251523b3639c8648932caadb2283bf3c65f23adb794e";
const COMMIT = { beforePrune: "d093f0d", afterPrune: "9e89a3d", latest: "0e86cce" };
const DATA_FILES = ["manifest", "index-series", "constituents", "stocks", "stock-activity", "refresh-state"];
const LEDGER = "public/data/ledger";
const rec = (d: string) => `${LEDGER}/live/predictions/${RULE_VERSION}/${d}.json`;
const rcp = (d: string) => `${LEDGER}/live/receipts/${d}.json`;

const git = (...args: string[]) => execFileSync("git", args, { maxBuffer: 512 * 1024 * 1024 }).toString("utf-8");
const show = (commit: string, file: string) => {
  try {
    return git("show", `${commit}:${file}`);
  } catch {
    throw new Error(`Git object ${commit}:${file} is not available. These regression tests need the full history (git fetch --unshallow / fetch-depth: 0).`);
  }
};
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

let tmp: Awaited<ReturnType<typeof tmpDir>>;
const holdoutBefore = { text: "" };
const stored = { r18: "", r19: "", c18: "", c19: "", state: "" };
const data: Record<string, CaptureSource> = {};
let u18After: PreparedUniverse;
let cand18After: unknown[];
let existing18: Extract<ExistingDaily, { kind: "valid" }>;

async function materialise(commit: string): Promise<CaptureSource> {
  const dir = path.join(tmp.dir, `data-${commit}`);
  await mkdir(dir, { recursive: true });
  for (const f of DATA_FILES) await writeFile(path.join(dir, `${f}.json`), show(commit, `public/data/${f}.json`));
  return loadSource(dir);
}

/** A ledger root holding the real immutable records (and optionally receipts + the published state). */
async function ledgerRoot(name: string, opts: { d19?: boolean; receipts?: boolean; state?: boolean } = {}): Promise<string> {
  const root = path.join(tmp.dir, name, "ledger");
  const p = ledgerPaths(root);
  await mkdir(path.dirname(p.dailyFile(RULE_VERSION, D18)), { recursive: true });
  await writeFile(p.dailyFile(RULE_VERSION, D18), stored.r18);
  if (opts.d19) await writeFile(p.dailyFile(RULE_VERSION, D19), stored.r19);
  if (opts.receipts) {
    await mkdir(path.dirname(p.receiptFile(D18)), { recursive: true });
    await writeFile(p.receiptFile(D18), stored.c18);
    if (opts.d19) await writeFile(p.receiptFile(D19), stored.c19);
  }
  if (opts.state) await writeFile(p.state, stored.state);
  return root;
}

const envFor = async (root: string, now: string) => makeEnv(root, { now: new Date(now), enabledFrom: D18 });
const session = (run: Awaited<ReturnType<typeof runCapture>>, d: string) => run.sessions.find((s) => s.date === d)!;
/** Drops every stock / index bar and volume row on or before `cut` (what the next refresh's pruning would do). */
function prune(src: CaptureSource, cut: string): CaptureSource {
  const c = structuredClone(src);
  for (const s of Object.values(c.dataset.stocks)) if (s) s.bars = s.bars.filter((b) => b.date > cut);
  for (const s of Object.values(c.dataset.indexSeries)) if (s) s.bars = s.bars.filter((b) => b.date > cut);
  for (const k of Object.keys(c.activity)) c.activity[k] = c.activity[k].filter((r) => r.date > cut);
  return c;
}

beforeAll(async () => {
  tmp = await tmpDir();
  holdoutBefore.text = await readFile(`${LEDGER}/holdout.json`, "utf-8");
  stored.r18 = show(COMMIT.latest, rec(D18));
  stored.r19 = show(COMMIT.latest, rec(D19));
  stored.c18 = show(COMMIT.latest, rcp(D18));
  stored.c19 = show(COMMIT.latest, rcp(D19));
  stored.state = show(COMMIT.latest, `${LEDGER}/ledger-state.json`);
  for (const c of Object.values(COMMIT)) data[c] = await materialise(c);
  // The candidate the 2026-11-19 refresh produced for 2026-11-18 (the anomaly), for field-level mutation tests.
  u18After = prepareUniverse(data[COMMIT.afterPrune].dataset, data[COMMIT.afterPrune].activity);
  const env = await envFor(path.join(tmp.dir, "none"), "2026-11-19T22:20:00Z");
  cand18After = (evaluateSession(data[COMMIT.afterPrune], u18After, D18, env, null).daily as { predictions: unknown[] }).predictions;
  const root = await ledgerRoot("unit");
  existing18 = (await readExistingDaily(ledgerPaths(root).dailyFile(RULE_VERSION, D18), { date: D18, ruleVersion: RULE_VERSION })) as typeof existing18;
}, 600_000);
afterAll(async () => tmp?.cleanup());

// ---------- helpers for field-level (unit) tests on the real 2026-11-18 record ----------
type P = { symbol: string; lists: { rank: number }[]; bar: { close: number }; activity: { volume: number | null }; classification: { setup: string; netScore: number; quality: { status: string; notes: string[]; barsUsed: number; usableFrom: string } } };
const realRetention = (cands: unknown[], over: Partial<RetentionInput> = {}): RetentionInput => ({ ...retentionInputFor(u18After, D18, cands, false), ...over });
/** compareR6 on the real stored record vs a (possibly mutated) copy of the real post-pruning candidate. */
/** Re-establishes the recordHash contract after a mutation, so a test rejects the FIELD, not a stale hash. */
const rehash = (rows: P[]) => rows.forEach((r) => {
  const { recordHash: _old, ...rest } = r as P & { recordHash?: string };
  (r as P & { recordHash: string }).recordHash = sha256Canonical(rest);
});
function compareMutated(mutate: (c: P[]) => void, over: Partial<RetentionInput> = {}, existing: ExistingDaily = existing18, opts: { rehash?: boolean } = {}) {
  const c = structuredClone(cand18After) as P[];
  mutate(c);
  if (opts.rehash !== false) rehash(c);
  return compareR6(existing, sha256Canonical(c), null, existing18.universeLists, realRetention(c, over));
}
/** First prediction whose quality fields changed through pruning (the stock's history began at the window start). */
const prunedIndex = () => (existing18.predictions as P[]).findIndex((p, k) => p.classification.quality.barsUsed !== (cand18After as P[])[k].classification.quality.barsUsed);
const withStored = (mutate: (s: P[]) => void, opts: { rehash?: boolean } = {}): Extract<ExistingDaily, { kind: "valid" }> => {
  const s = structuredClone(existing18.predictions) as P[];
  mutate(s);
  if (opts.rehash !== false) rehash(s);
  return { ...existing18, predictions: s, predictionsSha256: sha256Canonical(s) };
};

describe("R6 retention-window exception: real 2026-11-18 data", () => {
  it("1. the stored record reproduces before pruning, and differs after pruning only in barsUsed/usableFrom (+ recordHash)", async () => {
    const r = await runCapture(data[COMMIT.beforePrune], await envFor(await ledgerRoot("before"), "2026-11-19T10:32:00Z"));
    const s = session(r, D18);
    expect(s.r6).toMatchObject({ status: "existing", existingPredictionsSha256: SHA18_STORED, candidatePredictionsSha256: SHA18_STORED });
    expect(s.r6!.reasonCode).toBeUndefined();
    // field-level diff of the real anomaly candidate
    const a = existing18.predictions as P[];
    const b = cand18After as P[];
    expect(sha256Canonical(b)).toBe(SHA18_PRUNED);
    expect(b.map((p) => p.symbol)).toEqual(a.map((p) => p.symbol));
    const flat = (o: unknown, pre = ""): Record<string, string> => Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>((m, [k, x]) => (x && typeof x === "object" && !Array.isArray(x) ? Object.assign(m, flat(x, `${pre}${k}.`)) : ((m[`${pre}${k}`] = JSON.stringify(x)), m)), {});
    const changed: Record<string, number> = {};
    a.forEach((p, k) => {
      const fa = flat(p), fb = flat(b[k]);
      for (const f of new Set([...Object.keys(fa), ...Object.keys(fb)])) if (fa[f] !== fb[f]) changed[f] = (changed[f] ?? 0) + 1;
    });
    expect(changed).toEqual({ "classification.quality.barsUsed": 102, "classification.quality.usableFrom": 102, recordHash: 102 });
    expect(sha256Canonical(a.map(retentionNormalised))).toBe(sha256Canonical(b.map(retentionNormalised)));
  });

  it("2. harmless pruning is accepted: existing / retention-window-only, both digests kept as evidence", async () => {
    for (const c of [COMMIT.afterPrune, COMMIT.latest]) {
      const r = await runCapture(data[c], await envFor(await ledgerRoot(`after-${c}`, { d19: true }), "2026-11-20T00:59:00Z"));
      const s = session(r, D18);
      expect(s.outcome).toBe("exists");
      expect(s.r6).toMatchObject({ status: "existing", reasonCode: "retention-window-only", existingPredictionsSha256: SHA18_STORED, candidatePredictionsSha256: SHA18_PRUNED });
      expect(s.r6!.detail).toContain("102 of 126 prediction(s) differ only in quality.barsUsed / quality.usableFrom");
      expect(s.checks.find((x) => x.id === "R6")).toMatchObject({ status: "pass", disposition: "ok" });
      // 2026-11-19 was built from 9e89a3d's data: identical digest, no exception involved.
      expect(session(r, D19).r6).toMatchObject({ status: "existing", existingPredictionsSha256: SHA19_STORED, candidatePredictionsSha256: SHA19_STORED });
    }
  });

  it("2b. the next prune (simulated) is also accepted, for 2026-11-18 and 2026-11-19", async () => {
    const r = await runCapture(prune(data[COMMIT.latest], "2025-08-28"), await envFor(await ledgerRoot("sim-prune", { d19: true }), "2026-11-20T22:20:00Z"));
    expect(session(r, D18).r6).toMatchObject({ status: "existing", reasonCode: "retention-window-only", existingPredictionsSha256: SHA18_STORED });
    expect(session(r, D19).r6).toMatchObject({ status: "existing", reasonCode: "retention-window-only", existingPredictionsSha256: SHA19_STORED });
  });

  it("15. repeated executions produce identical results", async () => {
    const root = await ledgerRoot("repeat", { d19: true });
    const strip = (x: Awaited<ReturnType<typeof runCapture>>) => x.sessions.map((s) => ({ date: s.date, outcome: s.outcome, r6: s.r6 }));
    const r1 = await runCapture(data[COMMIT.afterPrune], await envFor(root, "2026-11-19T22:20:00Z"));
    const r2 = await runCapture(data[COMMIT.afterPrune], await envFor(root, "2026-11-19T23:40:00Z"));
    expect(strip(r2)).toEqual(strip(r1));
    expect(checkRetentionOnly(existing18, SHA18_PRUNED, realRetention(cand18After))).toEqual(checkRetentionOnly(existing18, SHA18_PRUNED, realRetention(cand18After)));
  });
});

describe("R6 retention-window exception: everything else still fails closed", () => {
  it("3. a score change is rejected", () => {
    expect(compareMutated((c) => (c[0].classification.netScore += 1)).status).toBe("anomaly");
  });
  it("4. a setup change is rejected", () => {
    expect(compareMutated((c) => (c[0].classification.setup = c[0].classification.setup === "mixed" ? "weak" : "mixed")).status).toBe("anomaly");
  });
  it("5. a rank change is rejected", () => {
    expect(compareMutated((c) => (c[0].lists[0].rank += 1)).status).toBe("anomaly");
  });
  it("6. price and volume changes are rejected", () => {
    expect(compareMutated((c) => (c[0].bar.close += 0.05)).status).toBe("anomaly");
    expect(compareMutated((c) => (c[1].activity.volume = (c[1].activity.volume ?? 0) + 1)).status).toBe("anomaly");
  });
  it("7. a quality status change is rejected", () => {
    const k = prunedIndex();
    expect(compareMutated((c) => (c[k].classification.quality.status = c[k].classification.quality.status === "ok" ? "limited" : "ok")).status).toBe("anomaly");
  });
  it("8. a quality notes change is rejected", () => {
    const k = prunedIndex();
    expect(compareMutated((c) => c[k].classification.quality.notes.push("Features use only prices from 2026-01-05 (price discontinuity).")).status).toBe("anomaly");
  });
  it("9. barsUsed / usableFrom changes unrelated to pruning are rejected", () => {
    const k = prunedIndex();
    // more bars lost than the data shows
    expect(compareMutated((c) => (c[k].classification.quality.barsUsed -= 1)).detail).toContain("does not match");
    // only one of the two fields changed
    const r1 = compareMutated((c) => (c[k].classification.quality.usableFrom = (existing18.predictions as P[])[k].classification.quality.usableFrom));
    expect(r1.status).toBe("anomaly");
    expect(r1.detail).toContain("only one of barsUsed / usableFrom changed");
    // stored start NOT in the pruned part of the history (e.g. a price break inside the current window)
    const ex = withStored((s) => (s[k].classification.quality.usableFrom = "2026-01-05"));
    const r2 = compareMutated(() => undefined, {}, ex);
    expect(r2.status).toBe("anomaly");
    expect(r2.detail).toContain("is not in the pruned part of the history");
    // current start is not the stock's first bar in an unbroken history (a new discontinuity)
    const r3 = compareMutated(() => undefined, { stock: (sym) => ({ ...realRetention(cand18After).stock(sym)!, firstSegment: false }) });
    expect(r3.status).toBe("anomaly");
    expect(r3.detail).toContain("unbroken history");
    // more bars lost than sessions pruned (1 session was pruned)
    const ex2 = withStored((s) => (s[k].classification.quality.barsUsed += 1));
    expect(compareMutated(() => undefined, {}, ex2).detail).toContain("session(s) were pruned");
  });
  it("10. barsUsed below 252 is rejected", () => {
    const k = prunedIndex();
    const ex = withStored((s) => (s[k].classification.quality.barsUsed = 200));
    const sym = (cand18After as P[])[k].symbol;
    const view = realRetention(cand18After).stock;
    const r = compareMutated((c) => (c[k].classification.quality.barsUsed = 199), { stock: (s) => (s === sym ? { ...view(s)!, barsUpToDate: 199 } : view(s)) }, ex);
    expect(r.status).toBe("anomaly");
    expect(r.detail).toContain("is below 252");
  });
  it("11. a pruning-caused loss of the 365-day lookback is uncompared (history-below-lookback), never a pass", () => {
    const cal = u18After.calendar.filter((d) => d > "2025-12-01");
    const r = compareMutated(() => undefined, { calendar: cal });
    expect(r).toMatchObject({ status: "existing-uncompared", reasonCode: "history-below-lookback" });
    // when the stored history never covered the lookback either, nothing explains the mismatch: anomaly
    const ex: typeof existing18 = { ...existing18, calendar: { ...existing18.calendar!, firstDate: "2025-11-25" } };
    expect(compareMutated(() => undefined, { calendar: cal }, ex).status).toBe("anomaly");
  });
  it("12. a material R10 source revision is never explained away (unit and end-to-end)", async () => {
    expect(compareMutated(() => undefined, { sourceRevised: true }).detail).toContain("R10 reports a source revision");
    // End-to-end: revise one stored volume row inside the 365-day window of 2026-11-18 (no effect on any prediction).
    const src = structuredClone(data[COMMIT.afterPrune]);
    const sym = Object.keys(src.activity).find((s) => src.activity[s].some((r) => r.date === "2026-01-14"))!;
    src.activity[sym] = src.activity[sym].map((r) => (r.date === "2026-01-14" ? { ...r, volume: (r.volume ?? 0) + 1 } : r));
    const r = await runCapture(src, await envFor(await ledgerRoot("r10"), "2026-11-19T22:20:00Z"));
    expect(r.r10.status).toBe("warn");
    expect(r.r10Sessions.find((s) => s.date === D18)).toMatchObject({ ok: false });
    expect(session(r, D18).r6!.status).toBe("anomaly");
    expect(session(r, D18).r6!.detail).toContain("R10 reports a source revision");
  });
  it("13. a constituent-list refresh keeps its existing behaviour (uncompared, constituent-lists-refreshed)", () => {
    const lists = structuredClone(existing18.universeLists);
    lists[0] = { ...lists[0], sha256: "0".repeat(64) };
    const r = compareR6(existing18, SHA18_PRUNED, null, lists, realRetention(cand18After));
    expect(r).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
  });
  it("without retention input (or for synthetic data that was never pruned) the original behaviour is unchanged", () => {
    expect(compareR6(existing18, SHA18_PRUNED, null, existing18.universeLists).status).toBe("anomaly");
    const old: ExistingDaily = { kind: "valid", predictionsSha256: SHA18_STORED, universeLists: existing18.universeLists };
    expect(compareR6(old, SHA18_PRUNED, null, existing18.universeLists, realRetention(cand18After)).status).toBe("anomaly");
    // no pruning happened (stored calendar starts where the current one does)
    const same: typeof existing18 = { ...existing18, calendar: { ...existing18.calendar!, firstDate: u18After.calendar[0] } };
    expect(compareMutated(() => undefined, {}, same).detail).toContain("nothing was pruned");
  });
});

describe("R6 retention-window exception: final safety audit", () => {
  it("A1. a manipulated stored recordHash on disk makes the record invalid: anomaly, never retention-only", async () => {
    const root = await ledgerRoot("tampered-disk");
    const f = ledgerPaths(root).dailyFile(RULE_VERSION, D18);
    const d = JSON.parse(stored.r18);
    d.predictions[0].recordHash = "0".repeat(64);
    d.header.predictionsSha256 = sha256Canonical(d.predictions); // even with a consistent full digest
    await writeFile(f, JSON.stringify(d) + "\n");
    expect(await readExistingDaily(f, { date: D18, ruleVersion: RULE_VERSION })).toMatchObject({ kind: "invalid" });
    const r = await runCapture(data[COMMIT.afterPrune], await envFor(root, "2026-11-19T22:20:00Z"));
    expect(session(r, D18).r6!.status).toBe("anomaly");
  });
  it("A2. a manipulated recordHash in memory (stored or candidate) is rejected by the exception itself", () => {
    const k = prunedIndex();
    const ex = withStored((s) => ((s[k] as P & { recordHash: string }).recordHash = "f".repeat(64)), { rehash: false });
    expect(compareMutated(() => undefined, {}, ex).detail).toContain("the stored recordHash does not match its record");
    expect(compareMutated((c) => ((c[k] as P & { recordHash: string }).recordHash = "e".repeat(64)), {}, existing18, { rehash: false }).detail).toContain("the candidate recordHash does not match its record");
    // a stale hash after a real field change is rejected as well
    expect(compareMutated((c) => (c[k].classification.netScore += 1), {}, existing18, { rehash: false }).status).toBe("anomaly");
  });
  it("A3. both full digests are verified independently of the caller", () => {
    expect(checkRetentionOnly({ ...existing18, predictionsSha256: "1".repeat(64) }, SHA18_PRUNED, realRetention(cand18After))).toMatchObject({ kind: "not-applicable", why: "the stored predictions do not match the stored digest" });
    expect(checkRetentionOnly(existing18, "2".repeat(64), realRetention(cand18After))).toMatchObject({ kind: "not-applicable", why: "the candidate predictions do not match the candidate digest" });
  });
  it("A4. every recordHash difference in the real case is explained by the two retention fields only", () => {
    const a = existing18.predictions as (P & { recordHash: string })[];
    const b = cand18After as (P & { recordHash: string })[];
    a.forEach((p, k) => {
      const q = b[k];
      if (p.recordHash === q.recordHash) return;
      const back = structuredClone(q);
      back.classification.quality.barsUsed = p.classification.quality.barsUsed;
      back.classification.quality.usableFrom = p.classification.quality.usableFrom;
      const { recordHash: _r, ...rest } = back;
      expect(sha256Canonical(rest)).toBe(p.recordHash); // restoring only the two fields restores the stored hash
    });
  });

  it("A5. the 50-event cap never drops the first anomaly; 18 Nov and an anomalous 19 Nov stay excluded after 70 passing runs", async () => {
    const root = await ledgerRoot("cap", { d19: true, receipts: true, state: true });
    const p = ledgerPaths(root);
    const state = JSON.parse(stored.state) as LedgerState;
    const first18 = state.dates[D18].r6Events!.find((e) => e.status === "anomaly")!;
    const base = { checks: [], reasons: [] as string[], warnings: [] as string[], file: "x" };
    const ctx = (i: number) => ({ now: new Date(Date.UTC(2026, 10, 21) + i * 3_600_000).toISOString(), slot: null, ruleVersion: RULE_VERSION, enabledVersion: RULE_VERSION, enabledFrom: D18, startedAt: new Date(Date.UTC(2026, 10, 21) + i * 3_600_000).toISOString(), captureSeconds: 1 });
    // 19 Nov acquires an anomaly first (as expected tonight), then both dates see 70 passing results with new digests
    applyCaptureToState(state, { r10: summariseR10([]), r10Sessions: [], sessions: [{ date: D19, outcome: "anomaly", ...base, reasons: ["R6: test anomaly"], r6: { status: "anomaly", existingPredictionsSha256: SHA19_STORED, candidatePredictionsSha256: "9".repeat(64), detail: "test anomaly" } }] }, ctx(0));
    for (let i = 1; i <= 70; i++) {
      const pass = (d: string, ex: string) => ({ date: d, outcome: "exists" as const, ...base, r6: { status: "existing" as const, reasonCode: "retention-window-only" as const, existingPredictionsSha256: ex, candidatePredictionsSha256: sha256Canonical([d, i]), detail: "retention-only" } });
      applyCaptureToState(state, { r10: summariseR10([]), r10Sessions: [], sessions: [pass(D18, SHA18_STORED), pass(D19, SHA19_STORED)] }, ctx(i));
    }
    for (const d of [D18, D19]) {
      const rec = state.dates[d];
      expect(rec.status).toBe("anomaly");
      expect(rec.r6!.status).toBe("anomaly");
      expect(rec.r6Events!.length).toBeLessThanOrEqual(50);
      expect(rec.r6Events!.filter((e) => e.status === "anomaly").length).toBeGreaterThanOrEqual(1);
    }
    expect(state.dates[D18].r6Events!.find((e) => e.status === "anomaly")).toEqual(first18); // the ORIGINAL anomaly, verbatim
    expect(validateState(state)).toEqual([]);
    await writeFile(p.state, JSON.stringify(state, null, 1) + "\n");
    const h = await computeLiveHoldout({ log: async () => "", show: async () => null, revParse: async () => null }, root);
    expect(h.eligible).toEqual([]);
    for (const d of [D18, D19]) expect(h.sessions.find((s) => s.date === d)!.reasons.join(" ")).toContain("R6 anomaly");
  });
});

describe("R6 retention-window exception: evidence, holdout and rule version", () => {
  it("14 / 16 / 17. stored files untouched; anomaly history kept; the guard still excludes 2026-11-18", async () => {
    const root = await ledgerRoot("holdout", { d19: true, receipts: true, state: true });
    const p = ledgerPaths(root);
    const run = await runCapture(data[COMMIT.latest], await envFor(root, "2026-11-20T22:20:00Z"));
    expect(session(run, D18).r6).toMatchObject({ status: "existing", reasonCode: "retention-window-only" });
    // 14. immutable files byte-identical; digests unchanged
    expect(await readFile(p.dailyFile(RULE_VERSION, D18), "utf-8")).toBe(stored.r18);
    expect(await readFile(p.dailyFile(RULE_VERSION, D19), "utf-8")).toBe(stored.r19);
    expect(await readFile(p.receiptFile(D18), "utf-8")).toBe(stored.c18);
    expect(JSON.parse(stored.r18).header.predictionsSha256).toBe(SHA18_STORED);
    // 16. fold into the real published state: the anomaly and every earlier event remain
    const state = JSON.parse(stored.state) as LedgerState;
    const before = structuredClone(state.dates[D18]);
    applyCaptureToState(state, run, { now: "2026-11-20T22:20:30Z", slot: null, ruleVersion: RULE_VERSION, enabledVersion: RULE_VERSION, enabledFrom: D18, startedAt: "2026-11-20T22:20:00Z", captureSeconds: 1 });
    const after = state.dates[D18];
    expect(after.status).toBe("anomaly");
    expect(after.r6).toMatchObject({ status: "anomaly", existingPredictionsSha256: SHA18_STORED, candidatePredictionsSha256: SHA18_PRUNED });
    expect(after.r6!.firstAnomalyAt).toBe(before.r6!.firstAnomalyAt);
    expect(after.r6!.latestObservation).toMatchObject({ status: "existing", reasonCode: "retention-window-only" });
    expect(after.r6Events!.slice(0, before.r6Events!.length)).toEqual(before.r6Events);
    expect(after.r6Events!.some((e) => e.status === "anomaly")).toBe(true);
    expect(after.r6Events!.at(-1)).toMatchObject({ status: "existing", reasonCode: "retention-window-only", existingPredictionsSha256: SHA18_STORED, candidatePredictionsSha256: SHA18_PRUNED });
    expect(validateState(state)).toEqual([]);
    await writeFile(p.state, JSON.stringify(state, null, 1) + "\n");
    // 17. eligibility: 2026-11-18 stays excluded (no automatic restoration); 2026-11-19 had no anomaly
    const noHistory: GuardGit = { log: async () => "", show: async () => null, revParse: async () => null };
    const h = await computeLiveHoldout(noHistory, root);
    expect(h.sessions.find((s) => s.date === D18)).toMatchObject({ eligible: false });
    expect(h.sessions.find((s) => s.date === D18)!.reasons.join(" ")).toContain("R6 anomaly");
    expect(h.eligible).toEqual([D19]);
  });

  it("18 / 19. holdout.json is untouched and never written; nothing here can unblind", async () => {
    expect(await readFile(`${LEDGER}/holdout.json`, "utf-8")).toBe(holdoutBefore.text);
    const h = JSON.parse(holdoutBefore.text);
    expect(h).toMatchObject({ status: "sealed", unblinded: null });
    // no test root contains a holdout file: capture and state folding never create one
    const found: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) e.isDirectory() ? await walk(path.join(d, e.name)) : e.name === "holdout.json" && found.push(path.join(d, e.name));
    };
    await walk(tmp.dir);
    expect(found).toEqual([]);
    // the exception's code never touches holdout state
    const src = await readFile("scripts/ledger/capture.mts", "utf-8");
    expect(/holdout|unblind/i.test(src)).toBe(false);
  });

  it("20. the rule version is still mv1-8ecef864 (no rule-hash file changed)", async () => {
    expect((await realVersion()).ruleVersion).toBe(RULE_VERSION);
    expect(sha256(holdoutBefore.text)).toBe(sha256(await readFile(`${LEDGER}/holdout.json`)));
  });
});

