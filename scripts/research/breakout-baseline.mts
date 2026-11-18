/**
 * Breakout research baseline (Phase 1B) - EXPLORATORY, historical, read-only.
 *
 *   npx tsx scripts/research/breakout-baseline.mts [--commit <sha>] [--out <file.json>]
 *
 * Reproduces the six populations of docs/research/BREAKOUT_BASELINE.md with the deployed (mv1) production functions and
 * default settings, and measures legacy next-session outcomes, 5-session returns and OD1 outcome classes.
 *
 * Safety (fail closed):
 *  - Market data is read from ONE pinned commit (default DATA_COMMIT) with `git show`, never from the working tree, so
 *    later data commits (which contain live-holdout sessions) are never read.
 *  - manifest.json is read first; if it reaches the fence nothing else is read. Every date in every series is then
 *    validated, and any date on or after the fence aborts the run.
 *  - Every observation date AND every outcome date must be strictly before FENCE (the live activation date); an outcome
 *    window that would reach the fence is reported as pending, never computed.
 *  - Only the five market-data files are read. Live prediction records, receipts, ledger state and holdout files are never
 *    read; the only ledger files touched are the create-only version records, to confirm FENCE matches the activation.
 *  - The production rule version must equal EXPECTED_RULE_VERSION.
 *  - Nothing in the repository is written. --out must point outside public/.
 *
 * OD1 is implemented here for research only, from public/data/ledger/protocol/od1.json (sealed). It is not the governed
 * Phase B outcome engine and must not be used to compute live-holdout outcomes.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RawDataset } from "../../src/types/dataset.ts";
import type { ActivityRow, StockActivityFile } from "../../src/types/activity.ts";
import type { AppSettings } from "../../src/types/config.ts";
import type { DailyBar } from "../../src/types/market.ts";
import type { Regime } from "../../src/types/metrics.ts";
import type { EvidenceCategory, MomentumLabel } from "../../src/types/momentum.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { decodeAllActivity } from "../../src/lib/activity.ts";
import { prepareUniverse, comparableBarsUpTo, type PreparedUniverse, type UniverseStock } from "../../src/lib/momentum/universe.ts";
import { moversOn, rankMovers, makeBuildContext, buildCandidate } from "../../src/lib/momentum/discovery.ts";
import { marketContextAt } from "../../src/lib/momentum/market.ts";
import { nextSessionOutcome, type NextSessionOutcome } from "../../src/lib/momentum/outcomes.ts";
import { clusteredMean, computeOutcomeStats, runMomentumEvaluation, type OutcomeStats } from "../../src/lib/momentum/evaluation.ts";
import { MOMENTUM_RULES } from "../../src/lib/momentum/classify.ts";
import { ASSESSMENT_RULES } from "../../src/lib/momentum/assess.ts";

// ---------------------------------------------------------------------------------------------------------------------
// Fixed research parameters (recorded in the output; changing any of them is a new baseline, not a re-run)
// ---------------------------------------------------------------------------------------------------------------------
/** First live session (protocol/versions/mv1-8ecef864.json enabledFrom). Nothing on or after it may be read or used. */
export const FENCE = "2026-11-18";
/** Activation commit: its market data ends 2026-11-17, the last session before the fence. */
export const DATA_COMMIT = "5740ac60cb4820274db7612288d3e3b4414f226d";
export const EXPECTED_RULE_VERSION = "mv1-8ecef864";
/** The Daily Movers page builds its candidate pool from the top 50 gainers (MomentumPanel POOL_SIZE; ledger POOL.gainers). */
export const TOP_N = 50;
export const COST_BPS = 20;
export const BOOTSTRAP = { seed: 20261118, reps: 2000, level: 0.95 } as const;
/** From the sealed protocol/od1.json. */
export const OD1 = { k: 0.5, floorPct: 0.2, sigmaWindow: 20, minComparableBars: 22, abnormalGapSigma: 3, volWindowOutlierSigma: 3.5 } as const;
export const MARKET_FILES = ["manifest.json", "index-series.json", "constituents.json", "stocks.json", "stock-activity.json"] as const;

// ---------------------------------------------------------------------------------------------------------------------
// Dates and the fence
// ---------------------------------------------------------------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value;
}

/** Throws unless every date in the dataset and activity rows is a real calendar date strictly before `fence`. */
export function assertDatasetBeforeFence(dataset: RawDataset, activity: Record<string, ActivityRow[]> | null, fence: string): void {
  if (!isRealDate(fence)) throw new Error(`fence ${JSON.stringify(fence)} is not a real date`);
  const check = (where: string, d: unknown) => {
    if (!isRealDate(d)) throw new Error(`${where}: invalid or missing date ${JSON.stringify(d)}`);
    if (d >= fence) throw new Error(`${where}: date ${d} is on or after the research fence ${fence} (live holdout)`);
  };
  check("manifest.latestMarketDate", dataset.manifest?.latestMarketDate);
  for (const [slug, s] of Object.entries(dataset.indexSeries ?? {})) for (const b of s.bars ?? []) check(`index ${slug}`, b?.date);
  for (const [sym, s] of Object.entries(dataset.stocks ?? {})) for (const b of s.bars ?? []) check(`stock ${sym}`, b?.date);
  for (const [sym, rows] of Object.entries(activity ?? {})) for (const r of rows) check(`activity ${sym}`, r?.date);
  if (!dataset.indexSeries?.nifty500?.bars?.length) throw new Error("NIFTY 500 series (the trading calendar) is missing");
}

