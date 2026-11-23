/**
 * Phase B2a: private outcome pipeline foundation. SYNTHETIC fixtures only (all dates in 2031); no real prediction,
 * market data or outcome is read or produced. Nothing connects to GitHub.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { sha256Canonical, sha256Hex } from "../../scripts/ledger/canonical.mts";
import { od1DefinitionsSha256 } from "../../scripts/ledger/protocol.mts";
import { OD1_CLASSES, od1Epsilon, od1Measure, od1SigmaWindow, populationSd } from "../../scripts/ledger/od1.mts";
import { ENGINE_FILES, OUTCOME_CORRECTION_KIND, buildOutcomeReceipt, buildOutcomeRecord, commitmentOf, computeEngine, requireUnblinded, verifyReceiptAgainstRecord, type OutcomeCorrection, type OutcomeRecord } from "../../scripts/ledger/outcomes.mts";
import { SYNTHETIC_FROM, SYNTHETIC_ONLY, assertSyntheticSession, buildDueRecord, evidenceFor, planOutcomes, type RunnerContext, type RunnerMarket } from "../../scripts/ledger/outcome-runner.mts";
import { FsPrivateStore, assertSalt, parseStorageKey, storedText, type PrivateStore } from "../../scripts/ledger/private-store.mts";
import { FsPublicReceiptSink, correctionReceiptOf, correctionReceiptRel, outcomeReceiptRel, receiptForStoredRecord, receiptLeakProblems, receiptText, protectedContentReason, scanForOutcomeLeaks, scanRepositoryForOutcomeLeaks, validateOutcomeReceiptTree, type PublicReceiptSink } from "../../scripts/ledger/outcome-receipts.mts";
import { ALERT_TEXT, alertIssueText, assertProtectedExecutionContext, effectiveEnv, runOutcomePipeline, type PipelineDeps } from "../../scripts/ledger/outcome-pipeline.mts";
import { loadRunnerMarket, loadRunnerSessions } from "../../scripts/ledger/outcome-inputs.mts";
import { checkOutcomeConfidentiality } from "../../scripts/ledger/guard.mts";
import { UnsafePathError, relativeSegments } from "../../scripts/ledger/safe-path.mts";
import { weekdays } from "../momentum/fixtures";
import type { DailyBar } from "../../src/types/market";

const RV = "mv1-8ecef864";
const DEFS = od1DefinitionsSha256();
const ENV = { OD1_PROTECTED_CONTEXT: "private-outcome-repository", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "owner/private-od1-outcomes" };

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic world (2031): 70 weekdays, one exchange holiday, a handful of stocks with known features
// ---------------------------------------------------------------------------------------------------------------------
const CAL = weekdays("2031-01-06", 70);
const HOLIDAY = CAL[43];
const TRADING = CAL.filter((d) => d !== HOLIDAY);
const T0 = TRADING[30]; // eligible but before activation
const ACT = TRADING[35];
const T1 = TRADING[40]; // main session: windows span the holiday
const TX = TRADING[41]; // excluded from the live holdout
const TL = TRADING[44]; // receipt class live-late
const T2 = TRADING[TRADING.length - 8]; // h10 not yet mature
const idx = (d: string) => TRADING.indexOf(d);

const wave = (i: number, seed: number, amp = 0.02) => 100 * (1 + amp * Math.sin(i * 0.7 + seed)) + seed;
const mkBar = (date: string, open: number, close: number, spread = 0.01): DailyBar => ({ date, open, high: Math.max(open, close) * (1 + spread), low: Math.min(open, close) * (1 - spread), close });
function series(closes: Array<number | null>, dates = TRADING): DailyBar[] {
  const out: DailyBar[] = [];
  let prev: number | null = null;
  closes.forEach((c, i) => {
    if (c === null) return;
    out.push(mkBar(dates[i], prev ?? c, c));
    prev = c;
  });
  return out;
}

interface World {
  stocks: Record<string, { symbol: string; bars: DailyBar[] }>;
  benchmark: DailyBar[];
  refreshState: RunnerMarket["refreshState"];
  latestDueDate: string;
}
function makeWorld(): World {
  const n = TRADING.length;
  const stocks: World["stocks"] = {};
  const put = (symbol: string, bars: DailyBar[]) => (stocks[symbol] = { symbol, bars });
  put("AAA", series(Array.from({ length: n }, (_, i) => wave(i, 1))));
  put("BBB", series(Array.from({ length: n }, (_, i) => wave(i, 2, 0.03))));
  put("CCC", series(Array.from({ length: n }, (_, i) => wave(i, 3) * (i > idx(T1) ? 1.002 ** (i - idx(T1)) : 1))));
  // corporate action (1:2 split) on t+2 of T1: h1 complete, every longer window a discontinuity
  put("BRK", series(Array.from({ length: n }, (_, i) => wave(i, 4))).map((b, i) => (i >= idx(T1) + 2 ? { date: b.date, open: b.open * 0.5, high: b.high * 0.5, low: b.low * 0.5, close: b.close * 0.5 } : b)));
  // no bar on t+1 of T1
  put("GAP", series(Array.from({ length: n }, (_, i) => (i === idx(T1) + 1 ? null : wave(i, 5)))));
  // listed late: < 22 comparable bars at T1 -> frozen volatility20 null -> insufficient-history
  put("NEW", series(Array.from({ length: n }, (_, i) => (i < idx(T1) - 15 ? null : wave(i, 6)))));
  // near-flat history (sigma tiny, eps = the 0.20 floor) with an exact +0.20% move on t+1 and +0.19% for the twin
  const flat = (bump: number) => Array.from({ length: n }, (_, i) => (i < idx(T1) ? 124.99 + (i % 2 ? 0.001 : 0) : i === idx(T1) ? 125 : 125 * bump));
  put("EPS", series(flat(1.002)));
  put("EPZ", series(flat(1.0019)));
  const benchmark = series(Array.from({ length: n }, (_, i) => 20000 * (1 + 0.004 * Math.sin(i / 3))));
  const archives = { index: {} as Record<string, any>, stocks: {} as Record<string, any> };
  for (const d of CAL) {
    const trading = d !== HOLIDAY;
    archives.index[d] = { status: trading ? "ok" : "missing", checkedAt: `${d}T15:00:00Z` };
    archives.stocks[d] = { status: trading ? "ok" : "earlier-session", checkedAt: `${d}T15:00:00Z` };
  }
  return { stocks, benchmark, refreshState: { schemaVersion: 1, archives }, latestDueDate: CAL[CAL.length - 1] };
}

function comparableUpTo(bars: DailyBar[], date: string) {
  return bars.filter((b) => b.date <= date);
}
function prediction(w: World, date: string, symbol: string) {
  const bars = w.stocks[symbol].bars;
  const i = bars.findIndex((b) => b.date === date);
  if (i < 1) return null;
  const b = bars[i];
  const changePct = (b.close / bars[i - 1].close - 1) * 100;
  if (changePct === 0) return null;
  const ch = od1SigmaWindow(comparableUpTo(bars, date));
  const rec: Record<string, unknown> = { predictionId: `${date}|${symbol}|${RV}`, date, symbol, bar: { open: b.open, high: b.high, low: b.low, close: b.close, prevClose: bars[i - 1].close }, price: { changePct, volatility20: ch ? populationSd(ch) : null }, classification: { setup: "synthetic" } };
  rec.recordHash = sha256Canonical(rec);
  return rec as any;
}
function daily(w: World, date: string, symbols = Object.keys(w.stocks)) {
  const predictions = symbols.map((s) => prediction(w, date, s)).filter(Boolean);
  return { kind: "momentum-ledger.daily", header: { sessionDate: date, predictionsSha256: sha256Canonical(predictions), predictionCount: predictions.length, model: { ruleVersion: RV } }, predictions };
}

const tmpRoots: string[] = [];
async function tmp(prefix: string) {
  const d = await mkdtemp(path.join(os.tmpdir(), `b2a-${prefix}-`));
  tmpRoots.push(d);
  return d;
}
afterEach(async () => {
  while (tmpRoots.length) await rm(tmpRoots.pop()!, { recursive: true, force: true });
});

/** Writes the world in its PUBLISHED formats and loads it back through the production loaders. */
async function materialise(w: World, opts: { sessions?: Array<[string, string]> } = {}) {
  const ledger = await tmp("ledger");
  const data = await tmp("data");
  const sessions = opts.sessions ?? [
    [T0, "live"],
    [T1, "live"],
    [TX, "live"],
    [TL, "live-late"],
    [T2, "live"],
  ];
  for (const [d, cls] of sessions) {
    await mkdir(path.join(ledger, "live", "predictions", RV), { recursive: true });
    await mkdir(path.join(ledger, "live", "receipts"), { recursive: true });
    await writeFile(path.join(ledger, "live", "predictions", RV, `${d}.json`), JSON.stringify(daily(w, d), null, 1));
    await writeFile(path.join(ledger, "live", "receipts", `${d}.json`), JSON.stringify({ kind: "momentum-ledger.receipt", class: cls }));
  }
  await writeFile(path.join(data, "index-series.json"), JSON.stringify({ nifty500: { slug: "nifty500", bars: w.benchmark } }));
  await writeFile(path.join(data, "stocks.json"), JSON.stringify(w.stocks));
  await writeFile(path.join(data, "refresh-state.json"), JSON.stringify(w.refreshState));
  await writeFile(path.join(data, "manifest.json"), JSON.stringify({ refresh: { latestDueDate: w.latestDueDate } }));
  const runnerSessions = await loadRunnerSessions(ledger, RV);
  const market = await loadRunnerMarket(data, { repoRoot: process.cwd(), commit: "c".repeat(40) });
  return { ledger, data, sessions: runnerSessions, market };
}

