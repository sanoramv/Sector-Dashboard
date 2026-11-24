/**
 * Live OD1 outcome processing (continuous-monitoring policy, erratum 23): runner, create-only store, corrections,
 * processing loop, dashboard summary and guard checks. SYNTHETIC fixtures (dates in 2031) for everything except the
 * last block, which runs read-only against the real repository into a temporary store.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";
import { od1DefinitionsSha256 } from "../../scripts/ledger/protocol.mts";
import { od1Epsilon, od1Measure, od1SigmaWindow, populationSd } from "../../scripts/ledger/od1.mts";
import { ENGINE_FILES, OUTCOME_CORRECTION_KIND, computeEngine, validateEvaluationPolicy, type OutcomeCorrection, type OutcomeRecord } from "../../scripts/ledger/outcomes.mts";
import { buildDueRecord, planOutcomes, type RunnerContext, type RunnerMarket } from "../../scripts/ledger/outcome-runner.mts";
import { FsOutcomeStore, parseStorageKey, storedText, type OutcomeStore } from "../../scripts/ledger/outcome-store.mts";
import { buildEvaluationSummary, processOutcomes, processPlanned, readPolicy } from "../../scripts/ledger/outcome-process.mts";
import { checkOutcomeStore } from "../../scripts/ledger/outcome-check.mts";
import { loadRunnerMarket, loadRunnerSessions } from "../../scripts/ledger/outcome-inputs.mts";
import { realGuardGit } from "../../scripts/ledger/guard.mts";
import { UnsafePathError, relativeSegments } from "../../scripts/ledger/safe-path.mts";
import { weekdays } from "../momentum/fixtures";
import type { DailyBar } from "../../src/types/market";

const RV = "mv1-8ecef864";
const DEFS = od1DefinitionsSha256();

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic world: 70 weekdays, one exchange holiday, a handful of stocks with known features
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
  const d = await mkdtemp(path.join(os.tmpdir(), `od1-${prefix}-`));
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
  const market = await loadRunnerMarket(data, { commit: "c".repeat(40) });
  return { ledger, data, sessions: runnerSessions, market };
}

async function context(over: Partial<RunnerContext> = {}): Promise<Omit<RunnerContext, "stored">> {
  return { ruleVersion: RV, activation: { outcomesFrom: ACT }, eligibleSessions: new Set([T0, T1, TL, T2]), definitionsSha256: DEFS, engine: await computeEngine(process.cwd(), DEFS), generatedAt: `${TRADING[TRADING.length - 1]}T16:00:00.000Z`, github: { runId: null, runAttempt: null, sha: null }, ...over };
}
async function setup(w = makeWorld()) {
  const m = await materialise(w);
  const storeRoot = await tmp("store");
  const store = await FsOutcomeStore.open(storeRoot, { definitionsSha256: DEFS });
  const ctx = await context();
  return { ...m, w, storeRoot, store, ctx };
}
const run = (s: Awaited<ReturnType<typeof setup>>, store: OutcomeStore = s.store) => processPlanned(s.sessions, s.market, s.ctx, store);

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
describe("runner: horizons, maturity, eligibility, frozen volatility", () => {
  it("plans every stored horizon; only h1 and h5 are headline; excluded, non-live and pre-policy sessions are rejected", async () => {
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
    expect(CAL.slice(CAL.indexOf(T1) + 1, CAL.indexOf(T1) + 6)).toContain(HOLIDAY);
  });

  it("never skips an unresolved session and keeps horizons pending when an archive is missing or not ok", async () => {
    for (const mutate of [
      (w: World) => (w.refreshState.archives.stocks[HOLIDAY] = { status: "failed", checkedAt: "x" }),
      (w: World) => delete w.refreshState.archives.index[TRADING[idx(T1) + 1]],
      (w: World) => (w.refreshState.archives.stocks[TRADING[idx(T1) + 1]] = { status: "failed", checkedAt: "x" }),
    ]) {
      const w = makeWorld();
      mutate(w);
      const s = await setup(w);
      const r = await run(s);
      const t1 = r.planItems.filter((p) => p.sessionDate === T1);
      expect(t1.find((p) => p.horizon === 10)!.status).toBe("pending");
      expect(t1.find((p) => p.horizon === 5)!.status).toBe("pending");
      expect(r.created.filter((k) => k.includes(T1) && /h(5|10)$/.test(k))).toEqual([]);
    }
  });

  it("produces deterministic records that match the shared engine applied independently, with frozen sigma", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    for (const item of plan.filter((p) => p.sessionDate === T1)) {
      const r = buildDueRecord(item, t1, s.market, { ...s.ctx, stored: new Set() });
      expect(sha256Canonical(buildDueRecord(item, t1, s.market, { ...s.ctx, stored: new Set() }))).toBe(sha256Canonical(r));
      expect(r.outcomes).toHaveLength(t1.daily.predictions.length);
      expect(r.outcomes.map((e) => e.recordHash)).toEqual([...t1.daily.predictions].sort((a, b) => a.symbol.localeCompare(b.symbol)).map((p) => p.recordHash));
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
    expect(od1Epsilon(eps.frozen.sigma!, 1)).toBe(0.2);
    if (eps.outcome.status !== "complete" || epz.outcome.status !== "complete") throw new Error("expected complete outcomes");
    expect(eps.outcome.P).toBe(true);
    expect(epz.outcome.P).toBe(false);
    expect(epz.outcome.D).toBe(false);
  });

  it("uses the FROZEN volatility20: a data revision in the sigma window or of the day-t bar blocks the horizon (never recomputed, never fabricated)", async () => {
    const s = await setup();
    const ix = s.market.stocks.AAA!.bars.findIndex((b) => b.date === T1);
    s.market.stocks.AAA!.bars[ix - 5] = { ...s.market.stocks.AAA!.bars[ix - 5], close: s.market.stocks.AAA!.bars[ix - 5].close * 1.01 };
    const r1 = await run(s);
    expect(r1.blocked.filter((b) => b.key.includes(T1))).toEqual([1, 2, 5, 10].map((h) => ({ code: "source-revised", key: `od1/${RV}/${T1}/h${h}` })));
    expect(await s.store.getRecord(`od1/${RV}/${T1}/h1`)).toBeNull();
    const s2 = await setup();
    s2.market.stocks.BBB!.bars[s2.market.stocks.BBB!.bars.findIndex((b) => b.date === T1)].close *= 1.001;
    expect((await run(s2)).blocked.some((b) => b.code === "source-revised" && b.key.includes(T1))).toBe(true);
  });

  it("the synthetic-only lock, salts, receipts and the private pipeline are retired; no OD1 math changed", async () => {
    for (const f of ["outcome-pipeline", "outcome-receipts", "private-store"]) await expect(readFile(`scripts/ledger/${f}.mts`, "utf-8")).rejects.toThrow();
    for (const f of ["outcomes", "outcome-runner", "outcome-store", "outcome-process"]) expect(await readFile(`scripts/ledger/${f}.mts`, "utf-8")).not.toMatch(/SYNTHETIC_ONLY|commitmentSalt|assertSyntheticSession/);
    expect(ENGINE_FILES).toEqual(["scripts/ledger/od1.mts", "scripts/ledger/outcomes.mts", "scripts/ledger/protocol.mts", "scripts/ledger/outcome-runner.mts", "src/lib/calculations/validation.ts"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("outcome store: create-only, append-only corrections, path safety, recovery", () => {
  it("create-only: an identical retry is existing and returns the STORED record; different outcomes conflict; nothing is overwritten", async () => {
    const s = await setup();
    await run(s);
    const key = `od1/${RV}/${T1}/h1`;
    const file = path.join(s.storeRoot, `${key}.json`);
    const before = await readFile(file, "utf-8");
    const stored = (await s.store.getRecord(key))!;
    const item = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() }).find((p) => p.key === key)!;
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const again = buildDueRecord(item, t1, s.market, { ...s.ctx, stored: new Set(), generatedAt: "2031-09-09T09:09:09.000Z" });
    const r = await s.store.putRecord(again);
    expect(r.result).toBe("existing");
    expect(r.stored!.header.generatedAt).toBe(stored.header.generatedAt);
    const m2 = { ...s.market, indexSeries: { nifty500: { bars: s.market.indexSeries.nifty500!.bars.map((b) => (b.date === item.sessions![0] ? { ...b, close: b.close * 1.05 } : b)) } } };
    const different = buildDueRecord(item, t1, m2, { ...s.ctx, stored: new Set() });
    expect((await s.store.putRecord(different)).result).toBe("conflict");
    expect(await readFile(file, "utf-8")).toBe(before);
  });

  it("refuses invalid or tampered records", async () => {
    const s = await setup();
    const plan = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() });
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const ok = buildDueRecord(plan.find((p) => p.sessionDate === T1)!, t1, s.market, { ...s.ctx, stored: new Set() });
    const tampered = JSON.parse(JSON.stringify(ok));
    const e = tampered.outcomes.find((x: any) => x.outcome.status === "complete");
    e.outcome.cls = e.outcome.cls === "sideways" ? "confirmed" : "sideways";
    tampered.header.outcomesSha256 = sha256Canonical(tampered.outcomes);
    await expect(s.store.putRecord(tampered)).rejects.toThrow("re-derive");
    await expect(s.store.putRecord({ ...ok, header: { ...ok.header, extra: 1 } } as any)).rejects.toThrow("unknown key extra");
  });

  it("validates keys and paths: traversal, absolute paths and symbolic links are refused", async () => {
    for (const bad of ["../x", "od1/../../etc", "/etc/passwd", "a//b", "a\\b", "a/./b", ""]) expect(() => relativeSegments(bad)).toThrow(UnsafePathError);
    for (const bad of [`od1/${RV}/2031-02-30/h1`, `od1/${RV}/${T1}/h3`, `od1/../${T1}/h1`, `od1/${RV}/${T1}/h1/../h2`]) expect(() => parseStorageKey(bad)).toThrow();
    const s = await setup();
    await expect(s.store.getRecord(`od1/${RV}/${T1}/h1/../../x`)).rejects.toThrow();
    const root = await tmp("linked");
    const outside = await tmp("outside");
    await mkdir(path.join(root, "od1"), { recursive: true });
    await symlink(outside, path.join(root, "od1", RV));
    await expect(FsOutcomeStore.open(root, { definitionsSha256: DEFS })).rejects.toThrow("symbolic link");
    const linkRoot = path.join(await tmp("lr"), "root");
    await symlink(outside, linkRoot);
    await expect(FsOutcomeStore.open(linkRoot, { definitionsSha256: DEFS })).rejects.toThrow("symbolic link");
    await expect(FsOutcomeStore.open("relative/path", { definitionsSha256: DEFS })).rejects.toThrow("absolute");
  });

  it("recovers from interrupted writes: leftover partial files are removed on open; unexpected files fail closed", async () => {
    const s = await setup();
    await run(s);
    const dir = path.join(s.storeRoot, "od1", RV, T2);
    await writeFile(path.join(dir, "h10.json.123-deadbeef.partial"), '{"half":');
    const reopened = await FsOutcomeStore.open(s.storeRoot, { definitionsSha256: DEFS });
    expect(reopened.recovered.map((f) => path.basename(f))).toEqual(["h10.json.123-deadbeef.partial"]);
    expect(await reopened.listKeys()).toEqual(await s.store.listKeys());
    await writeFile(path.join(dir, "notes.txt"), "x");
    await expect(reopened.listKeys()).rejects.toThrow("unexpected file");
  });

  it("corrections are append-only, chained by outcomesSha256, and never replace the authoritative original", async () => {
    const s = await setup();
    await run(s);
    const key = `od1/${RV}/${T1}/h1`;
    const original = (await s.store.getRecord(key))!;
    const item = planOutcomes(s.sessions, s.market, { ...s.ctx, stored: new Set() }).find((p) => p.key === key)!;
    const t1 = s.sessions.find((x) => x.daily.header.sessionDate === T1)!;
    const revised = (f: number) => buildDueRecord(item, t1, { ...s.market, indexSeries: { nifty500: { bars: s.market.indexSeries.nifty500!.bars.map((b) => (b.date === item.sessions![0] ? { ...b, close: b.close * f } : b)) } } }, { ...s.ctx, stored: new Set() });
    const c = (n: number, sup: string, rep: OutcomeRecord): OutcomeCorrection => ({ kind: OUTCOME_CORRECTION_KIND, schemaVersion: 1, sessionDate: T1, ruleVersion: RV, horizon: 1, sequence: n, supersedes: sup, replacement: rep.header.outcomesSha256, reasonCode: "source-revised", reason: "NSE revised the benchmark close for the first window session", recordedAt: "2031-04-20T10:00:00Z", recordedBy: "owner", analyticalTreatment: "pending-owner-decision" });
    const rep1 = revised(1.01);
    const c1 = c(1, original.header.outcomesSha256, rep1);
    expect(await s.store.appendCorrection(key, { correction: c1, replacement: rep1 })).toBe("created");
    expect(await s.store.appendCorrection(key, { correction: c1, replacement: rep1 })).toBe("existing");
    const rep2 = revised(1.02);
    await expect(s.store.appendCorrection(key, { correction: c(2, original.header.outcomesSha256, rep2), replacement: rep2 })).rejects.toThrow("fork or a silent replacement");
    await expect(s.store.appendCorrection(key, { correction: c(3, c1.replacement, rep2), replacement: rep2 })).rejects.toThrow("sequence");
    await expect(s.store.appendCorrection(key, { correction: c(2, c1.replacement, original), replacement: original })).rejects.toThrow();
    expect(await s.store.appendCorrection(key, { correction: c(2, c1.replacement, rep2), replacement: rep2 })).toBe("created");
    expect(sha256Canonical(await s.store.getRecord(key))).toBe(sha256Canonical(original));
    expect((await s.store.getCorrections(key)).map((x) => x.correction.sequence)).toEqual([1, 2]);
    const rep3 = revised(1.03);
    await writeFile(path.join(s.storeRoot, `${key}.replacement-3.json`), storedText(revised(1.04)));
    await expect(s.store.appendCorrection(key, { correction: c(3, rep2.header.outcomesSha256, rep3), replacement: rep3 })).rejects.toThrow("orphan replacement");
    expect(await readFile("scripts/ledger/outcome-process.mts", "utf-8")).not.toMatch(/appendCorrection\(/); // processing never corrects
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("processing loop and dashboard summary", () => {
  it("idempotent: a repeated run changes nothing; a store failure fails the run without writing a partial record", async () => {
    const s = await setup();
    const r1 = await run(s);
    expect(r1.created.length).toBeGreaterThan(0);
    const files = execFileSync("find", [s.storeRoot, "-type", "f"]).toString().split("\n").filter(Boolean).sort();
    const r2 = await run(s);
    expect(r2.created).toEqual([]);
    expect(r2.planItems.filter((p) => p.status === "due")).toEqual([]);
    expect(execFileSync("find", [s.storeRoot, "-type", "f"]).toString().split("\n").filter(Boolean).sort()).toEqual(files);
    const s3 = await setup();
    const broken: OutcomeStore = { listKeys: () => s3.store.listKeys(), getRecord: (k) => s3.store.getRecord(k), getCorrections: (k) => s3.store.getCorrections(k), appendCorrection: (k, c) => s3.store.appendCorrection(k, c), putRecord: async () => { throw new Error("disk full"); } };
    await expect(run(s3, broken)).rejects.toThrow("disk full");
    expect(await s3.store.listKeys()).toEqual([]);
  });

  it("the summary distinguishes prediction, maturity and processing dates; pending horizons carry no outcome; excluded sessions are flagged", async () => {
    const s = await setup();
    const r = await run(s);
    const records = await Promise.all((await s.store.listKeys()).map((k) => s.store.getRecord(k)));
    const policy = { kind: "momentum-ledger.evaluation-policy", schemaVersion: 1, mode: "continuous-monitoring", decidedAt: "2031-01-01", decidedBy: "owner", referenceRuleVersion: RV, outcomesFrom: ACT, excludedSessions: [{ sessionDate: TX, reason: "synthetic exclusion" }] } as any;
    expect(validateEvaluationPolicy(policy)).toEqual([]);
    const sum = buildEvaluationSummary({ policy, sessions: s.sessions, records: records as OutcomeRecord[], plan: r.planItems, blocked: r.blocked, eligible: [T0, T1, TL, T2] });
    const t1 = sum.sessions.find((x) => x.date === T1)!;
    expect(t1.horizons.h5).toMatchObject({ status: "stored", end: TRADING[idx(T1) + 5], processedAt: s.ctx.generatedAt });
    const t2 = sum.sessions.find((x) => x.date === T2)!;
    expect(t2.horizons.h10.status).toBe("pending");
    expect(t2.predictions.every((p) => p.out.h10 === undefined)).toBe(true);
    expect(sum.sessions.find((x) => x.date === TX)!.excluded).toBe("synthetic exclusion");
    const aaa = t1.predictions.find((p) => p.symbol === "AAA")!;
    expect(aaa.out.h1.s).toBe("complete");
    expect(typeof aaa.out.h1.T).toBe("number");
    expect(t1.predictions.find((p) => p.symbol === "GAP")!.out.h1).toEqual({ s: "unavailable", why: "no-bar" });
    expect(sum.note).toContain("No figure here is a probability or a trading recommendation");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("guard: outcome store checks", () => {
  it("valid records pass; a wrong path, an ineligible or policy-excluded session, an unknown file or no policy are violations", async () => {
    const s = await setup();
    await run(s);
    const repo = await tmp("repo");
    const ledger = path.join(repo, "public", "data", "ledger");
    await mkdir(path.join(ledger, "protocol"), { recursive: true });
    execFileSync("cp", ["-R", path.join(s.ledger, "live"), path.join(ledger, "live")]);
    execFileSync("mkdir", ["-p", path.join(repo, "data")]);
    execFileSync("cp", ["-R", s.storeRoot, path.join(repo, "data", "outcomes")]);
    const policy = { kind: "momentum-ledger.evaluation-policy", schemaVersion: 1, mode: "continuous-monitoring", decidedAt: "2031-01-01", decidedBy: "owner", referenceRuleVersion: RV, outcomesFrom: ACT, excludedSessions: [] };
    // no policy: records are not authorised
    expect((await checkOutcomeStore(null, ledger, null)).map((v) => v.detail).join(" ")).toContain("no evaluation policy");
    await writeFile(path.join(ledger, "protocol", "evaluation-policy.json"), JSON.stringify(policy));
    // records live under data/outcomes relative to the repository; their prediction files are read with daily binding
    // (the synthetic prediction files are under the copied live/ tree)
    expect(await checkOutcomeStore(null, ledger, new Set([T1, T2]))).toEqual([]);
    expect((await checkOutcomeStore(null, ledger, new Set([T2]))).some((v) => /not eligible/.test(v.detail))).toBe(true);
    await writeFile(path.join(ledger, "protocol", "evaluation-policy.json"), JSON.stringify({ ...policy, excludedSessions: [{ sessionDate: T1, reason: "x" }] }));
    expect((await checkOutcomeStore(null, ledger, null)).some((v) => /permanently excluded/.test(v.detail))).toBe(true);
    await writeFile(path.join(ledger, "protocol", "evaluation-policy.json"), JSON.stringify(policy));
    await writeFile(path.join(repo, "data", "outcomes", "od1", RV, T1, "notes.json"), "{}");
    expect((await checkOutcomeStore(null, ledger, null)).some((v) => /unexpected file/.test(v.detail))).toBe(true);
    await rm(path.join(repo, "data", "outcomes", "od1", RV, T1, "notes.json"));
    const moved = path.join(repo, "data", "outcomes", "od1", RV, T2, "h1.json");
    await writeFile(moved, await readFile(path.join(repo, "data", "outcomes", "od1", RV, T1, "h1.json")));
    expect((await checkOutcomeStore(null, ledger, null)).some((v) => /does not match its path/.test(v.detail))).toBe(true);
  });

  it("committed history that modifies or deletes a record is a violation (create-only)", async () => {
    const s = await setup();
    await run(s);
    const repo = await tmp("gitrepo");
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: repo });
    git("init", "-q");
    const ledger = path.join(repo, "public", "data", "ledger");
    await mkdir(path.join(repo, "data"), { recursive: true });
    await mkdir(ledger, { recursive: true });
    execFileSync("cp", ["-R", s.storeRoot, path.join(repo, "data", "outcomes")]);
    git("add", ".");
    git("commit", "-qm", "records");
    expect((await checkOutcomeStore(realGuardGit(repo), ledger, null)).filter((v) => /committed history/.test(v.detail))).toEqual([]);
    const f = path.join(repo, "data", "outcomes", "od1", RV, T1, "h1.json");
    await writeFile(f, (await readFile(f, "utf-8")).replace('"generatedAt":"', '"generatedAt":"X'));
    git("commit", "-qam", "edit");
    await rm(path.join(repo, "data", "outcomes", "od1", RV, T1, "h2.json"));
    git("commit", "-qam", "delete");
    const d = (await checkOutcomeStore(realGuardGit(repo), ledger, null)).filter((v) => /committed history/.test(v.detail)).map((v) => v.detail);
    expect(d.some((x) => x.includes("modified"))).toBe(true);
    expect(d.some((x) => x.includes("deleted"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("real repository (read-only; records written to a temporary store)", () => {
  it("the policy is valid; 18 Nov is excluded; mature outcomes from 19 Nov validate and re-runs are idempotent; holdout.json and od1.json are unchanged", async () => {
    const policy = await readPolicy("public/data/ledger");
    expect(policy).toMatchObject({ referenceRuleVersion: RV, outcomesFrom: "2026-11-19", excludedSessions: [{ sessionDate: "2026-11-18" }] });
    const out = await tmp("real");
    const opts = { repoRoot: process.cwd(), ledgerRoot: "public/data/ledger", dataDir: path.resolve("public/data"), storeRoot: path.join(out, "store"), summaryPath: path.join(out, "summary.json"), git: realGuardGit(process.cwd()), commit: "c".repeat(40), github: { runId: null, runAttempt: null, sha: null }, now: "2026-11-24T00:00:00.000Z" };
    const r1 = await processOutcomes(opts);
    expect(r1.eligible).not.toContain("2026-11-18");
    expect(r1.conflicts).toEqual([]);
    for (const k of r1.created) expect(k >= `od1/${RV}/2026-11-19`).toBe(true);
    const r2 = await processOutcomes(opts);
    expect(r2.created).toEqual([]);
    const sum = JSON.parse(await readFile(opts.summaryPath, "utf-8"));
    expect(sum.sessions.find((x: any) => x.date === "2026-11-18")).toMatchObject({ eligible: false });
    const h = JSON.parse(await readFile("public/data/ledger/holdout.json", "utf-8"));
    expect(h).toMatchObject({ status: "sealed", unblinded: null, gate: { minCompletedLiveSessions: 250 } });
    expect(execFileSync("git", ["diff", "--quiet", "HEAD", "--", "public/data/ledger/holdout.json", "public/data/ledger/protocol/od1.json"]).toString()).toBe("");
  });
});