// ---------------------------------------------------------------------------------------------------------------------
// Pinned data loading (git show; never the working tree)
// ---------------------------------------------------------------------------------------------------------------------
export interface LoadedData {
  dataset: RawDataset;
  activity: Record<string, ActivityRow[]>;
  files: Array<{ path: string; blob: string; bytes: number }>;
}
export function loadPinnedMarketData(repoRoot: string, commit: string, fence: string): LoadedData {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`--commit must be a full 40-hex SHA, got ${JSON.stringify(commit)}`);
  const git = (args: string[]) => execFileSync("git", args, { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024, encoding: "utf-8" });
  const read = (name: (typeof MARKET_FILES)[number]) => {
    const p = `public/data/${name}`;
    const blob = git(["rev-parse", `${commit}:${p}`]).trim();
    const text = git(["cat-file", "blob", blob]);
    files.push({ path: p, blob, bytes: Buffer.byteLength(text) });
    return JSON.parse(text);
  };
  const files: LoadedData["files"] = [];
  const manifest = read("manifest.json");
  if (!isRealDate(manifest?.latestMarketDate) || manifest.latestMarketDate >= fence) {
    throw new Error(`commit ${commit} has latestMarketDate ${JSON.stringify(manifest?.latestMarketDate)}; it must be a real date before ${fence}. Refusing to read its other files.`);
  }
  const dataset: RawDataset = { manifest, indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") };
  const activity = decodeAllActivity(read("stock-activity.json") as StockActivityFile);
  assertDatasetBeforeFence(dataset, activity, fence);
  return { dataset, activity, files };
}

/** FENCE must not be later than any enabled live version (reads only the create-only version records). */
export function assertFenceMatchesActivation(repoRoot: string, fence: string): string[] {
  const dir = path.join(repoRoot, "public/data/ledger/protocol/versions");
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  } catch {
    throw new Error(`cannot read ${dir}; the activation date cannot be confirmed`);
  }
  if (names.length === 0) throw new Error("no live version record found; the activation date cannot be confirmed");
  const enabled = names.map((n) => JSON.parse(readFileSync(path.join(dir, n), "utf-8")).enabledFrom as unknown);
  for (const e of enabled) {
    if (!isRealDate(e)) throw new Error(`version record enabledFrom ${JSON.stringify(e)} is not a real date`);
    if (e < fence) throw new Error(`a live version is enabled from ${e}, before the research fence ${fence}`);
  }
  return enabled as string[];
}

// ---------------------------------------------------------------------------------------------------------------------
// OD1 (research implementation of the sealed protocol)
// ---------------------------------------------------------------------------------------------------------------------
export type Od1Class = "confirmed" | "partial" | "sideways" | "failed" | "reversal";
export type Od1Unavailable = "insufficient-history" | "no-bar" | "discontinuity";
export type Od1Result =
  | { status: "complete"; cls: Od1Class; R: number; X: number; eps: number; endDate: string; abnormalGap: boolean; volWindowOutlier: boolean }
  | { status: "unavailable"; reason: Od1Unavailable }
  | { status: "pending"; reason: "beyond-data" | "beyond-fence" };

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** sigma window: the 20 daily % changes ending at t-1 (day t excluded). `comparable` = comparable bars up to and including t. */
export function od1SigmaWindow(comparable: Array<Pick<DailyBar, "close">>): number[] | null {
  if (comparable.length < OD1.minComparableBars) return null;
  const n = comparable.length;
  const changes: number[] = [];
  for (let k = n - 1 - OD1.sigmaWindow; k < n - 1; k++) changes.push(pct(comparable[k].close, comparable[k - 1].close));
  return changes;
}
/** Population standard deviation (divisor N). */
export function populationSd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}
export const od1Epsilon = (sigma: number, h: number) => Math.max(OD1.k * sigma * Math.sqrt(h), OD1.floorPct);

/** First-match classification from the OD1 quantities. `up` = gainer rules; otherwise the loser mirror. */
export function od1Classify(q: { up: boolean; R: number; X: number; Hstar: number; Lstar: number; Ht: number; Lt: number; eps: number }): { cls: Od1Class; P: boolean; E: boolean; N: boolean; D: boolean; B: boolean } {
  const { up, R, X, Hstar, Lstar, Ht, Lt, eps } = q;
  const P = up ? R >= eps : R <= -eps;
  const E = up ? X > 0 : X < 0;
  const N = up ? Hstar > Ht : Lstar < Lt;
  const D = up ? R <= -eps : R >= eps;
  const B = up ? Lstar < Lt : Hstar > Ht;
  let cls: Od1Class;
  if (D && B) cls = "reversal";
  else if (D) cls = "failed";
  else if (P && E && N) cls = "confirmed";
  else if (P || E || N) cls = "partial";
  else cls = "sideways";
  return { cls, P, E, N, D, B };
}