let saltCounter = 0;
const newSalt = () => createHash("sha256").update(`synthetic-salt-${saltCounter++}`).digest("hex");
async function context(over: Partial<RunnerContext> = {}): Promise<Omit<RunnerContext, "stored">> {
  return { ruleVersion: RV, activation: { outcomesFrom: ACT }, eligibleSessions: new Set([T0, T1, TL, T2]), definitionsSha256: DEFS, engine: await computeEngine(process.cwd(), DEFS), generatedAt: `${TRADING[TRADING.length - 1]}T16:00:00.000Z`, github: { runId: null, runAttempt: null, sha: null }, newSalt, ...over };
}
async function setup(w = makeWorld()) {
  const m = await materialise(w);
  const storeRoot = await tmp("private");
  const store = await FsPrivateStore.open(storeRoot, { repoRoot: process.cwd(), definitionsSha256: DEFS });
  const sink = new FsPublicReceiptSink(m.ledger);
  const ctx = await context();
  const deps: PipelineDeps = { store, sink, env: ENV };
  return { ...m, w, storeRoot, store, sink, ctx, deps };
}
const run = (s: Awaited<ReturnType<typeof setup>>, deps: Partial<PipelineDeps> = {}) => runOutcomePipeline(s.sessions, s.market, s.ctx, { ...s.deps, ...deps });

/** Independent expectation: the shared engine applied directly to the raw synthetic bars. */
function expected(w: World, symbol: string, t: string, sessions: string[], sigma: number | null, up: boolean) {
  const bars = w.stocks[symbol].bars;
  const day = bars.find((b) => b.date === t)!;
  const win = sessions.map((d) => bars.find((b) => b.date === d) ?? null);
  if (sigma === null) return { status: "unavailable", reason: "insufficient-history" };
  const sigmaChanges = od1SigmaWindow(comparableUpTo(bars, t));
  if (win.some((b) => !b)) return { status: "unavailable", reason: "no-bar" };
  const bT = w.benchmark.find((b) => b.date === t)!.close;
  const bH = w.benchmark.find((b) => b.date === sessions[sessions.length - 1])!.close;
  return { status: "complete", ...od1Measure({ up, day, window: win as DailyBar[], benchT: bT, benchTh: bH, sigma, sigmaChanges }) };
}