/** OD1 for a prediction-day bar and an already validated window of h bars (t+1..t+h). */
export function od1FromBars(a: { up: boolean; day: Pick<DailyBar, "close" | "high" | "low">; window: Array<Pick<DailyBar, "open" | "close" | "high" | "low">>; benchT: number; benchTh: number; sigmaChanges: number[] }): { cls: Od1Class; R: number; X: number; eps: number; abnormalGap: boolean; volWindowOutlier: boolean } {
  const h = a.window.length;
  const sigma = populationSd(a.sigmaChanges);
  const eps = od1Epsilon(sigma, h);
  const R = pct(a.window[h - 1].close, a.day.close);
  const X = R - pct(a.benchTh, a.benchT);
  const Hstar = Math.max(...a.window.map((b) => b.high));
  const Lstar = Math.min(...a.window.map((b) => b.low));
  const { cls } = od1Classify({ up: a.up, R, X, Hstar, Lstar, Ht: a.day.high, Lt: a.day.low, eps });
  const gap = pct(a.window[0].open, a.day.close);
  return {
    cls,
    R,
    X,
    eps,
    abnormalGap: Math.abs(gap) >= OD1.abnormalGapSigma * sigma,
    volWindowOutlier: Math.max(...a.sigmaChanges.map(Math.abs)) >= OD1.volWindowOutlierSigma * sigma,
  };
}

/** OD1 for stock bar i at horizon h. Pending checks come first, so nothing on or after the fence is ever read. */
export function od1For(u: PreparedUniverse, stock: UniverseStock, i: number, h: number, up: boolean, fence: string): Od1Result {
  const ci = u.calendarIndex.get(stock.bars[i].date);
  if (ci === undefined || ci + h >= u.calendar.length) return { status: "pending", reason: "beyond-data" };
  for (let k = 1; k <= h; k++) if (u.calendar[ci + k] >= fence) return { status: "pending", reason: "beyond-fence" };
  const sigmaChanges = od1SigmaWindow(comparableBarsUpTo(stock, i));
  if (sigmaChanges === null) return { status: "unavailable", reason: "insufficient-history" };
  const window: DailyBar[] = [];
  for (let k = 1; k <= h; k++) {
    const j = stock.indexByDate.get(u.calendar[ci + k]);
    if (j === undefined) return { status: "unavailable", reason: "no-bar" };
    if (stock.segOf[j] !== stock.segOf[i]) return { status: "unavailable", reason: "discontinuity" };
    window.push(stock.bars[j]);
  }
  const r = od1FromBars({ up, day: stock.bars[i], window, benchT: u.benchmark[ci].close, benchTh: u.benchmark[ci + h].close, sigmaChanges });
  return { status: "complete", ...r, endDate: u.calendar[ci + h] };
}

/** Legacy next-session outcome (production nextSessionOutcome) behind the fence. */
export type LegacyResult = { status: "ok"; outcome: NextSessionOutcome } | { status: "pending" | "beyond-fence" | "no-next-bar" | "discontinuity" };
export function legacyFor(u: PreparedUniverse, stock: UniverseStock, i: number, fence: string): LegacyResult {
  const ci = u.calendarIndex.get(stock.bars[i].date);
  if (ci === undefined || ci + 1 >= u.calendar.length) return { status: "pending" };
  if (u.calendar[ci + 1] >= fence) return { status: "beyond-fence" };
  const r = nextSessionOutcome(u, stock, i, COST_BPS);
  return r.kind === "ok" ? { status: "ok", outcome: r.outcome } : { status: r.kind === "pending" ? "pending" : r.kind };
}

// ---------------------------------------------------------------------------------------------------------------------
// Populations
// ---------------------------------------------------------------------------------------------------------------------
export interface StockDay {
  date: string;
  symbol: string;
  rank: number | null;
  changePct: number;
  label: MomentumLabel | null;
  category: EvidenceCategory | null;
  regime: Regime;
  repeat: boolean;
  legacy: LegacyResult;
  r5: number | null;
  h1: Od1Result;
  h5: Od1Result;
}
export interface Populations {
  sessions: string[];
  /** A: every eligible universe stock-day (ranked movers, same exclusions as the page). */
  A: StockDay[];
  /** A+: eligible stock-days that closed higher on the day (OD1 gainer rules apply). */
  Aplus: StockDay[];
  B: StockDay[];
  C: StockDay[];
  D: StockDay[];
  E: StockDay[];
  F: StockDay[];
  moversExcluded: Record<string, number>;
}