// ---------------------------------------------------------------------------------------------------------------------
describe("B2a runner: horizons, maturity, eligibility, frozen volatility", () => {
  it("plans every stored horizon; only h1 and h5 are headline; excluded, non-live and pre-activation sessions are rejected", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const at = (d: string) => plan.filter((p) => p.sessionDate === d);
    expect(at(T1).map((p) => [p.horizon, p.headline, p.status])).toEqual([
      [1, true, "due"],
      [2, false, "due"],
      [5, true, "due"],
      [10, false, "due"],
    ]);
    expect(at(T0).every((p) => p.status === "before-activation")).toBe(true);
    expect(at(TX).every((p) => p.status === "excluded")).toBe(true);
    expect(at(TL).every((p) => p.status === "not-live")).toBe(true);
    expect(at(T2).map((p) => p.status)).toEqual(["due", "due", "due", "pending"]);
    expect(() => planOutcomes(s.sessions, s.market, { ...s.ctx, activation: null, stored: new Set() })).toThrow("activation");
  });

  it("uses the NSE (NIFTY 500) trading calendar: the holiday is skipped only because it is resolved as non-trading", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const h5 = plan.find((p) => p.sessionDate === T1 && p.horizon === 5)!;
    expect(h5.sessions).toEqual(TRADING.slice(idx(T1) + 1, idx(T1) + 6));
    expect(h5.sessions).not.toContain(HOLIDAY);
    expect(CAL.slice(CAL.indexOf(T1) + 1, CAL.indexOf(T1) + 6)).toContain(HOLIDAY); // calendar-day arithmetic would differ
  });

  it("never skips an unresolved session and keeps horizons pending when an archive is missing or not ok", async () => {
    for (const mutate of [
      (w: World) => (w.refreshState.archives.stocks[HOLIDAY] = { status: "failed", checkedAt: "x" }), // holiday unresolved
      (w: World) => delete w.refreshState.archives.index[TRADING[idx(T1) + 1]], // missing archive on t+1
      (w: World) => (w.refreshState.archives.stocks[TRADING[idx(T1) + 1]] = { status: "failed", checkedAt: "x" }),
    ]) {
      const w = makeWorld();
      mutate(w);
      const s = await setup(w);
      const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
      const t1 = plan.filter((p) => p.sessionDate === T1);
      expect(t1.find((p) => p.horizon === 10)!.status).toBe("pending");
      expect(t1.find((p) => p.horizon === 5)!.status).toBe("pending");
      const report = await run(s);
      expect(report.recordsCreated.filter((k) => k.includes(T1) && /h(5|10)$/.test(k))).toEqual([]);
    }
  });

  it("produces deterministic records that match the shared engine applied independently, with frozen sigma", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    for (const item of plan.filter((p) => p.sessionDate === T1)) {
      const fixed = { ...s.ctx, stored: new Set<string>(), newSalt: () => "ab".repeat(16) + "0123456789abcdef".repeat(2) };
      const r = buildDueRecord(item, t1, s.market, fixed);
      expect(sha256Canonical(buildDueRecord(item, t1, s.market, fixed))).toBe(sha256Canonical(r));
      expect(r.outcomes).toHaveLength(t1.daily.predictions.length);
      for (const e of r.outcomes) {
        const pr = t1.daily.predictions.find((p) => p.symbol === e.symbol)!;
        expect(e.frozen.sigma).toBe(pr.price.volatility20);
        if (e.symbol === "BRK" && item.horizon > 1) {
          expect(e.outcome).toEqual({ status: "unavailable", reason: "discontinuity" });
          continue;
        }
        expect(sha256Canonical(e.outcome)).toBe(sha256Canonical({ ...expected(s.w, e.symbol, T1, item.sessions!, pr.price.volatility20, e.group === "gainer"), ...(e.outcome.status === "complete" ? { endDate: item.sessions!.at(-1) } : {}) }));
      }
    }
  });

  it("classifies corporate actions, missing bars and short history as unavailable with the sealed reasons", async () => {
    const s = await setup();
    await run(s);
    const h1 = (await s.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    const h2 = (await s.store.getRecord(`od1/${RV}/${T1}/h2`))!;
    const of = (r: OutcomeRecord, sym: string) => r.outcomes.find((e) => e.symbol === sym)!.outcome;
    expect(of(h1, "BRK").status).toBe("complete");
    expect(of(h2, "BRK")).toEqual({ status: "unavailable", reason: "discontinuity" });
    expect(of(h1, "GAP")).toEqual({ status: "unavailable", reason: "no-bar" });
    expect(of(h1, "NEW")).toEqual({ status: "unavailable", reason: "insufficient-history" });
  });

  it("applies the OD1 threshold at its boundary (eps = the 0.20% floor): +0.20% is P, +0.19% is not", async () => {
    const s = await setup();
    await run(s);
    const h1 = (await s.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    const eps = h1.outcomes.find((e) => e.symbol === "EPS")!;
    const epz = h1.outcomes.find((e) => e.symbol === "EPZ")!;
    expect(eps.frozen.sigma! * 0.5).toBeLessThan(0.2);
    expect(od1Epsilon(eps.frozen.sigma!, 1)).toBe(0.2);
    if (eps.outcome.status !== "complete" || epz.outcome.status !== "complete") throw new Error("expected complete outcomes");
    expect(eps.outcome.R).toBeGreaterThanOrEqual(0.2);
    expect(eps.outcome.P).toBe(true);
    expect(epz.outcome.R).toBeLessThan(0.2);
    expect(epz.outcome.P).toBe(false);
    expect(epz.outcome.D).toBe(false);
  });

  it("uses the FROZEN volatility20: a data revision in the sigma window or of the day-t bar blocks the horizon (never recomputed)", async () => {
    const w = makeWorld();
    const s = await setup(w);
    const ix = s.market.stocks.AAA!.bars.findIndex((b) => b.date === T1);
    s.market.stocks.AAA!.bars[ix - 5] = { ...s.market.stocks.AAA!.bars[ix - 5], close: s.market.stocks.AAA!.bars[ix - 5].close * 1.01 };
    const r1 = await run(s);
    expect(r1.alerts.filter((a) => a.key.includes(T1))).toEqual([1, 2, 5, 10].map((h) => ({ code: "blocked-source-revised", key: `od1/${RV}/${T1}/h${h}` })));
    expect(await s.store.getRecord(`od1/${RV}/${T1}/h1`)).toBeNull();
    const s2 = await setup();
    s2.market.stocks.BBB!.bars[s2.market.stocks.BBB!.bars.findIndex((b) => b.date === T1)].close *= 1.001;
    expect((await run(s2)).alerts.some((a) => a.code === "blocked-source-revised" && a.key.includes(T1))).toBe(true);
  });

  it("is synthetic-only in B2a: real dates and the repository's real data are refused before anything is read", async () => {
    expect(() => assertSyntheticSession("2026-11-19")).toThrow("synthetic-only");
    expect(() => assertSyntheticSession(SYNTHETIC_FROM)).not.toThrow();
    await expect(loadRunnerMarket(path.resolve("public/data"), { repoRoot: process.cwd(), commit: "c".repeat(40) })).rejects.toThrow("synthetic-only");
    await expect(loadRunnerSessions(path.resolve("public/data/ledger"), RV)).rejects.toThrow("synthetic-only");
  });

  it("refuses to run outside the private outcome repository context", () => {
    expect(() => assertProtectedExecutionContext({})).toThrow("OD1_PROTECTED_CONTEXT");
    expect(() => assertProtectedExecutionContext({ ...ENV, GITHUB_REPOSITORY: "SanoRamV/Sector-Dashboard" })).toThrow("public repository");
    expect(() => assertProtectedExecutionContext({ ...ENV, GITHUB_REPOSITORY: "" })).toThrow("GITHUB_REPOSITORY");
    expect(() => assertProtectedExecutionContext(ENV)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("B2a private store: create-only, append-only corrections, path safety, recovery", () => {
  it("create-only: an identical retry (new salt) is existing and returns the STORED record; different outcomes conflict; nothing is overwritten", async () => {
    const s = await setup();
    await run(s);
    const key = `od1/${RV}/${T1}/h1`;
    const file = path.join(s.storeRoot, `${key}.json`);
    const before = await readFile(file, "utf-8");
    const stored = (await s.store.getRecord(key))!;
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const item = plan.find((p) => p.key === key)!;
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const again = buildDueRecord(item, t1, s.market, { ...s.ctx, stored: new Set() });
    expect(again.header.commitmentSalt).not.toBe(stored.header.commitmentSalt);
    const r = await s.store.putRecord(again);
    expect(r.result).toBe("existing");
    expect(r.stored!.header.commitmentSalt).toBe(stored.header.commitmentSalt);
    const m2 = { ...s.market, indexSeries: { nifty500: { bars: s.market.indexSeries.nifty500!.bars.map((b) => (b.date === item.sessions![0] ? { ...b, close: b.close * 1.05 } : b)) } } };
    const different = buildDueRecord(item, t1, m2, { ...s.ctx, stored: new Set() });
    expect(different.header.outcomesSha256).not.toBe(stored.header.outcomesSha256);
    expect((await s.store.putRecord(different)).result).toBe("conflict");
    expect(await readFile(file, "utf-8")).toBe(before);
  });

  it("refuses invalid, tampered or low-entropy-salt records", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const rec = buildDueRecord(plan.find((p) => p.sessionDate === T1)!, t1, s.market, { ...s.ctx, stored: new Set(), newSalt: () => "5".repeat(64) });
    await expect(s.store.putRecord(rec)).rejects.toThrow("entropy");
    const ok = buildDueRecord(plan.find((p) => p.sessionDate === T1)!, t1, s.market, { ...s.ctx, stored: new Set() });
    const tampered = JSON.parse(JSON.stringify(ok));
    const e = tampered.outcomes.find((x: any) => x.outcome.status === "complete");
    e.outcome.cls = e.outcome.cls === "sideways" ? "confirmed" : "sideways";
    tampered.header.outcomesSha256 = sha256Canonical(tampered.outcomes);
    await expect(s.store.putRecord(tampered)).rejects.toThrow("re-derive");
    expect(() => assertSalt("0".repeat(64))).toThrow();
    expect(() => assertSalt(newSalt())).not.toThrow();
  });

  it("validates keys and paths: traversal, absolute paths and symbolic links are refused", async () => {
    for (const bad of ["../x", "od1/../../etc", "/etc/passwd", "a//b", "a\\b", "a/./b", ""]) expect(() => relativeSegments(bad)).toThrow(UnsafePathError);
    for (const bad of [`od1/${RV}/2031-02-30/h1`, `od1/${RV}/${T1}/h3`, `od1/../${T1}/h1`, `od1/${RV}/${T1}/h1/../h2`]) expect(() => parseStorageKey(bad)).toThrow();
    const s = await setup();
    await expect(s.store.getRecord(`od1/${RV}/${T1}/h1/../../x`)).rejects.toThrow();
    // a symbolic link planted inside the store is refused (on open and on use)
    const root = await tmp("linked");
    const outside = await tmp("outside");
    await mkdir(path.join(root, "od1"), { recursive: true });
    await symlink(outside, path.join(root, "od1", RV));
    await expect(FsPrivateStore.open(root, { repoRoot: process.cwd(), definitionsSha256: DEFS })).rejects.toThrow("symbolic link");
    // a symbolic-link ROOT is refused
    const linkRoot = path.join(await tmp("lr"), "root");
    await symlink(outside, linkRoot);
    await expect(FsPrivateStore.open(linkRoot, { repoRoot: process.cwd(), definitionsSha256: DEFS })).rejects.toThrow("symbolic link");
    // a link created after opening is refused at use
    const s2 = await setup();
    await mkdir(path.join(s2.storeRoot, "od1"), { recursive: true });
    await symlink(outside, path.join(s2.storeRoot, "od1", RV));
    const r = await run(s2);
    expect(r.alerts[0]).toEqual({ code: "private-storage-unavailable", key: "*" });
    expect(await readFile(path.join(outside, "x"), "utf-8").catch(() => null)).toBeNull();
  });

  it("protected storage can never be inside the repository or under public/", async () => {
    await expect(FsPrivateStore.open(path.resolve("."), { repoRoot: process.cwd(), definitionsSha256: DEFS })).rejects.toThrow("inside the repository");
    const pub = path.join(await tmp("p"), "public");
    await mkdir(pub);
    await expect(FsPrivateStore.open(pub, { repoRoot: process.cwd(), definitionsSha256: DEFS })).rejects.toThrow("public/");
  });

  it("recovers from interrupted writes: leftover partial files are removed on open; published files are complete or absent", async () => {
    const s = await setup();
    await run(s);
    const dir = path.join(s.storeRoot, "od1", RV, T2);
    await writeFile(path.join(dir, "h10.json.123-deadbeef.partial"), '{"half":');
    const reopened = await FsPrivateStore.open(s.storeRoot, { repoRoot: process.cwd(), definitionsSha256: DEFS });
    expect(reopened.recovered.map((f) => path.basename(f))).toEqual(["h10.json.123-deadbeef.partial"]);
    expect(await reopened.listKeys()).toEqual(await s.store.listKeys());
    // an unexpected or corrupt file is never silently accepted or replaced
    await writeFile(path.join(dir, "notes.txt"), "x");
    await expect(reopened.listKeys()).rejects.toThrow("unexpected file");
  });

  it("corrections are append-only, chained by commitment, owner-initiated, and never replace the authoritative original", async () => {
    const s = await setup();
    await run(s);
    const key = `od1/${RV}/${T1}/h1`;
    const original = (await s.store.getRecord(key))!;
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const item = plan.find((p) => p.key === key)!;
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const revised = (f: number) => buildDueRecord(item, t1, { ...s.market, indexSeries: { nifty500: { bars: s.market.indexSeries.nifty500!.bars.map((b) => (b.date === item.sessions![0] ? { ...b, close: b.close * f } : b)) } } }, { ...s.ctx, stored: new Set() });
    const rep1 = revised(1.01);
    const c = (n: number, sup: string, rep: OutcomeRecord): OutcomeCorrection => ({ kind: OUTCOME_CORRECTION_KIND, schemaVersion: 1, sessionDate: T1, ruleVersion: RV, horizon: 1, sequence: n, supersedes: sup, replacement: commitmentOf(rep.header.commitmentSalt, rep.header.outcomesSha256), reasonCode: "source-revised", reason: "NSE revised the benchmark close for the first window session", recordedAt: "2031-04-20T10:00:00Z", recordedBy: "owner", analyticalTreatment: "pending-owner-decision" });
    const origC = commitmentOf(original.header.commitmentSalt, original.header.outcomesSha256);
    const c1 = c(1, origC, rep1);
    expect(await s.store.appendCorrection(key, { correction: c1, replacement: rep1 })).toBe("created");
    expect(await s.store.appendCorrection(key, { correction: c1, replacement: rep1 })).toBe("existing");
    const rep2 = revised(1.02);
    await expect(s.store.appendCorrection(key, { correction: c(2, origC, rep2), replacement: rep2 })).rejects.toThrow("fork or a silent replacement");
    await expect(s.store.appendCorrection(key, { correction: c(3, c1.replacement, rep2), replacement: rep2 })).rejects.toThrow("sequence");
    await expect(s.store.appendCorrection(key, { correction: { ...c(2, c1.replacement, rep2), analyticalTreatment: "use-corrected" as any }, replacement: rep2 })).rejects.toThrow("pending-owner-decision");
    await expect(s.store.appendCorrection(key, { correction: c(2, c1.replacement, original), replacement: original })).rejects.toThrow();
    expect(await s.store.appendCorrection(key, { correction: c(2, c1.replacement, rep2), replacement: rep2 })).toBe("created");
    expect(sha256Canonical(await s.store.getRecord(key))).toBe(sha256Canonical(original)); // original stays authoritative
    expect((await s.store.getCorrections(key)).map((x) => x.correction.sequence)).toEqual([1, 2]);
    // interrupted append: orphan replacement with DIFFERENT content blocks a different retry (owner review)
    const rep3 = revised(1.03);
    await writeFile(path.join(s.storeRoot, `${key}.replacement-3.json`), storedText(revised(1.04)));
    await expect(s.store.appendCorrection(key, { correction: c(3, c(2, c1.replacement, rep2).replacement, rep3), replacement: rep3 })).rejects.toThrow("orphan replacement");
    // public correction receipts carry the chain and reason CODE only, and the guard checks the chain
    await s.sink.put(correctionReceiptRel(RV, T1, 1, 1), receiptText(correctionReceiptOf(c1)));
    expect(receiptText(correctionReceiptOf(c1))).not.toContain(c1.reason);
    expect(await validateOutcomeReceiptTree(s.ledger, { definitionsSha256: DEFS })).toEqual([]);
    await s.sink.put(correctionReceiptRel(RV, T1, 1, 3), receiptText(correctionReceiptOf(c(3, origC, rep3))));
    expect((await validateOutcomeReceiptTree(s.ledger, { definitionsSha256: DEFS })).map((v) => v.detail).join(" ")).toMatch(/without gaps|fork/);
    // the pipeline never creates corrections
    expect(await readFile("scripts/ledger/outcome-pipeline.mts", "utf-8")).not.toMatch(/appendCorrection\(/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("B2a public receipts: confidentiality", () => {
  it("a receipt holds only whitelisted identifiers, hashes and the salted commitment", async () => {
    const s = await setup();
    await run(s);
    for (const rel of await s.sink.list()) {
      const rc: any = await s.sink.get(rel);
      const rec = (await s.store.getRecord(`od1/${rc.ruleVersion}/${rc.sessionDate}/h${rc.horizon}`))!;
      expect(receiptLeakProblems(rc, rec)).toEqual([]);
      expect(verifyReceiptAgainstRecord(rc, rec)).toEqual([]);
      expect(Object.keys(rc).sort()).toEqual(["commitment", "createdAt", "endDate", "engine", "horizon", "kind", "protocol", "ruleVersion", "schemaVersion", "sessionDate", "source", "storage"]);
      const text = JSON.stringify(rc);
      for (const c of OD1_CLASSES) expect(text).not.toMatch(new RegExp(`\\b${c}\\b`));
      expect(text).not.toContain(rec.header.commitmentSalt);
      expect(text).not.toContain(rec.header.outcomesSha256);
    }
    // the leak check catches each forbidden item
    const rec = (await s.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    const rc = receiptForStoredRecord(rec);
    expect(receiptLeakProblems({ ...rc, note: rec.header.commitmentSalt }, rec).join()).toContain("salt");
    expect(receiptLeakProblems({ ...rc, h: rec.header.outcomesSha256 }, rec).join()).toContain("unsalted");
    expect(receiptLeakProblems({ ...rc, x: "failed" }, rec).join()).toContain("class");
    expect(receiptLeakProblems({ ...rc, confirmedShare: 0.42 }, rec).join()).toContain("number");
  });

  it("cannot be used to infer classes: receipts of different outcomes differ only in a high-entropy commitment that guessed salts cannot open", async () => {
    const a = await setup();
    const wB = makeWorld();
    for (const sym of Object.keys(wB.stocks)) wB.stocks[sym].bars = wB.stocks[sym].bars.map((b) => (b.date > T1 ? { ...b, close: b.close * 0.9, open: b.open * 0.9, high: b.high * 0.9, low: b.low * 0.9 } : b));
    const b = await setup(wB);
    await run(a);
    await run(b);
    const rel = outcomeReceiptRel(RV, T1, 1);
    const ra: any = await a.sink.get(rel);
    const rb: any = await b.sink.get(rel);
    const recA = (await a.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    const recB = (await b.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    expect(recA.header.outcomesSha256).not.toBe(recB.header.outcomesSha256);
    expect(recA.outcomes.map((e: any) => e.outcome.cls)).not.toEqual(recB.outcomes.map((e: any) => e.outcome.cls));
    const strip = (r: any) => ({ ...r, commitment: { ...r.commitment, value: "x" } });
    expect(strip(ra)).toEqual(strip(rb)); // identical apart from the commitment
    // an attacker who recomputes the TRUE outcomes (public data) still cannot confirm them without the 256-bit salt
    const truth = recA.header.outcomesSha256;
    expect(ra.commitment.value).not.toBe(truth);
    expect(ra.commitment.value).not.toBe(sha256Hex(truth));
    const guesses = ["", "0".repeat(64), "f".repeat(64), T1, RV, ra.createdAt, ra.source.predictionsSha256, ra.source.dailyFileSha256, ...Array.from({ length: 2000 }, (_, i) => createHash("sha256").update(String(i)).digest("hex"))];
    for (const g of guesses) expect(commitmentOf(g, truth)).not.toBe(ra.commitment.value);
    // the alternative world's outcomes do not match either
    for (const g of guesses.slice(0, 50)) expect(commitmentOf(g, recB.header.outcomesSha256)).not.toBe(ra.commitment.value);
    // salts are distinct per record
    const salts = new Set((await Promise.all((await a.store.listKeys()).map((k) => a.store.getRecord(k)))).map((r) => r!.header.commitmentSalt));
    expect(salts.size).toBe((await a.store.listKeys()).length);
  });

  it("the run report and alert issues carry no outcome information", async () => {
    const s = await setup();
    const report = await run(s);
    const text = JSON.stringify(report);
    for (const c of OD1_CLASSES) expect(text).not.toMatch(new RegExp(`\\b${c}\\b`));
    expect(text).not.toMatch(/unavailable|complete|discontinuity|no-bar|insufficient|"R"|cls/);
    const issue = alertIssueText((Object.keys(ALERT_TEXT) as Array<keyof typeof ALERT_TEXT>).map((code) => ({ code, key: `od1/${RV}/${T1}/h1` })));
    for (const c of OD1_CLASSES) expect(issue).not.toMatch(new RegExp(`\\b${c}\\b`, "i"));
    expect(issue).not.toMatch(/\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
/** Store/sink wrappers that simulate network failures. */
function flakyStore(inner: PrivateStore, mode: { listFails?: boolean; putFailsBefore?: boolean; putFailsAfter?: boolean }): PrivateStore {
  return {
    getRecord: (k) => inner.getRecord(k),
    listKeys: async () => {
      if (mode.listFails) throw new Error("ECONNRESET");
      return inner.listKeys();
    },
    putRecord: async (r) => {
      if (mode.putFailsBefore) throw new Error("ETIMEDOUT before write");
      const res = await inner.putRecord(r);
      if (mode.putFailsAfter) throw new Error("ECONNRESET after write");
      return res;
    },
    getCorrections: (k) => inner.getCorrections(k),
    appendCorrection: (k, c) => inner.appendCorrection(k, c),
  };
}
function flakySink(inner: PublicReceiptSink, fails: { put?: boolean; putAfterWrite?: boolean }): PublicReceiptSink {
  return {
    get: (r) => inner.get(r),
    list: () => inner.list(),
    put: async (rel, c) => {
      if (fails.put) throw new Error("public push rejected");
      const res = await inner.put(rel, c);
      if (fails.putAfterWrite) throw new Error("push acknowledged late");
      return res;
    },
  };
}

describe("B2a cross-repository consistency (local simulation)", () => {
  const T1KEYS = [1, 2, 5, 10].map((h) => `od1/${RV}/${T1}/h${h}`);
  const ALL = [...T1KEYS, ...[1, 2, 5].map((h) => `od1/${RV}/${T2}/h${h}`)];

  it("(2) normal run: every due record is stored and then receipted; receipts validate in the public tree", async () => {
    const s = await setup();
    const r = await run(s);
    expect(r.ok).toBe(true);
    expect(r.recordsCreated.sort()).toEqual([...ALL].sort());
    expect(r.receiptsPublished.sort()).toEqual([...ALL].sort());
    expect(r.plan).toEqual({ "before-activation": 4, due: 7, excluded: 4, "not-live": 4, pending: 1 });
    expect(await validateOutcomeReceiptTree(s.ledger, { definitionsSha256: DEFS, eligible: s.ctx.eligibleSessions })).toEqual([]);
    expect(await scanForOutcomeLeaks([s.ledger])).toEqual([]);
  });

  it("(1)(9)(10) receipt publishing fails: the record stays private, the next run publishes the receipt from the STORED record", async () => {
    const s = await setup();
    const r1 = await run(s, { sink: flakySink(s.sink, { put: true }) });
    expect(r1.ok).toBe(false);
    expect(r1.alerts.every((a) => a.code === "receipt-publish-error")).toBe(true);
    expect(await s.sink.list()).toEqual([]);
    expect((await s.store.listKeys()).sort()).toEqual([...ALL].sort());
    const r2 = await run(s);
    expect(r2.ok).toBe(true);
    expect(r2.recovered.sort()).toEqual([...ALL].sort());
    expect(r2.recordsCreated).toEqual([]);
    for (const k of ALL) {
      const rec = (await s.store.getRecord(k))!;
      expect(verifyReceiptAgainstRecord((await s.sink.get(outcomeReceiptRel(RV, rec.header.sessionDate, rec.header.horizon))) as any, rec)).toEqual([]);
    }
  });

  it("(9b) a receipt push whose acknowledgement is lost is retried idempotently (byte-identical receipt = existing)", async () => {
    const s = await setup();
    await run(s, { sink: flakySink(s.sink, { putAfterWrite: true }) });
    const r2 = await run(s);
    expect(r2.ok).toBe(true);
    expect(r2.receiptsPublished).toEqual([]);
  });

  it("(3) a public receipt without its private record is reported and never repaired", async () => {
    const s = await setup();
    await run(s);
    const emptyRoot = await tmp("empty-private");
    const empty = await FsPrivateStore.open(emptyRoot, { repoRoot: process.cwd(), definitionsSha256: DEFS });
    const before = await s.sink.list();
    const r = await run(s, { store: empty });
    expect(r.ok).toBe(false);
    expect(r.alerts.filter((a) => a.code === "missing-private-evidence").map((a) => a.key).sort()).toEqual([...ALL].sort());
    expect(await s.sink.list()).toEqual(before);
    expect(r.receiptsPublished).toEqual([]); // nothing re-published over existing receipts
    expect(await empty.listKeys()).toEqual([]); // and nothing new computed until the owner has reviewed the conflict
  });

  it("(4) conflicting private content and a receipt that does not commit to the record are reported, not repaired", async () => {
    const s = await setup();
    await run(s);
    const rel = outcomeReceiptRel(RV, T1, 1);
    const file = path.join(s.ledger, rel);
    const tampered = { ...((await s.sink.get(rel)) as any), commitment: { scheme: "sha256(canonical({ salt, outcomesSha256 }))", value: "e".repeat(64) } };
    await rm(file);
    await writeFile(file, receiptText(tampered));
    const r = await run(s);
    expect(r.alerts).toEqual([{ code: "receipt-mismatch", key: `od1/${RV}/${T1}/h1` }]);
    expect(JSON.parse(await readFile(file, "utf-8")).commitment.value).toBe("e".repeat(64));
    // a different outcome for an already stored key -> record-conflict on a fresh store holding different content
    const w = makeWorld();
    const s2 = await setup(w);
    await run(s2);
    const s3 = await setup(w);
    s3.market.indexSeries.nifty500!.bars = s3.market.indexSeries.nifty500!.bars.map((b) => (b.date === TRADING[idx(T1) + 1] ? { ...b, close: b.close * 1.05 } : b));
    const r3 = await run(s3, { store: s2.store, sink: s3.sink });
    expect(r3.alerts.some((a) => a.code === "missing-private-evidence")).toBe(false);
    // keys already stored are not re-planned; force a re-build against the stored key to show the conflict path
    const item = planOutcomes(s3.sessions, s3.market, { ...s3.ctx, stored: new Set() }).find((p) => p.key === `od1/${RV}/${T1}/h1`)!;
    const diff = buildDueRecord(item, s3.sessions.find((x) => x.daily.header.sessionDate === T1)!, s3.market, { ...s3.ctx, stored: new Set() });
    expect((await s2.store.putRecord(diff)).result).toBe("conflict");
  });

  it("(5) network failure before private publication: nothing is computed into storage and nothing public is written", async () => {
    const s = await setup();
    const r = await run(s, { store: flakyStore(s.store, { listFails: true }) });
    expect(r.alerts).toEqual([{ code: "private-storage-unavailable", key: "*" }]);
    expect(r.plan).toEqual({});
    const r2 = await run(s, { store: flakyStore(s.store, { putFailsBefore: true }) });
    expect(r2.alerts).toHaveLength(1);
    expect(r2.alerts[0].code).toBe("private-storage-unavailable");
    expect(await s.store.listKeys()).toEqual([]);
    expect(await s.sink.list()).toEqual([]);
  });

  it("(6)(10) network failure after private publication: no receipt in that run; the retry recovers without duplicates", async () => {
    const s = await setup();
    const r1 = await run(s, { store: flakyStore(s.store, { putFailsAfter: true }) });
    expect(r1.alerts[0].code).toBe("private-storage-unavailable");
    expect(await s.sink.list()).toEqual([]);
    expect(await s.store.listKeys()).toHaveLength(1);
    const r2 = await run(s);
    expect(r2.ok).toBe(true);
    expect(r2.recovered).toHaveLength(1);
    expect((await s.store.listKeys()).sort()).toEqual([...ALL].sort());
    expect((await s.sink.list()).length).toBe(ALL.length);
  });

  it("(7) a duplicate invocation changes nothing", async () => {
    const s = await setup();
    await run(s);
    const snapshot = async () => Promise.all([...(await s.sink.list()).map((r) => readFile(path.join(s.ledger, r), "utf-8")), ...(await s.store.listKeys()).map((k) => readFile(path.join(s.storeRoot, `${k}.json`), "utf-8"))]);
    const before = await snapshot();
    const r = await run(s);
    expect(r.ok).toBe(true);
    expect([...r.recordsCreated, ...r.receiptsPublished, ...r.recovered]).toEqual([]);
    expect(r.plan.stored).toBe(ALL.length);
    expect(await snapshot()).toEqual(before);
  });

  it("(8) concurrent invocations converge on one record (one salt) and one byte-identical receipt per key", async () => {
    const s = await setup();
    const store2 = await FsPrivateStore.open(s.storeRoot, { repoRoot: process.cwd(), definitionsSha256: DEFS });
    const [a, b] = await Promise.all([run(s), run(s, { store: store2, sink: new FsPublicReceiptSink(s.ledger) })]);
    expect(a.alerts).toEqual([]);
    expect(b.alerts).toEqual([]);
    expect([...a.recordsCreated, ...b.recordsCreated].sort()).toEqual([...ALL].sort());
    expect((await s.store.listKeys()).sort()).toEqual([...ALL].sort());
    for (const k of ALL) {
      const rec = (await s.store.getRecord(k))!;
      expect(verifyReceiptAgainstRecord((await s.sink.get(outcomeReceiptRel(RV, rec.header.sessionDate, rec.header.horizon))) as any, rec)).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("B2a governance: public tree, sealed holdout, no leakage, workflows untouched", () => {
  it("the guard rejects receipts for excluded sessions, malformed or unbound receipts, and any protected data in public paths", async () => {
    const s = await setup();
    await run(s);
    expect(await checkOutcomeConfidentiality(s.ledger)).toEqual([]);
    expect((await checkOutcomeConfidentiality(s.ledger, new Set([T2]))).some((v) => /not eligible/.test(v.detail))).toBe(true);
    // a private record copied into the public tree is a leak
    const rec = (await s.store.getRecord(`od1/${RV}/${T1}/h1`))!;
    await mkdir(path.join(s.ledger, "live", "misc"), { recursive: true });
    await writeFile(path.join(s.ledger, "live", "misc", "x.json"), JSON.stringify(rec));
    expect((await checkOutcomeConfidentiality(s.ledger)).some((v) => /protected outcome data/.test(v.detail))).toBe(true);
    // unexpected file and unbound receipt
    await writeFile(path.join(s.ledger, "live", "outcome-receipts", RV, T1, "h1.extra.json"), "{}");
    const rel = outcomeReceiptRel(RV, T2, 1);
    const rc = { ...((await s.sink.get(rel)) as any), source: { ...((await s.sink.get(rel)) as any).source, predictionCount: 999 } };
    await rm(path.join(s.ledger, rel));
    await writeFile(path.join(s.ledger, rel), receiptText(rc));
    const details = (await validateOutcomeReceiptTree(s.ledger, { definitionsSha256: DEFS })).map((v) => v.detail).join(" | ");
    expect(details).toContain("unexpected file");
    expect(details).toContain("not bound");
    // the public sink refuses to write anywhere but live/outcome-receipts
    await expect(s.sink.put("live/predictions/x.json", "{}")).rejects.toThrow("outcome-receipts");
    await expect(s.sink.put("live/outcome-receipts/../receipts/x.json", "{}")).rejects.toThrow();
  });

  it("the real repository holds no outcome data, the holdout stays sealed, and existing governance is unchanged", async () => {
    expect(await checkOutcomeConfidentiality("public/data/ledger")).toEqual([]);
    const h = JSON.parse(await readFile("public/data/ledger/holdout.json", "utf-8"));
    expect(h).toMatchObject({ status: "sealed", unblinded: null, gate: { minCompletedLiveSessions: 250 } });
    expect(() => requireUnblinded(h)).toThrow("sealed");
    expect(execFileSync("git", ["status", "--porcelain", "--", "public", ".github", "src"]).toString()).toBe("");
    expect(execFileSync("git", ["ls-files", "public/data/ledger/live/outcome-receipts"]).toString()).toBe("");
  });

  it("no workflow runs the outcome pipeline; the engine version covers the runner", async () => {
    for (const f of execFileSync("git", ["ls-files", ".github/workflows"]).toString().split("\n").filter(Boolean)) expect(await readFile(f, "utf-8")).not.toMatch(/outcome-(pipeline|runner|inputs)|private-store|OD1_PROTECTED_CONTEXT/);
    expect(ENGINE_FILES).toContain("scripts/ledger/outcome-runner.mts");
    expect(ENGINE_FILES).toContain("src/lib/calculations/validation.ts");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// B2a security hardening (F1, F2, F3). Every "real" date below is only used to prove that it is REFUSED.
// ---------------------------------------------------------------------------------------------------------------------
const REAL = "2026-11-19"; // a real live session: nothing may be built, stored or published for it
const PRE = "2030-12-31"; // the last pre-synthetic day

async function validRecord() {
  const s = await setup();
  await run(s);
  return { s, rec: (await s.store.getRecord(`od1/${RV}/${T1}/h1`))! };
}
const redate = (rec: OutcomeRecord, d: string): OutcomeRecord => {
  const c = structuredClone(rec);
  c.header.sessionDate = d;
  return c;
};
async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) out.push(path.join(e.parentPath, e.name));
  return out;
}

describe("B2a hardening F1: every artifact builder, store and publisher refuses real dates", () => {
  it("the lock is on and lives in the engine file outcomes.mts", async () => {
    expect(SYNTHETIC_ONLY).toBe(true);
    expect(await readFile("scripts/ledger/outcomes.mts", "utf-8")).toContain("export const SYNTHETIC_ONLY = true;");
    for (const d of [REAL, PRE, "2026-11-23", "not-a-date", "2031-02-30", ""]) expect(() => assertSyntheticSession(d)).toThrow("synthetic-only");
    expect(() => assertSyntheticSession(undefined)).toThrow("synthetic-only");
  });

  it("direct lower-level calls with real or pre-2031 dates produce no record, receipt or correction", async () => {
    const { s, rec } = await validRecord();
    const session = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    for (const d of [REAL, PRE]) {
      // record builders (B1 engine and B2a runner), with otherwise valid inputs
      const daily = structuredClone(session.daily);
      daily.header.sessionDate = d;
      expect(() => buildOutcomeRecord({ daily, sessions: [T1] } as any)).toThrow("synthetic-only");
      expect(() => buildOutcomeRecord({ daily: session.daily, sessions: [d] } as any)).toThrow("synthetic-only");
      const item = { key: `od1/${RV}/${d}/h1`, sessionDate: d, horizon: 1, headline: true, status: "due" as const, reason: "forged", sessions: rec.header.sessions };
      expect(() => buildDueRecord(item, { ...session, daily }, s.market, { ...s.ctx, stored: new Set() })).toThrow("synthetic-only");
      expect(() => buildDueRecord(item, session, s.market, { ...s.ctx, stored: new Set() })).toThrow("synthetic-only");
      expect(() => evidenceFor(s.market, [], item.key, d, rec.header.sessions, session.daily.predictions[0])).toThrow("synthetic-only");
      // receipts
      expect(() => buildOutcomeReceipt(redate(rec, d), rec.header.generatedAt)).toThrow("synthetic-only");
      expect(() => receiptForStoredRecord(redate(rec, d))).toThrow("synthetic-only");
      expect(() => correctionReceiptOf({ sessionDate: d } as OutcomeCorrection)).toThrow("synthetic-only");
      // private store (fresh, empty)
      const root = await tmp("private-f1");
      const store = await FsPrivateStore.open(root, { repoRoot: process.cwd(), definitionsSha256: DEFS });
      await expect(store.putRecord(redate(rec, d))).rejects.toThrow("synthetic-only");
      await expect(store.appendCorrection(`od1/${RV}/${d}/h1`, { correction: { sessionDate: d } as OutcomeCorrection, replacement: redate(rec, d) })).rejects.toThrow("synthetic-only");
      await expect(s.store.appendCorrection(`od1/${RV}/${T1}/h1`, { correction: { sessionDate: d } as OutcomeCorrection, replacement: rec })).rejects.toThrow("synthetic-only");
      expect(await filesUnder(root)).toEqual([]);
      // public sink: by path, and content for a different session than the path
      const good = receiptText(receiptForStoredRecord(rec));
      await expect(s.sink.put(outcomeReceiptRel(RV, d, 1), good.replace(new RegExp(T1, "g"), d))).rejects.toThrow("synthetic-only");
      await expect(s.sink.put(correctionReceiptRel(RV, d, 1, 1), "{}")).rejects.toThrow("synthetic-only");
    }
    await expect(s.sink.put(outcomeReceiptRel(RV, T2, 2), good2(rec))).rejects.toThrow("different session");
    await expect(s.sink.put(`live/outcome-receipts/${RV}/${T1}/notes.json`, "{}")).rejects.toThrow("not a receipt path");
    // nothing dated before 2031 exists anywhere in the synthetic stores
    for (const f of [...(await filesUnder(s.storeRoot)), ...(await filesUnder(path.join(s.ledger, "live", "outcome-receipts")))]) expect(f).not.toMatch(/20(2\d|30)-\d\d-\d\d/);
  });

  it("the full pipeline with a perfectly spoofed private context still refuses real sessions", async () => {
    const s = await setup();
    const real = s.sessions.map((x) => ({ ...x, daily: { ...x.daily, header: { ...x.daily.header, sessionDate: REAL } } }));
    await expect(runOutcomePipeline(real, s.market, s.ctx, s.deps)).rejects.toThrow("synthetic-only");
    expect(await filesUnder(s.storeRoot)).toEqual([]);
  });
});
const good2 = (rec: OutcomeRecord) => receiptText(receiptForStoredRecord(rec)); // a T1 receipt offered under a T2 path

describe("B2a hardening F2: the environment check is a tripwire; the real boundary is structural", () => {
  it("environment manipulation: the public repository is refused however it is presented", () => {
    for (const GITHUB_ACTIONS of [undefined, "", "false", "true", "1"])
      for (const GITHUB_REPOSITORY of ["sanoramv/Sector-Dashboard", "SANORAMV/SECTOR-DASHBOARD", " sanoramv/sector-dashboard "])
        expect(() => assertProtectedExecutionContext({ OD1_PROTECTED_CONTEXT: "private-outcome-repository", GITHUB_ACTIONS, GITHUB_REPOSITORY })).toThrow("public repository");
    expect(() => assertProtectedExecutionContext({ OD1_PROTECTED_CONTEXT: "private-outcome-repository", GITHUB_ACTIONS: "1" })).toThrow("GITHUB_REPOSITORY");
    for (const flag of [undefined, "", "true", "PRIVATE-OUTCOME-REPOSITORY", "private-outcome-repository "]) expect(() => assertProtectedExecutionContext({ ...ENV, OD1_PROTECTED_CONTEXT: flag })).toThrow("OD1_PROTECTED_CONTEXT");
  });

  it("once real dates are allowed, an injected environment is ignored in favour of the real process environment", () => {
    expect(effectiveEnv(ENV, true)).toBe(ENV);
    expect(effectiveEnv(ENV, false)).toBe(process.env);
    expect(process.env.OD1_PROTECTED_CONTEXT).toBeUndefined(); // this (public) test process never declares the context
    expect(() => assertProtectedExecutionContext(effectiveEnv(ENV, false))).toThrow();
  });

  it("independent restrictions: no workflow, CLI, activation record, credential or real-data path for outcomes", async () => {
    const tracked = execFileSync("git", ["ls-files"]).toString().split("\n").filter(Boolean);
    for (const f of tracked.filter((f) => f.startsWith(".github/"))) expect(await readFile(f, "utf-8")).not.toMatch(/outcome-(pipeline|runner|inputs|receipts)|private-store|OD1_PROTECTED_CONTEXT|OD1_PUBLISHER|create-github-app-token|od1-run|od1-publish/);
    const pkg = JSON.parse(await readFile("package.json", "utf-8"));
    expect(JSON.stringify(pkg.scripts)).not.toMatch(/outcome-|private-store|od1-/);
    // only the ledger modules themselves and tests import the pipeline pieces: no entry-point script exists
    for (const f of tracked.filter((f) => /\.(m?ts|tsx?|m?js)$/.test(f) && !f.startsWith("tests/") && !f.startsWith("scripts/ledger/")))
      expect(await readFile(f, "utf-8"), f).not.toMatch(/outcome-(pipeline|inputs|runner)|private-store/);
    expect(tracked.filter((f) => /^scripts\/(od1|outcome)/.test(f))).toEqual([]);
    // no activation record and no outcome receipt in the public ledger
    expect(tracked.filter((f) => f.startsWith("public/") && /activation|outcome/i.test(f))).toEqual([]);
    for (const f of tracked.filter((f) => f.startsWith("public/data/ledger/"))) expect(await readFile(f, "utf-8")).not.toContain("outcomesFrom");
  });
});

describe("B2a hardening F3: repository-wide, content-based leak detection", () => {
  async function repo() {
    const root = await tmp("leakrepo");
    execFileSync("git", ["init", "-q"], { cwd: root });
    const put = async (rel: string, content: string | Buffer) => {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content);
    };
    return { root, put, add: (...f: string[]) => execFileSync("git", ["add", "--", ...f], { cwd: root }), scan: () => scanRepositoryForOutcomeLeaks(root) };
  }

  it("legitimate public files pass: market data, prediction records, prediction receipts, valid outcome receipts, the real repository", async () => {
    const { s, rec } = await validRecord();
    const r = await repo();
    await r.put("public/data/stocks.json", await readFile(path.join(s.data, "stocks.json")));
    await r.put("public/data/index-series.json", await readFile(path.join(s.data, "index-series.json")));
    for (const f of await filesUnder(s.ledger)) await r.put(path.join("public/data/ledger", path.relative(s.ledger, f)), await readFile(f));
    await r.put("public/data/notes.jsonl", '{"a":1}\n{"b":2}\n');
    r.add(".");
    expect(await r.scan()).toEqual([]);
    expect(protectedContentReason(Buffer.from(receiptText(receiptForStoredRecord(rec))))).toBeNull();
    // the actual repository: every tracked, staged and new file, including all real prediction and market data
    expect(await scanRepositoryForOutcomeLeaks(process.cwd())).toEqual([]);
  });

  it("finds protected artifacts anywhere: renamed, extensionless, nested, gzipped, JSONL, stripped, staged, untracked", async () => {
    const { rec } = await validRecord();
    const text = storedText(rec);
    const corr = JSON.stringify({ kind: OUTCOME_CORRECTION_KIND, sessionDate: T1 });
    const cases: Array<[string, string | Buffer]> = [
      ["docs/notes.md", text], // renamed to a doc
      ["OUTCOMES", text], // extensionless at the root
      ["a/b/c/d/report.txt", text], // nested, odd extension
      ["tmp/out.json.gz", gzipSync(Buffer.from(text))], // compressed
      ["reports/run.jsonl", `{"ok":true}\n${JSON.stringify(rec)}\n`], // JSONL
      ["x/entries.json", JSON.stringify(rec.outcomes)], // outcomes without the header
      ["x/corr.bin", corr], // private correction
      ["x/salt.log", `run finished commitmentSalt: "${rec.header.commitmentSalt}"`], // a salt in a log line
      ["x/truncated.json", text.slice(0, 2000)], // half-written file
    ];
    for (const [rel, content] of cases) {
      const r = await repo();
      await r.put(rel, content);
      expect((await r.scan()).map((v) => v.path), rel).toContain(rel); // untracked, not ignored
      r.add(rel);
      expect((await r.scan()).map((v) => v.path), rel).toEqual([rel, `${rel} (staged)`].sort().reverse());
    }
    // staged leak whose working copy was restored: still caught from the index
    const r = await repo();
    await r.put("public/data/sector.json", text);
    r.add("public/data/sector.json");
    await r.put("public/data/sector.json", '{"clean":true}');
    expect((await r.scan()).map((v) => v.path)).toEqual(["public/data/sector.json (staged)"]);
    // violations never echo the protected value
    expect(JSON.stringify(await r.scan())).not.toContain(rec.header.commitmentSalt);
  });

  it("the guard scans the whole repository for the real ledger and the whole tree for fixture roots", async () => {
    const { s, rec } = await validRecord();
    await mkdir(path.join(s.ledger, "deep", "er"), { recursive: true });
    await writeFile(path.join(s.ledger, "deep", "er", "README"), storedText(rec));
    expect((await checkOutcomeConfidentiality(s.ledger)).some((v) => /protected outcome data/.test(v.detail))).toBe(true);
    expect((await scanForOutcomeLeaks([s.ledger])).length).toBe(1);
  });
});