const r5Of = (h5: Od1Result) => (h5.status === "complete" ? h5.R : null);

export function buildPopulations(u: PreparedUniverse, settings: AppSettings, fence: string, topN = TOP_N): Populations {
  const sessions: string[] = [];
  const A: StockDay[] = [];
  const B: StockDay[] = [];
  const moversExcluded: Record<string, number> = {};
  let prevGainers = new Set<string>();
  for (let ci = 1; ci < u.calendar.length; ci++) {
    const date = u.calendar[ci];
    if (date >= fence) break;
    const day = moversOn(u, date);
    if (day.movers.length === 0) continue;
    sessions.push(date);
    for (const ex of day.excluded) moversExcluded[ex.reason] = (moversExcluded[ex.reason] ?? 0) + 1;
    const regime = marketContextAt(u, date, settings).regime.regime;
    for (const m of day.movers) {
      const up = m.changePct > 0;
      A.push({ date, symbol: m.stock.symbol, rank: null, changePct: m.changePct, label: null, category: null, regime, repeat: false, legacy: legacyFor(u, m.stock, m.i, fence), r5: null, h1: up ? od1For(u, m.stock, m.i, 1, true, fence) : { status: "pending", reason: "beyond-data" }, h5: up ? od1For(u, m.stock, m.i, 5, true, fence) : { status: "pending", reason: "beyond-data" } });
      if (up) A[A.length - 1].r5 = r5Of(A[A.length - 1].h5);
    }
    const ctx = makeBuildContext(u, date, settings, regime, day);
    const gainers = new Set<string>();
    rankMovers(day.movers, "gainer", topN).forEach((m, k) => {
      const c = buildCandidate(m, "gainer", k + 1, ctx);
      const h5 = od1For(u, m.stock, m.i, 5, true, fence);
      gainers.add(c.symbol);
      B.push({ date, symbol: c.symbol, rank: k + 1, changePct: m.changePct, label: c.label, category: c.assessment.category, regime, repeat: prevGainers.has(c.symbol), legacy: legacyFor(u, m.stock, m.i, fence), r5: r5Of(h5), h1: od1For(u, m.stock, m.i, 1, true, fence), h5 });
    });
    prevGainers = gainers;
  }
  const C = B.filter((o) => o.label === "possible-breakout");
  return {
    sessions,
    A,
    Aplus: A.filter((o) => o.changePct > 0),
    B,
    C,
    D: B.filter((o) => o.label === "momentum-continuation"),
    E: C.filter((o) => o.category === "continuation"),
    F: C.filter((o) => o.category !== "continuation"),
    moversExcluded,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------------------------------
const okLegacy = (rows: StockDay[]) => rows.flatMap((o) => (o.legacy.status === "ok" ? [{ date: o.date, symbol: o.symbol, repeat: o.repeat, outcome: o.legacy.outcome }] : []));
const ci95 = (rows: StockDay[], pred: (o: StockDay) => boolean) => {
  if (rows.length === 0) return { pct: null as number | null, ci: null as [number, number] | null };
  const r = clusteredMean(rows.map((o) => (pred(o) ? 100 : 0)), rows.map((o) => o.date), rows.map((o) => o.symbol));
  return { pct: r.mean, ci: r.ci };
};

export interface LegacySummary {
  n: number;
  excluded: Record<string, number>;
  stats: OutcomeStats | null;
  pctNegative: number | null;
  pctUnchanged: number | null;
  meanOpenToCloseGrossPct: number | null;
}
export function legacySummary(rows: StockDay[]): LegacySummary {
  const ok = okLegacy(rows);
  const excluded: Record<string, number> = {};
  for (const o of rows) if (o.legacy.status !== "ok") excluded[o.legacy.status] = (excluded[o.legacy.status] ?? 0) + 1;
  const n = ok.length;
  return {
    n,
    excluded,
    stats: computeOutcomeStats(ok),
    pctNegative: n ? (ok.filter((o) => o.outcome.closeToClosePct < 0).length / n) * 100 : null,
    pctUnchanged: n ? (ok.filter((o) => o.outcome.closeToClosePct === 0).length / n) * 100 : null,
    meanOpenToCloseGrossPct: n ? ok.reduce((s, o) => s + o.outcome.openToCloseNetPct, 0) / n + COST_BPS / 100 : null,
  };
}

export interface Od1Summary {
  stockDays: number;
  complete: number;
  unavailable: Record<string, number>;
  pending: Record<string, number>;
  coveragePct: number | null;
  counts: Record<Od1Class, number>;
  confirmed: { pct: number | null; ci: [number, number] | null };
  adverse: { pct: number | null; ci: [number, number] | null };
}
export function od1Summary(rows: StockDay[], key: "h1" | "h5"): Od1Summary {
  const complete = rows.filter((o) => o[key].status === "complete");
  const unavailable: Record<string, number> = {};
  const pending: Record<string, number> = {};
  for (const o of rows) {
    const r = o[key];
    if (r.status === "unavailable") unavailable[r.reason] = (unavailable[r.reason] ?? 0) + 1;
    if (r.status === "pending") pending[r.reason] = (pending[r.reason] ?? 0) + 1;
  }
  const nU = Object.values(unavailable).reduce((a, b) => a + b, 0);
  const counts = { confirmed: 0, partial: 0, sideways: 0, failed: 0, reversal: 0 } as Record<Od1Class, number>;
  for (const o of complete) counts[(o[key] as { cls: Od1Class }).cls] += 1;
  const cls = (o: StockDay) => (o[key] as { cls: Od1Class }).cls;
  return {
    stockDays: rows.length,
    complete: complete.length,
    unavailable,
    pending,
    coveragePct: complete.length + nU ? (complete.length / (complete.length + nU)) * 100 : null,
    counts,
    confirmed: ci95(complete, (o) => cls(o) === "confirmed"),
    adverse: ci95(complete, (o) => cls(o) === "failed" || cls(o) === "reversal"),
  };
}

export function r5Summary(rows: StockDay[]) {
  const v = rows.filter((o) => o.r5 !== null);
  if (!v.length) return null;
  const vals = v.map((o) => o.r5 as number);
  const sorted = [...vals].sort((a, b) => a - b);
  const m = clusteredMean(vals, v.map((o) => o.date), v.map((o) => o.symbol));
  return { n: v.length, up: ci95(v, (o) => (o.r5 as number) > 0), meanPct: m.mean, meanCi: m.ci, medianPct: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2 };
}

/** mulberry32: small deterministic PRNG for the bootstrap. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Metric = (rows: StockDay[]) => number | null;
const share = (rows: StockDay[], pred: (o: StockDay) => boolean) => (rows.length ? (rows.filter(pred).length / rows.length) * 100 : null);
const od1Rows = (rows: StockDay[], key: "h1" | "h5") => rows.filter((o) => o[key].status === "complete");
const isCls = (key: "h1" | "h5", set: Od1Class[]) => (o: StockDay) => set.includes((o[key] as { cls: Od1Class }).cls);
export const METRICS: Record<string, Metric> = {
  "t+1 close-to-close up (pp)": (r) => share(r.filter((o) => o.legacy.status === "ok"), (o) => (o.legacy as { outcome: NextSessionOutcome }).outcome.closeToClosePct > 0),
  "t+1 mean close-to-close (pp)": (r) => {
    const ok = okLegacy(r);
    return ok.length ? ok.reduce((s, o) => s + o.outcome.closeToClosePct, 0) / ok.length : null;
  },
  "t+1 mean open-to-close net (pp)": (r) => {
    const ok = okLegacy(r);
    return ok.length ? ok.reduce((s, o) => s + o.outcome.openToCloseNetPct, 0) / ok.length : null;
  },
  "OD1 h1 confirmed (pp)": (r) => share(od1Rows(r, "h1"), isCls("h1", ["confirmed"])),
  "OD1 h1 adverse (pp)": (r) => share(od1Rows(r, "h1"), isCls("h1", ["failed", "reversal"])),
  "OD1 h5 confirmed (pp)": (r) => share(od1Rows(r, "h5"), isCls("h5", ["confirmed"])),
  "OD1 h5 adverse (pp)": (r) => share(od1Rows(r, "h5"), isCls("h5", ["failed", "reversal"])),
};

/** Difference metric(X) - metric(Y) with a percentile interval from resampling whole sessions (dates) with replacement. */
export function bootstrapDiff(X: StockDay[], Y: StockDay[], metric: Metric, seed: number = BOOTSTRAP.seed, reps: number = BOOTSTRAP.reps) {
  const point = (() => {
    const a = metric(X);
    const b = metric(Y);
    return a === null || b === null ? null : a - b;
  })();
  const dates = [...new Set([...X, ...Y].map((o) => o.date))].sort();
  const group = (rows: StockDay[]) => {
    const m = new Map<string, StockDay[]>();
    for (const o of rows) (m.get(o.date) ?? m.set(o.date, []).get(o.date)!).push(o);
    return m;
  };
  const gx = group(X);
  const gy = group(Y);
  const rnd = mulberry32(seed);
  const draws: number[] = [];
  let skipped = 0;
  for (let r = 0; r < reps; r++) {
    const xs: StockDay[] = [];
    const ys: StockDay[] = [];
    for (let k = 0; k < dates.length; k++) {
      const d = dates[Math.floor(rnd() * dates.length)];
      xs.push(...(gx.get(d) ?? []));
      ys.push(...(gy.get(d) ?? []));
    }
    const a = metric(xs);
    const b = metric(ys);
    if (a === null || b === null) skipped += 1;
    else draws.push(a - b);
  }
  draws.sort((a, b) => a - b);
  const q = (p: number) => (draws.length ? draws[Math.min(draws.length - 1, Math.floor(p * draws.length))] : null);
  return { diff: point, ci: [q((1 - BOOTSTRAP.level) / 2), q(1 - (1 - BOOTSTRAP.level) / 2)] as [number | null, number | null], reps, skipped, nX: X.length, nY: Y.length, sessionsX: new Set(X.map((o) => o.date)).size, sessionsY: new Set(Y.map((o) => o.date)).size };
}

// ---------------------------------------------------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------------------------------------------------
export const POPULATIONS = ["A", "Aplus", "B", "C", "D", "E", "F"] as const;
export type PopKey = (typeof POPULATIONS)[number];
export const POPULATION_TEXT: Record<PopKey, string> = {
  A: "A  All eligible universe stock-days",
  Aplus: "A+ Eligible stocks that closed higher on the day",
  B: "B  Top-50 gainers",
  C: "C  Possible breakout setup",
  D: "D  Momentum continuation candidate",
  E: "E  Breakout AND Continuation characteristics",
  F: "F  Breakout WITHOUT Continuation characteristics",
};

export function runBaseline(u: PreparedUniverse, settings: AppSettings, fence: string) {
  const p = buildPopulations(u, settings, fence);
  const nB = p.B.length;
  const population = Object.fromEntries(
    POPULATIONS.map((k) => {
      const rows = p[k];
      return [
        k,
        {
          stockDays: rows.length,
          sessions: new Set(rows.map((o) => o.date)).size,
          stocks: new Set(rows.map((o) => o.symbol)).size,
          perSession: rows.length / p.sessions.length,
          shareOfTop50Pct: (rows.length / nB) * 100,
          legacy: legacySummary(rows),
          r5: k === "A" ? null : r5Summary(rows),
          od1h1: k === "A" ? null : od1Summary(rows, "h1"),
          od1h5: k === "A" ? null : od1Summary(rows, "h5"),
        },
      ];
    }),
  );
  const compare = (x: PopKey, y: PopKey) => Object.fromEntries(Object.entries(METRICS).map(([name, m]) => [name, bootstrapDiff(p[x], p[y], m)]));
  const comparisons = { "E-F": compare("E", "F"), "E-C": compare("E", "C"), "E-B": compare("E", "B"), "E-Aplus": compare("E", "Aplus") };

  const third = (() => {
    const s = [...new Set(p.B.map((o) => o.date))].sort();
    const cuts = [s[Math.floor(s.length / 3)], s[Math.floor((2 * s.length) / 3)]];
    return { cuts, of: (d: string) => (d < cuts[0] ? 1 : d < cuts[1] ? 2 : 3) };
  })();
  const thirds = Object.fromEntries(
    (["B", "C", "E", "F"] as const).map((k) => [
      k,
      [1, 2, 3].map((t) => {
        const rows = p[k].filter((o) => third.of(o.date) === t);
        return { third: t, stockDays: rows.length, sessions: new Set(rows.map((o) => o.date)).size, ...Object.fromEntries(Object.entries(METRICS).map(([n, m]) => [n, m(rows)])) };
      }),
    ]),
  );

  // Pre-registered hypotheses, evaluated here on HISTORICAL data only (exploratory, in-sample; see the document).
  const h1Bear = p.C.filter((o) => o.regime === "bearish");
  const h1Other = p.C.filter((o) => o.regime === "bullish" || o.regime === "sideways");
  const h3Big = p.C.filter((o) => o.changePct >= 10);
  const h3Rest = p.C.filter((o) => o.changePct < 10);
  const hyp = (X: StockDay[], Y: StockDay[]) => ({ adverseH1: bootstrapDiff(X, Y, METRICS["OD1 h1 adverse (pp)"]), adverseH5: bootstrapDiff(X, Y, METRICS["OD1 h5 adverse (pp)"]) });
  const hypotheses = {
    H1: { contrast: "C with regime bearish minus C with regime bullish|sideways", excludedInsufficientRegime: p.C.filter((o) => o.regime === "insufficient-data").length, ...hyp(h1Bear, h1Other) },
    H2: { contrast: "F minus E", ...hyp(p.F, p.E) },
    H3: { contrast: "C with changePct >= 10 minus C with changePct < 10", ...hyp(h3Big, h3Rest) },
  };

  // Consistency invariants (throw: a silent inconsistency would invalidate the baseline).
  const key = (o: StockDay) => `${o.date}|${o.symbol}`;
  const setOf = (rows: StockDay[]) => new Set(rows.map(key));
  const sC = setOf(p.C);
  if (p.E.length + p.F.length !== p.C.length || p.E.some((o) => !sC.has(key(o))) || p.F.some((o) => !sC.has(key(o)))) throw new Error("E and F do not partition C");
  if (p.D.some((o) => sC.has(key(o)))) throw new Error("C and D overlap (labels are first-match exclusive)");
  if (setOf(p.B).size !== p.B.length) throw new Error("duplicate stock-day in B");
  const perSession = new Map<string, number>();
  for (const o of p.B) perSession.set(o.date, (perSession.get(o.date) ?? 0) + 1);
  if ([...perSession.values()].some((n) => n > TOP_N)) throw new Error(`more than ${TOP_N} gainers in a session`);
  for (const rows of [p.A, p.B]) for (const o of rows) {
    if (o.date >= fence) throw new Error(`observation ${key(o)} is on or after the fence`);
    if (o.legacy.status === "ok" && o.legacy.outcome.nextDate >= fence) throw new Error(`legacy outcome of ${key(o)} crosses the fence`);
    for (const h of [o.h1, o.h5]) if (h.status === "complete" && h.endDate >= fence) throw new Error(`OD1 outcome of ${key(o)} crosses the fence`);
  }

  return {
    sessions: { count: p.sessions.length, first: p.sessions[0] ?? null, last: p.sessions[p.sessions.length - 1] ?? null },
    moversExcluded: p.moversExcluded,
    population,
    comparisons,
    thirds: { cuts: third.cuts, rows: thirds },
    hypotheses,
    populations: p,
  };
}

/** Cross-check: the legacy subset of B must equal the production evaluation's top-50 gainer observations exactly. */
export function crossCheckWithProductionEvaluation(u: PreparedUniverse, settings: AppSettings, B: StockDay[], fence: string) {
  const ev = runMomentumEvaluation(u, settings, { topN: TOP_N, costBps: COST_BPS });
  const prod = ev.observations.filter((o) => o.group === "gainer" && o.date < fence && o.outcome.nextDate < fence);
  const mine = B.filter((o) => o.legacy.status === "ok");
  const a = new Map(prod.map((o) => [`${o.date}|${o.symbol}`, o]));
  const mismatches: string[] = [];
  if (prod.length !== mine.length) mismatches.push(`count ${mine.length} vs production ${prod.length}`);
  for (const o of mine) {
    const q = a.get(`${o.date}|${o.symbol}`);
    if (!q) mismatches.push(`missing in production: ${o.date}|${o.symbol}`);
    else if (q.label !== o.label || q.category !== o.category || q.repeat !== o.repeat || q.outcome.closeToClosePct !== (o.legacy as { outcome: NextSessionOutcome }).outcome.closeToClosePct) mismatches.push(`differs: ${o.date}|${o.symbol}`);
    if (mismatches.length > 20) break;
  }
  return { productionObservations: prod.length, baselineObservations: mine.length, mismatches };
}

/** Stable digest of a result (numbers rounded to 12 significant digits so the digest is about values, not printing). */
export function resultDigest(value: unknown): string {
  const canon = (v: unknown): unknown => {
    if (typeof v === "number") return Number.isFinite(v) ? Number(v.toPrecision(12)) : String(v);
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
    return v;
  };
  return createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");
}

// ---------------------------------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------------------------------
const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || Number.isNaN(x) ? "n/a" : x.toFixed(d));
const fci = (c: [number | null, number | null] | [number, number] | null | undefined, d = 1) => (c && c[0] !== null && c[1] !== null ? `[${(c[0] as number).toFixed(d)}, ${(c[1] as number).toFixed(d)}]` : "[n/a]");

async function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const commit = opt("--commit") ?? DATA_COMMIT;
  const out = opt("--out");
  if (out && path.resolve(out).startsWith(path.join(repoRoot, "public") + path.sep)) throw new Error("--out must not write under public/");

  const enabledFrom = assertFenceMatchesActivation(repoRoot, FENCE);
  const { computeVersion } = await import("../ledger/capture.mts");
  const { ruleVersion } = await computeVersion(repoRoot);
  if (ruleVersion !== EXPECTED_RULE_VERSION) throw new Error(`production rule version is ${ruleVersion}, expected ${EXPECTED_RULE_VERSION}; this baseline is defined for ${EXPECTED_RULE_VERSION} only`);

  const { dataset, activity, files } = loadPinnedMarketData(repoRoot, commit, FENCE);
  const u = prepareUniverse(dataset, activity);
  if (u.calendar.some((d) => d >= FENCE)) throw new Error("trading calendar reaches the fence");
  const settings = structuredClone(DEFAULT_SETTINGS);
  const r = runBaseline(u, settings, FENCE);
  const cross = crossCheckWithProductionEvaluation(u, settings, r.populations.B, FENCE);
  if (cross.mismatches.length) throw new Error(`baseline does not match the production evaluation: ${cross.mismatches.slice(0, 5).join("; ")}`);

  const { populations: _drop, ...summary } = r;
  void _drop;
  const meta = {
    fence: FENCE,
    enabledFromRecords: enabledFrom,
    dataCommit: commit,
    latestMarketDate: dataset.manifest.latestMarketDate,
    files,
    ruleVersion,
    topN: TOP_N,
    costBps: COST_BPS,
    bootstrap: BOOTSTRAP,
    od1: OD1,
    settings,
    momentumRules: MOMENTUM_RULES,
    assessmentRules: ASSESSMENT_RULES,
    universeSize: u.stocks.length,
    calendar: { first: u.calendar[0], last: u.calendar[u.calendar.length - 1], sessions: u.calendar.length },
    crossCheck: cross,
  };
  const digest = resultDigest(summary);

  const log = console.log;
  log(`Breakout research baseline (exploratory). Data commit ${commit} (latest ${meta.latestMarketDate}); fence ${FENCE}; rule version ${ruleVersion}`);
  log(`Sessions ${r.sessions.count} (${r.sessions.first}..${r.sessions.last}); universe ${meta.universeSize}; cross-check vs production evaluation: ${cross.baselineObservations} = ${cross.productionObservations} observations, 0 mismatches`);
  log(`Movers not ranked (discontinuity days): ${JSON.stringify(r.moversExcluded)}`);
  for (const k of POPULATIONS) {
    const s = r.population[k];
    const L = s.legacy.stats;
    log(`\n### ${POPULATION_TEXT[k]}`);
    log(`  stock-days=${s.stockDays} sessions=${s.sessions} stocks=${s.stocks} perSession=${f(s.perSession, 2)} shareOfTop50=${f(s.shareOfTop50Pct)}%`);
    log(`  legacy t+1 (n=${s.legacy.n}; excluded ${JSON.stringify(s.legacy.excluded)}): up=${f(L?.pctPositive)}% ${fci(L?.pctPositiveCi)} down=${f(s.legacy.pctNegative)}% unchanged=${f(s.legacy.pctUnchanged, 2)}% mean=${f(L?.meanPct, 2)}% ${fci(L?.meanCi, 2)} median=${f(L?.medianPct, 2)}%`);
    log(`  t+1 open->close: gross=${f(s.legacy.meanOpenToCloseGrossPct, 2)}% net of ${COST_BPS} bps=${f(L?.meanOpenToCloseNetPct, 2)}% (net positive ${f(L?.pctOpenToCloseNetPositive)}%)  ${L?.sufficient === false ? "[INSUFFICIENT " + L.insufficientReason + "]" : ""}`);
    if (s.r5) log(`  5-session close-to-close (n=${s.r5.n}): up=${f(s.r5.up.pct)}% ${fci(s.r5.up.ci)} mean=${f(s.r5.meanPct, 2)}% ${fci(s.r5.meanCi, 2)} median=${f(s.r5.medianPct, 2)}%`);
    for (const [h, o] of [["h1", s.od1h1], ["h5", s.od1h5]] as const)
      if (o) log(`  OD1 ${h}: complete=${o.complete} unavailable=${JSON.stringify(o.unavailable)} pending=${JSON.stringify(o.pending)} coverage=${f(o.coveragePct)}%  confirmed=${f(o.confirmed.pct)}% ${fci(o.confirmed.ci)}  adverse=${f(o.adverse.pct)}% ${fci(o.adverse.ci)}  ${JSON.stringify(o.counts)}`);
  }
  log(`\n=== Comparisons: first minus second, 95% session-bootstrap interval (seed ${BOOTSTRAP.seed}, ${BOOTSTRAP.reps} resamples)`);
  for (const [name, c] of Object.entries(r.comparisons)) for (const [m, d] of Object.entries(c)) log(`  ${name.padEnd(8)} ${m.padEnd(32)} ${d.diff === null ? "n/a" : (d.diff >= 0 ? "+" : "") + d.diff.toFixed(2)} ${fci(d.ci, 2)}  (n ${d.nX} vs ${d.nY}; sessions ${d.sessionsX} vs ${d.sessionsY}${d.skipped ? `; ${d.skipped} empty resamples` : ""})`);
  log(`\n=== Chronological thirds (cuts ${r.thirds.cuts.join(", ")})`);
  for (const [k, rows] of Object.entries(r.thirds.rows)) for (const t of rows) log(`  ${k} T${t.third}: stock-days=${t.stockDays} sessions=${t.sessions} ${Object.entries(t).filter(([n]) => n.includes("(")).map(([n, v]) => `${n.replace(/ \(pp\)/, "")}=${f(v as number | null, 2)}`).join(" ")}`);
  log(`\n=== Pre-registered hypotheses on HISTORICAL data (exploratory, in-sample)`);
  for (const [h, x] of Object.entries(r.hypotheses)) log(`  ${h} ${x.contrast}: h1 adverse ${f(x.adverseH1.diff, 2)} ${fci(x.adverseH1.ci, 2)} (n ${x.adverseH1.nX} vs ${x.adverseH1.nY}); h5 adverse ${f(x.adverseH5.diff, 2)} ${fci(x.adverseH5.ci, 2)}`);
  log(`\nresult digest (sha256): ${digest}`);
  if (out) {
    writeFileSync(out, JSON.stringify({ meta, digest, ...summary }, null, 1) + "\n");
    log(`written ${out}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`::error::breakout baseline refused or failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
