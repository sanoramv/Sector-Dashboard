/**
 * Breakout characteristics study (Track A, experiments 1-4) - EXPLORATORY, historical, read-only.
 *
 *   npx tsx scripts/research/breakout-characteristics.mts --out <file outside public/>.json [--reps 1000]
 *     [--export-dashboard public/data/evaluation/historical-mv1-8ecef864.json]
 *
 * Plan (pre-declared, committed before any result): docs/research/BREAKOUT_CHARACTERISTICS.md section 1.
 * Data, fence and safety are those of the Phase 1B baseline (breakout-baseline.mts): one pinned commit read with
 * `git show`, every observation and outcome date before FENCE, production functions and rule version mv1-8ecef864.
 * Outcomes use the shared frozen OD1 engine at h = 1, 2, 5, 10.
 */
import path from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppSettings } from "../../src/types/config.ts";
import type { Regime } from "../../src/types/metrics.ts";
import type { EvidenceCategory, MomentumCandidate, MomentumLabel, SizeSegment } from "../../src/types/momentum.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { prepareUniverse, type PreparedUniverse, type UniverseStock } from "../../src/lib/momentum/universe.ts";
import { moversOn, rankMovers, makeBuildContext, buildCandidate } from "../../src/lib/momentum/discovery.ts";
import { marketContextAt } from "../../src/lib/momentum/market.ts";
import { MOMENTUM_RULES, insufficientEvidenceReasons } from "../../src/lib/momentum/classify.ts";
import { ASSESSMENT_RULES } from "../../src/lib/momentum/assess.ts";
import { DATA_COMMIT, EXPECTED_RULE_VERSION, FENCE, assertFenceMatchesActivation, loadPinnedMarketData, mulberry32, od1For, type Od1Result } from "./breakout-baseline.mts";

export const HORIZONS = [1, 2, 5, 10] as const;
export type H = (typeof HORIZONS)[number];
export const SEED = 20261124;
export const BLOCK = 10;
export const COSTS_BPS = [10, 20, 40] as const;
export const FDR_Q = 0.1;
/** Minimum stock-days on each side of an Exp 2 primary contrast (deviation from the plan, see the study document). */
export const MIN_CONTRAST_N = 30;

// ---------------------------------------------------------------------------------------------------------------------
// Rows: every eligible gainer stock-day, with features and outcomes
// ---------------------------------------------------------------------------------------------------------------------
export interface Outcome {
  status: "complete" | "unavailable" | "pending";
  reason?: string;
  cls?: string;
  R?: number;
  X?: number;
  /** tradable gross return, %: open(t+1) -> close(t+h) */
  T?: number;
}
export interface Row {
  date: string;
  s: number; // session index
  symbol: string;
  rank: number; // among all gainers that day
  changePct: number;
  label: MomentumLabel;
  category: EvidenceCategory;
  total: number;
  comp: Record<string, number | null>;
  regime: Regime;
  segment: SizeSegment | null;
  f: Record<string, number | boolean | string | null>;
  out: Record<H, Outcome>;
  rawBreakout: boolean;
  /** inputs to re-derive the label under ablation */
  gate: { insufficient: boolean; cl: number | null; rvol: number | null; d20: number | null; r5: number | null; breakout: boolean | null; above50: number | null; rs: number | null };
}

const val = <T,>(m: { available: true; value: T } | { available: false }): T | null => (m.available ? m.value : null);

function tradable(u: PreparedUniverse, stock: UniverseStock, i: number, h: number): number | null {
  const ci = u.calendarIndex.get(stock.bars[i].date)!;
  const j1 = stock.indexByDate.get(u.calendar[ci + 1]);
  const jh = stock.indexByDate.get(u.calendar[ci + h]);
  if (j1 === undefined || jh === undefined) return null;
  const a = stock.bars[j1].open;
  const b = stock.bars[jh].close;
  return a > 0 ? (b / a - 1) * 100 : null;
}

function outcomeOf(r: Od1Result, t: number | null): Outcome {
  if (r.status === "complete") return { status: "complete", cls: r.cls, R: r.R, X: r.X, T: t ?? undefined };
  return { status: r.status, reason: r.reason };
}

function features(c: MomentumCandidate, stock: UniverseStock, i: number): Row["f"] {
  const res = c.patterns.resistance.available ? c.patterns.resistance.value : null;
  const levelIdx = res ? stock.indexByDate.get(res.levelDate) : undefined;
  const cons = c.patterns.consolidationBefore.available ? c.patterns.consolidationBefore.value : null;
  const tri = c.patterns.triangleBefore.available ? c.patterns.triangleBefore.value : null;
  const del = c.activity.deliveryPct;
  const avgDel = val(c.activity.avgDeliveryPct20);
  return {
    rvol: val(c.activity.relativeVolume),
    change: c.price.dailyChangePct,
    closeLoc: c.price.closeLocation,
    distRes: res ? res.distancePct : null,
    gap: c.price.gapPct,
    moveZ: val(c.price.moveZ),
    consRatio: cons ? cons.contractionRatio : null,
    baseLen: levelIdx !== undefined ? i - levelIdx : null,
    body: c.price.bodyShare,
    upperWick: c.price.upperWickShare,
    delivery: del,
    deliveryVsAvg: del !== null && avgDel !== null ? del - avgDel : null,
    turnover: val(c.activity.medianTurnover20Cr),
    sectorRs: c.context.sectorIndex ? val(c.context.sectorIndex.relativeStrength1m) : "none",
    industryRs: val(c.context.industryRelativeStrength1m),
    stockRs: val(c.context.relativeStrength1m),
    d20: val(c.price.distSma20Pct),
    r5: val(c.price.r5),
    vol20: val(c.price.volatility20),
    consolidating: cons ? cons.isConsolidating : null,
    triangle: tri ? tri.detected : null,
    retest: c.patterns.retest !== null,
    sectorWide: c.context.moveScope === "unknown" ? null : c.context.moveScope === "sector-wide",
    above50: val(c.price.distSma50Pct) === null ? null : (val(c.price.distSma50Pct) as number) > 0,
    above200: val(c.price.distSma200Pct) === null ? null : (val(c.price.distSma200Pct) as number) > 0,
  };
}

/** `range` (optional, used by the historical validation): only sessions with from <= date < to are built. */
export function buildRows(u: PreparedUniverse, settings: AppSettings, fence: string, range?: { from: string; to: string }): { rows: Row[]; sessions: string[] } {
  const rows: Row[] = [];
  const sessions: string[] = [];
  for (let ci = 1; ci < u.calendar.length; ci++) {
    const date = u.calendar[ci];
    if (date >= fence) break;
    if (range && (date < range.from || date >= range.to)) continue;
    const day = moversOn(u, date);
    if (day.movers.length === 0) continue;
    const s = sessions.length;
    sessions.push(date);
    const regime = marketContextAt(u, date, settings).regime.regime;
    const ctx = makeBuildContext(u, date, settings, regime, day);
    rankMovers(day.movers, "gainer", Number.MAX_SAFE_INTEGER).forEach((m, k) => {
      const c = buildCandidate(m, "gainer", k + 1, ctx);
      const out = {} as Record<H, Outcome>;
      for (const h of HORIZONS) {
        const r = od1For(u, m.stock, m.i, h, true, fence);
        out[h] = outcomeOf(r, r.status === "complete" ? tradable(u, m.stock, m.i, h) : null);
      }
      const comp: Record<string, number | null> = {};
      for (const x of c.assessment.components) comp[x.dimension] = x.score;
      rows.push({
        date,
        s,
        symbol: c.symbol,
        rank: k + 1,
        changePct: m.changePct,
        label: c.label,
        category: c.assessment.category,
        total: c.assessment.total,
        comp,
        regime,
        segment: c.segment,
        f: features(c, m.stock, m.i),
        out,
        rawBreakout: c.patterns.breakoutToday === true,
        gate: {
          insufficient: insufficientEvidenceReasons(c).length > 0,
          cl: c.price.closeLocation,
          rvol: val(c.activity.relativeVolume),
          d20: val(c.price.distSma20Pct),
          r5: val(c.price.r5),
          breakout: c.patterns.breakoutToday,
          above50: val(c.price.distSma50Pct),
          rs: val(c.context.relativeStrength1m),
        },
      });
    });
  }
  return { rows, sessions };
}

// ---------------------------------------------------------------------------------------------------------------------
// Label and category re-derivation (ablation). Must reproduce production exactly with nothing dropped.
// ---------------------------------------------------------------------------------------------------------------------
export type Drop = "strong-close" | "volume-confirm" | "extended-gate" | "close-and-volume";
export function breakoutWith(r: Row, drop: Drop | null): boolean {
  const R = MOMENTUM_RULES;
  const g = r.gate;
  if (g.insufficient) return false;
  const cl = g.cl as number;
  const rvol = g.rvol as number;
  const extended = (g.d20 !== null && g.d20 >= R.extendedFromSma20Pct) || (g.r5 !== null && g.r5 >= R.extended5dPct);
  if (extended && drop !== "extended-gate") return false;
  const weak = cl < R.fadeCloseLocation || rvol < R.lightVolumeRvol;
  if (weak && drop !== "close-and-volume") return false;
  const strongClose = drop === "strong-close" || drop === "close-and-volume" || cl >= R.strongCloseLocation;
  const volOk = drop === "volume-confirm" || drop === "close-and-volume" || rvol >= R.volumeConfirmRvol;
  return strongClose && volOk && g.breakout === true;
}
export function categoryWithout(r: Row, dim: string | null, minTotal: number = ASSESSMENT_RULES.continuationMinTotal): EvidenceCategory {
  if (r.category === "insufficient") return "insufficient";
  const sc = (d: string) => (d === dim ? 0 : (r.comp[d] ?? 0));
  const total = ["price-structure", "volume", "relative-strength", "market", "extension"].reduce((a, d) => a + sc(d), 0);
  const ext = r.comp["extension"] as number;
  const ps = r.comp["price-structure"] as number;
  const vol = r.comp["volume"] as number;
  const noPs = dim === "price-structure";
  if ((dim !== "extension" && ext <= -2) || (!noPs && ps <= -2) || (dim !== "extension" && ext <= -1 && total <= 0)) return "exhaustion-reversal";
  if (total >= minTotal && (noPs || ps >= 1) && (dim === "volume" || vol >= 1)) return "continuation";
  return "mixed";
}

// ---------------------------------------------------------------------------------------------------------------------
// Statistics: per-session sums, moving-block bootstrap over sessions
// ---------------------------------------------------------------------------------------------------------------------
type Val = (r: Row, h: H) => number | null;
const isAdverse = (o: Outcome) => o.cls === "failed" || o.cls === "reversal";
export const METRIC: Record<string, Val> = {
  adverse: (r, h) => (r.out[h].status === "complete" ? (isAdverse(r.out[h]) ? 100 : 0) : null),
  confirmed: (r, h) => (r.out[h].status === "complete" ? (r.out[h].cls === "confirmed" ? 100 : 0) : null),
  hitR: (r, h) => (r.out[h].status === "complete" ? ((r.out[h].R as number) > 0 ? 100 : 0) : null),
  hitX: (r, h) => (r.out[h].status === "complete" ? ((r.out[h].X as number) > 0 ? 100 : 0) : null),
  meanR: (r, h) => (r.out[h].status === "complete" ? (r.out[h].R as number) : null),
  meanX: (r, h) => (r.out[h].status === "complete" ? (r.out[h].X as number) : null),
  net20: (r, h) => (r.out[h].T !== undefined ? (r.out[h].T as number) - 0.2 : null),
};
const CI_METRICS = ["adverse", "confirmed", "meanX", "net20"] as const;

export class Boot {
  readonly draws: Int32Array[];
  constructor(readonly S: number, reps: number, seed = SEED, block = BLOCK) {
    const rnd = mulberry32(seed);
    const nBlocks = Math.ceil(S / block);
    this.draws = [];
    for (let k = 0; k < reps; k++) {
      const d = new Int32Array(nBlocks * block);
      for (let b = 0; b < nBlocks; b++) {
        const start = Math.floor(rnd() * Math.max(1, S - block + 1));
        for (let j = 0; j < block; j++) d[b * block + j] = Math.min(S - 1, start + j);
      }
      this.draws.push(d.subarray(0, S));
    }
  }
}
export interface Sums {
  num: Float64Array;
  den: Float64Array;
}
export function sums(rows: Row[], S: number, v: (r: Row) => number | null): Sums {
  const num = new Float64Array(S);
  const den = new Float64Array(S);
  for (const r of rows) {
    const x = v(r);
    if (x === null || !Number.isFinite(x)) continue;
    num[r.s] += x;
    den[r.s] += 1;
  }
  return { num, den };
}
export const ratio = (a: Sums, idx?: Int32Array) => {
  let n = 0;
  let d = 0;
  if (idx) for (let k = 0; k < idx.length; k++) (n += a.num[idx[k]]), (d += a.den[idx[k]]);
  else for (let k = 0; k < a.num.length; k++) (n += a.num[k]), (d += a.den[k]);
  return d > 0 ? n / d : null;
};
export const pctile = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1) + 0.5)))] : null;
};
export interface Est {
  v: number | null;
  ci: [number, number] | null;
  n: number;
}
export function est(a: Sums, boot: Boot | null): Est {
  const v = ratio(a);
  const n = a.den.reduce((x, y) => x + y, 0);
  if (!boot || v === null) return { v, ci: null, n };
  const xs = boot.draws.map((d) => ratio(a, d)).filter((x): x is number => x !== null);
  return { v, ci: [pctile(xs, 0.025)!, pctile(xs, 0.975)!], n };
}
export interface Diff {
  d: number | null;
  ci: [number, number] | null;
  p: number | null;
  nX: number;
  nY: number;
}
export function diff(a: Sums, b: Sums, boot: Boot): Diff {
  const x = ratio(a);
  const y = ratio(b);
  const nX = a.den.reduce((p, q) => p + q, 0);
  const nY = b.den.reduce((p, q) => p + q, 0);
  if (x === null || y === null) return { d: null, ci: null, p: null, nX, nY };
  const ds: number[] = [];
  for (const dr of boot.draws) {
    const p = ratio(a, dr);
    const q = ratio(b, dr);
    if (p !== null && q !== null) ds.push(p - q);
  }
  const le = ds.filter((z) => z <= 0).length / ds.length;
  const ge = ds.filter((z) => z >= 0).length / ds.length;
  return { d: x - y, ci: [pctile(ds, 0.025)!, pctile(ds, 0.975)!], p: Math.min(1, 2 * Math.min(le, ge)), nX, nY };
}
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Full summary of one group: frequency, coverage, class mix and metrics per horizon. */
export function summarise(rows: Row[], S: number, boot: Boot | null) {
  const sess = new Set(rows.map((r) => r.s));
  const perH: Record<string, unknown> = {};
  for (const h of HORIZONS) {
    const complete = rows.filter((r) => r.out[h].status === "complete");
    const unavailable: Record<string, number> = {};
    let pending = 0;
    for (const r of rows) {
      if (r.out[h].status === "unavailable") unavailable[r.out[h].reason!] = (unavailable[r.out[h].reason!] ?? 0) + 1;
      if (r.out[h].status === "pending") pending += 1;
    }
    const nUn = Object.values(unavailable).reduce((a, b) => a + b, 0);
    const classes: Record<string, number> = {};
    for (const r of complete) classes[r.out[h].cls!] = (classes[r.out[h].cls!] ?? 0) + 1;
    const m: Record<string, Est> = {};
    for (const k of Object.keys(METRIC)) m[k] = est(sums(rows, S, (r) => METRIC[k](r, h)), (CI_METRICS as readonly string[]).includes(k) ? boot : null);
    const net = (bps: number) => ratio(sums(rows, S, (r) => (r.out[h].T !== undefined ? (r.out[h].T as number) - bps / 100 : null)));
    perH[`h${h}`] = {
      complete: complete.length,
      unavailable,
      pending,
      coveragePct: complete.length + nUn ? (100 * complete.length) / (complete.length + nUn) : null,
      classes,
      ...m,
      medianR: median(complete.map((r) => r.out[h].R as number)),
      medianX: median(complete.map((r) => r.out[h].X as number)),
      medianNet20: median(complete.filter((r) => r.out[h].T !== undefined).map((r) => (r.out[h].T as number) - 0.2)),
      net10: net(10),
      net40: net(40),
    };
  }
  return { stockDays: rows.length, sessions: sess.size, perSession: S ? rows.length / S : 0, ...perH };
}

/** Matched (same session x stratum) effect: breakout outcome minus the mean of same-stratum controls. */
export function matchedEffect(treated: Row[], controls: Row[], S: number, boot: Boot, stratum: (r: Row) => string) {
  const out: Record<string, Record<string, Est>> = {};
  for (const h of HORIZONS) {
    out[`h${h}`] = {};
    for (const k of CI_METRICS) {
      const ctl = new Map<string, { n: number; d: number }>();
      for (const r of controls) {
        const x = METRIC[k](r, h);
        if (x === null) continue;
        const key = `${r.s}|${stratum(r)}`;
        const e = ctl.get(key) ?? { n: 0, d: 0 };
        e.n += x;
        e.d += 1;
        ctl.set(key, e);
      }
      const ex = sums(treated, S, (r) => {
        const x = METRIC[k](r, h);
        const e = ctl.get(`${r.s}|${stratum(r)}`);
        return x === null || !e ? null : x - e.n / e.d;
      });
      out[`h${h}`][k] = est(ex, boot);
    }
  }
  return out;
}

export const CHANGE_BUCKETS = [0, 2, 4, 6, 10];
export const bucketOf = (x: number, cuts: number[]) => {
  let k = 0;
  for (let j = 0; j < cuts.length; j++) if (x >= cuts[j]) k = j;
  return k;
};

// Pre-declared bins (docs/research/BREAKOUT_CHARACTERISTICS.md 1.5): lower edges; first bin open below.
export const BINS: Record<string, { cuts: number[]; labels: string[]; isNew?: boolean }> = {
  rvol: { cuts: [-Infinity, 1, 1.5, 2, 3, 5], labels: ["<1", "1-1.5", "1.5-2", "2-3", "3-5", ">=5"] },
  change: { cuts: [-Infinity, 2, 4, 6, 10], labels: ["0-2", "2-4", "4-6", "6-10", ">=10"] },
  closeLoc: { cuts: [-Infinity, 0.5, 0.7, 0.8, 0.9], labels: ["<0.5", "0.5-0.7", "0.7-0.8", "0.8-0.9", ">=0.9"] },
  distRes: { cuts: [-Infinity, 1, 2, 4, 7], labels: ["0-1", "1-2", "2-4", "4-7", ">=7"] },
  gap: { cuts: [-Infinity, 0, 1, 2, 4], labels: ["<0", "0-1", "1-2", "2-4", ">=4"] },
  moveZ: { cuts: [-Infinity, 1.5, 2, 3, 4], labels: ["<1.5", "1.5-2", "2-3", "3-4", ">=4"] },
  consRatio: { cuts: [-Infinity, 0.6, 0.8, 1.0, 1.2], labels: ["<0.6", "0.6-0.8", "0.8-1.0", "1.0-1.2", ">=1.2"] },
  baseLen: { cuts: [-Infinity, 6, 21, 41], labels: ["1-5", "6-20", "21-40", "41-60"], isNew: true },
  body: { cuts: [-Infinity, 0.5, 0.7, 0.85], labels: ["<0.5", "0.5-0.7", "0.7-0.85", ">=0.85"] },
  upperWick: { cuts: [-Infinity, 0.1, 0.2, 0.3], labels: ["<0.1", "0.1-0.2", "0.2-0.3", ">=0.3"] },
  delivery: { cuts: [-Infinity, 30, 45, 60], labels: ["<30", "30-45", "45-60", ">=60"] },
  deliveryVsAvg: { cuts: [-Infinity, -10, 0, 10], labels: ["<-10", "-10-0", "0-10", ">=10"], isNew: true },
  turnover: { cuts: [-Infinity, 1, 5, 25, 100], labels: ["<1", "1-5", "5-25", "25-100", ">=100"] },
  sectorRs: { cuts: [-Infinity, -3, 0, 3], labels: ["<-3", "-3-0", "0-3", ">=3"] },
  industryRs: { cuts: [-Infinity, -3, 0, 3], labels: ["<-3", "-3-0", "0-3", ">=3"] },
  stockRs: { cuts: [-Infinity, 0, 5, 15, 30], labels: ["<0", "0-5", "5-15", "15-30", ">=30"] },
  d20: { cuts: [-Infinity, 3, 6, 10, 15], labels: ["<3", "3-6", "6-10", "10-15", ">=15"], isNew: true },
  r5: { cuts: [-Infinity, 5, 10, 15, 20], labels: ["<5", "5-10", "10-15", "15-20", ">=20"], isNew: true },
  vol20: { cuts: [-Infinity, 1.5, 2.5, 3.5], labels: ["<1.5", "1.5-2.5", "2.5-3.5", ">=3.5"], isNew: true },
};
export const FLAGS = ["consolidating", "triangle", "retest", "sectorWide", "above50", "above200"] as const;

/** Bins of an ordinal feature; an empty bin is reported with n = 0. */
function binned(rows: Row[], key: string): Array<{ label: string; rows: Row[] }> {
  const b = BINS[key];
  const groups = b.labels.map((label) => ({ label, rows: [] as Row[] }));
  const na: Row[] = [];
  for (const r of rows) {
    const x = r.f[key];
    if (typeof x !== "number") na.push(r);
    else groups[bucketOf(x, b.cuts)].rows.push(r);
  }
  if (na.length) groups.push({ label: key === "sectorRs" ? "none/n.a." : "n.a.", rows: na });
  return groups;
}

// Benjamini-Hochberg
export function bh(ps: Array<number | null>, q: number): boolean[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((a, b) => a.p - b.p);
  const m = idx.length;
  let kMax = -1;
  idx.forEach((x, k) => {
    if (x.p <= ((k + 1) / m) * q) kMax = k;
  });
  const pass = ps.map(() => false);
  for (let k = 0; k <= kMax; k++) pass[idx[k].i] = true;
  return pass;
}

// ---------------------------------------------------------------------------------------------------------------------
// Experiments
// ---------------------------------------------------------------------------------------------------------------------
export function runStudy(rows: Row[], sessions: string[], reps: number) {
  const S = sessions.length;
  const boot = new Boot(S, reps);
  const half = Math.floor(S / 2);
  const BO_all = rows.filter((r) => r.label === "possible-breakout");
  const groups = {
    Aplus: rows,
    B: rows.filter((r) => r.rank <= 50),
    BO_all,
    BO_top50: BO_all.filter((r) => r.rank <= 50),
    BO_out: BO_all.filter((r) => r.rank > 50),
    RAW_BO: rows.filter((r) => r.rawBreakout),
    E: BO_all.filter((r) => r.category === "continuation"),
    F: BO_all.filter((r) => r.category !== "continuation"),
  };
  // check: label re-derivation reproduces production exactly
  const mismatch = rows.filter((r) => breakoutWith(r, null) !== (r.label === "possible-breakout")).length;
  const catMismatch = rows.filter((r) => categoryWithout(r, null) !== r.category).length;
  if (mismatch || catMismatch) throw new Error(`ablation re-derivation does not reproduce production (${mismatch} label, ${catMismatch} category mismatches)`);

  const summary = Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, summarise(g, S, boot)]));
  const nonBO = rows.filter((r) => r.label !== "possible-breakout");
  const liqT = [pctile(rows.map((r) => r.f.turnover).filter((x): x is number => typeof x === "number"), 1 / 3)!, pctile(rows.map((r) => r.f.turnover).filter((x): x is number => typeof x === "number"), 2 / 3)!];
  const liq = (r: Row) => (typeof r.f.turnover !== "number" ? "na" : r.f.turnover < liqT[0] ? "L" : r.f.turnover < liqT[1] ? "M" : "H");
  const chg = (r: Row) => String(bucketOf(r.changePct, CHANGE_BUCKETS));
  const matched = {
    M1_change: matchedEffect(BO_all, nonBO, S, boot, chg),
    M2_change_segment: matchedEffect(BO_all, nonBO, S, boot, (r) => `${chg(r)}|${r.segment}`),
    M3_change_liquidity: matchedEffect(BO_all, nonBO, S, boot, (r) => `${chg(r)}|${liq(r)}`),
    M1_top50: matchedEffect(groups.BO_top50, nonBO, S, boot, chg),
    M1_out: matchedEffect(groups.BO_out, nonBO, S, boot, chg),
  };
  // Exp 1: top-50 vs outside, overall and within the same change bucket; overextension profile
  const pairs: Record<string, Record<string, Diff>> = {};
  const pair = (name: string, X: Row[], Y: Row[]) => {
    pairs[name] = {};
    for (const h of HORIZONS) for (const k of CI_METRICS) pairs[name][`${k}_h${h}`] = diff(sums(X, S, (r) => METRIC[k](r, h)), sums(Y, S, (r) => METRIC[k](r, h)), boot);
  };
  pair("BO_top50 - BO_out", groups.BO_top50, groups.BO_out);
  pair("BO_all - B", BO_all, groups.B);
  pair("BO_all - Aplus", BO_all, rows);
  pair("BO_top50 - B", groups.BO_top50, groups.B);
  pair("E - F", groups.E, groups.F);
  const byChange = CHANGE_BUCKETS.map((_, k) => ({
    bucket: BINS.change.labels[k],
    top50: summarise(groups.BO_top50.filter((r) => bucketOf(r.changePct, CHANGE_BUCKETS) === k), S, null),
    out: summarise(groups.BO_out.filter((r) => bucketOf(r.changePct, CHANGE_BUCKETS) === k), S, null),
  }));
  const profile = (g: Row[]) => Object.fromEntries(["change", "d20", "r5", "moveZ", "distRes", "rvol", "turnover"].map((k) => [k, median(g.map((r) => r.f[k]).filter((x): x is number => typeof x === "number"))]));
  const overextension = { BO_top50: profile(groups.BO_top50), BO_out: profile(groups.BO_out), rankOfBreakouts: { median: median(BO_all.map((r) => r.rank)), p90: pctile(BO_all.map((r) => r.rank), 0.9) } };

  // Exp 2: characteristics within BO_all (and top-50), FDR over primary contrasts
  const exp2: Record<string, unknown> = {};
  const contrasts: Array<{ feature: string; metric: string; d: Diff; halves: [number | null, number | null] }> = [];
  const halfDiff = (X: Row[], Y: Row[], h: H, first: boolean) => {
    const keep = (r: Row) => (first ? r.s < half : r.s >= half);
    const a = ratio(sums(X.filter(keep), S, (r) => METRIC.adverse(r, h)));
    const b = ratio(sums(Y.filter(keep), S, (r) => METRIC.adverse(r, h)));
    return a === null || b === null ? null : a - b;
  };
  const addContrast = (feature: string, X: Row[], Y: Row[]) => {
    for (const h of [1, 5] as const) contrasts.push({ feature, metric: `adverse_h${h}`, d: diff(sums(X, S, (r) => METRIC.adverse(r, h)), sums(Y, S, (r) => METRIC.adverse(r, h)), boot), halves: [halfDiff(X, Y, h, true), halfDiff(X, Y, h, false)] });
  };
  for (const key of Object.keys(BINS)) {
    const bins = binned(BO_all, key);
    exp2[key] = { isNew: !!BINS[key].isNew, bins: bins.map((b) => ({ label: b.label, ...summarise(b.rows, S, boot) })), top50: binned(groups.BO_top50, key).map((b) => ({ label: b.label, ...summarise(b.rows, S, null) })) };
    const ord = bins.filter((b) => b.label !== "n.a." && b.label !== "none/n.a.");
    // Deviation from the plan (documented in section 2): extreme bins with fewer than MIN_CONTRAST_N stock-days are
    // skipped, so a contrast is never driven by a handful of rows.
    const first = ord.find((b) => b.rows.length >= MIN_CONTRAST_N);
    const last = [...ord].reverse().find((b) => b.rows.length >= MIN_CONTRAST_N);
    if (first && last && first !== last) addContrast(`${key}: ${last.label} vs ${first.label}`, last.rows, first.rows);
  }
  for (const key of FLAGS) {
    const t = BO_all.filter((r) => r.f[key] === true);
    const fl = BO_all.filter((r) => r.f[key] === false);
    exp2[key] = { flag: true, true: summarise(t, S, boot), false: summarise(fl, S, boot), na: BO_all.filter((r) => r.f[key] === null).length };
    if (t.length >= MIN_CONTRAST_N && fl.length >= MIN_CONTRAST_N) addContrast(`${key}: true vs false`, t, fl);
  }
  const segs = ["large", "mid", "small", "micro", null] as const;
  exp2.segment = segs.map((g) => ({ label: g ?? "other", ...summarise(BO_all.filter((r) => r.segment === g), S, boot) }));
  addContrast("segment: micro vs large+mid", BO_all.filter((r) => r.segment === "micro"), BO_all.filter((r) => r.segment === "large" || r.segment === "mid"));
  const regs = ["bullish", "sideways", "bearish", "insufficient-data"] as const;
  exp2.regime = regs.map((g) => ({ label: g, ...summarise(BO_all.filter((r) => r.regime === g), S, boot) }));
  addContrast("regime: bearish vs bullish+sideways", BO_all.filter((r) => r.regime === "bearish"), BO_all.filter((r) => r.regime === "bullish" || r.regime === "sideways"));
  const pass = bh(contrasts.map((c) => c.d.p), FDR_Q);
  const contrastTable = contrasts.map((c, i) => {
    const stable = c.halves[0] !== null && c.halves[1] !== null && c.d.d !== null && Math.sign(c.halves[0]) === Math.sign(c.d.d) && Math.sign(c.halves[1]) === Math.sign(c.d.d);
    return { ...c, fdrPass: pass[i], stableHalves: stable, verdict: pass[i] && stable ? "supported (exploratory)" : pass[i] ? "unstable" : c.d.p !== null && c.d.p < 0.05 ? "suggestive (fails FDR)" : "no evidence" };
  });

  // Exp 3: score and rank
  const bands = (g: Row[], key: (r: Row) => string, order: string[]) => order.map((label) => ({ label, ...summarise(g.filter((r) => key(r) === label), S, boot) }));
  const totalBand = (r: Row) => (r.total <= -1 ? "<=-1" : r.total >= 5 ? ">=5" : String(r.total));
  const rankBand = (r: Row) => (r.rank <= 10 ? "1-10" : r.rank <= 20 ? "11-20" : r.rank <= 30 ? "21-30" : r.rank <= 40 ? "31-40" : r.rank <= 50 ? "41-50" : r.rank <= 100 ? "51-100" : ">100");
  const spearman = (xs: number[], ys: number[]) => {
    const rk = (v: number[]) => {
      const o = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
      const r = new Array(v.length);
      for (let k = 0; k < o.length; ) {
        let j = k;
        while (j + 1 < o.length && o[j + 1].x === o[k].x) j++;
        for (let m = k; m <= j; m++) r[o[m].i] = (k + j) / 2;
        k = j + 1;
      }
      return r as number[];
    };
    const a = rk(xs);
    const b = rk(ys);
    const ma = a.reduce((p, q) => p + q, 0) / a.length;
    const mb = b.reduce((p, q) => p + q, 0) / b.length;
    let n = 0;
    let da = 0;
    let db = 0;
    for (let k = 0; k < a.length; k++) (n += (a[k] - ma) * (b[k] - mb)), (da += (a[k] - ma) ** 2), (db += (b[k] - mb) ** 2);
    return n / Math.sqrt(da * db);
  };
  const scored = groups.B.filter((r) => r.category !== "insufficient");
  const exp3 = {
    totalBands_B: bands(scored, totalBand, ["<=-1", "0", "1", "2", "3", "4", ">=5"]),
    totalBands_BO_all: bands(BO_all, totalBand, ["0", "1", "2", "3", "4", ">=5"]),
    rankBands_Aplus: bands(rows, rankBand, ["1-10", "11-20", "21-30", "31-40", "41-50", "51-100", ">100"]),
    rankBands_BO_all: bands(BO_all, rankBand, ["1-10", "11-20", "21-30", "31-40", "41-50", "51-100", ">100"]),
    components_B: Object.fromEntries(["price-structure", "volume", "relative-strength", "market", "extension"].map((d) => [d, bands(scored, (r) => String(r.comp[d]), ["-3", "-2", "-1", "0", "1", "2"].filter((x) => scored.some((r) => String(r.comp[d]) === x)))])),
    correlation_B: { totalVsChange: spearman(scored.map((r) => r.total), scored.map((r) => r.changePct)), totalVsRvol: spearman(scored.filter((r) => r.f.rvol !== null).map((r) => r.total), scored.filter((r) => r.f.rvol !== null).map((r) => r.f.rvol as number)), totalVsCloseLoc: spearman(scored.filter((r) => r.f.closeLoc !== null).map((r) => r.total), scored.filter((r) => r.f.closeLoc !== null).map((r) => r.f.closeLoc as number)) },
    // score effect holding the day's move constant: high-score (>=3) minus same-session, same-change-bucket low-score (<=1) top-50 gainers
    matchedHighVsLow_B: matchedEffect(scored.filter((r) => r.total >= 3), scored.filter((r) => r.total <= 1), S, boot, chg),
    categories_B: bands(groups.B, (r) => r.category, ["continuation", "mixed", "exhaustion-reversal", "insufficient"]),
  };

  // Exp 4: ablation
  const variants: Array<[string, Drop | null]> = [["base", null], ["no strong-close (>=0.7)", "strong-close"], ["no volume-confirm (>=1.5x)", "volume-confirm"], ["no extended gate", "extended-gate"], ["no close/volume conditions", "close-and-volume"]];
  const exp4Label = Object.fromEntries(variants.flatMap(([name, d]) => {
    const all = rows.filter((r) => breakoutWith(r, d));
    return [[`${name} | all ranks`, summarise(all, S, boot)], [`${name} | top-50`, summarise(all.filter((r) => r.rank <= 50), S, null)]];
  }));
  exp4Label["raw breakout only (close > 60-session high) | all ranks"] = summary.RAW_BO;
  const dims = [null, "relative-strength", "market", "extension", "volume", "price-structure"];
  const exp4Cont = Object.fromEntries(
    [...dims.map((d) => [`without ${d ?? "nothing (production)"}`, d, 3] as const), ["threshold total>=4", null, 4] as const, ["threshold total>=5", null, 5] as const].map(([name, d, t]) => {
      const E2 = BO_all.filter((r) => categoryWithout(r, d, t) === "continuation");
      const F2 = BO_all.filter((r) => categoryWithout(r, d, t) !== "continuation");
      const dd: Record<string, Diff> = {};
      for (const h of HORIZONS) dd[`adverse_h${h}`] = diff(sums(F2, S, (r) => METRIC.adverse(r, h)), sums(E2, S, (r) => METRIC.adverse(r, h)), boot);
      return [name, { continuationSharePct: (100 * E2.length) / BO_all.length, nE: E2.length, nF: F2.length, F_minus_E: dd }];
    }),
  );
  // why ~90%: for a breakout, price structure and volume are already >= +1 each; the rest must not subtract
  const restSum = (r: Row) => (r.comp["relative-strength"] ?? 0) + (r.comp["market"] ?? 0) + (r.comp["extension"] ?? 0);
  const why = {
    priceStructure: Object.fromEntries([...new Set(BO_all.map((r) => r.comp["price-structure"]))].map((v) => [String(v), BO_all.filter((r) => r.comp["price-structure"] === v).length])),
    volume: Object.fromEntries([...new Set(BO_all.map((r) => r.comp["volume"]))].map((v) => [String(v), BO_all.filter((r) => r.comp["volume"] === v).length])),
    restSum: Object.fromEntries([...new Set(BO_all.map(restSum))].sort((a, b) => a - b).map((v) => [String(v), BO_all.filter((r) => restSum(r) === v).length])),
  };

  // Robustness: regime for the baselines (is the bearish penalty breakout-specific?) and chronological halves
  const byRegime = Object.fromEntries((["Aplus", "B", "BO_all", "RAW_BO"] as const).map((k) => [k, regs.map((g) => ({ label: g, ...summarise(groups[k].filter((r) => r.regime === g), S, null) }))]));
  const regimeMatched = Object.fromEntries(regs.slice(0, 3).map((g) => [g, matchedEffect(BO_all.filter((r) => r.regime === g), nonBO.filter((r) => r.regime === g), S, boot, chg)]));
  const halves = Object.fromEntries((["Aplus", "B", "BO_all", "BO_top50", "BO_out", "RAW_BO", "E", "F"] as const).map((k) => [k, { first: summarise(groups[k].filter((r) => r.s < half), S, null), second: summarise(groups[k].filter((r) => r.s >= half), S, null) }]));
  // Historical reference for the live Evaluation dashboard: the SAME group definitions as the live cohort (top-50
  // gainer list; breakout and continuation within it), OD1 h = 1, 2, 5, 10.
  const top50BO = groups.BO_top50;
  const dashboard = {
    B: summarise(groups.B, S, boot),
    C: summarise(top50BO, S, boot),
    E: summarise(top50BO.filter((r) => r.category === "continuation"), S, boot),
    F: summarise(top50BO.filter((r) => r.category !== "continuation"), S, boot),
    D: summarise(groups.B.filter((r) => r.label === "momentum-continuation"), S, boot),
  };
  return { dashboard, robustness: { byRegime, regimeMatched, halves }, sessions: { count: S, first: sessions[0], last: sessions[S - 1], halfCut: sessions[half] }, reps, block: BLOCK, seed: SEED, liquidityTerciles: liqT, summary, matched, pairs, exp1: { byChange, overextension }, exp2, contrasts: contrastTable, exp3, exp4: { label: exp4Label, continuation: exp4Cont, why } };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : undefined);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const out = opt("--out");
  const reps = Number(opt("--reps") ?? 1000);
  if (!out) throw new Error("--out <file.json> is required");
  if (path.resolve(out).startsWith(path.join(repoRoot, "public") + path.sep)) throw new Error("--out must not write under public/");
  const ex = opt("--export-dashboard");
  if (ex && path.resolve(ex) !== path.join(repoRoot, "public", "data", "evaluation", `historical-${EXPECTED_RULE_VERSION}.json`) && path.resolve(ex).startsWith(path.join(repoRoot, "public") + path.sep)) throw new Error("--export-dashboard may only write public/data/evaluation/historical-<rule>.json under public/");
  assertFenceMatchesActivation(repoRoot, FENCE);
  const { computeVersion } = await import("../ledger/capture.mts");
  const { ruleVersion } = await computeVersion(repoRoot);
  if (ruleVersion !== EXPECTED_RULE_VERSION) throw new Error(`rule version ${ruleVersion}, expected ${EXPECTED_RULE_VERSION}`);
  const t0 = Date.now();
  const { dataset, activity } = loadPinnedMarketData(repoRoot, DATA_COMMIT, FENCE);
  const u = prepareUniverse(dataset, activity);
  const settings = structuredClone(DEFAULT_SETTINGS);
  const { rows, sessions } = buildRows(u, settings, FENCE);
  console.log(`rows ${rows.length} gainer stock-days over ${sessions.length} sessions (${sessions[0]}..${sessions[sessions.length - 1]}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const result = runStudy(rows, sessions, reps);
  const meta = { fence: FENCE, dataCommit: DATA_COMMIT, ruleVersion, latestMarketDate: dataset.manifest.latestMarketDate, universe: u.stocks.length };
  writeFileSync(out, JSON.stringify({ meta, ...result }, null, 1) + "\n");
  const exportPath = opt("--export-dashboard");
  if (exportPath) {
    const pick = (g: ReturnType<typeof summarise>) => {
      const o: Record<string, unknown> = { stockDays: g.stockDays, sessions: g.sessions };
      for (const h of HORIZONS) {
        const x = (g as unknown as Record<string, Record<string, any>>)[`h${h}`];
        o[`h${h}`] = { complete: x.complete, coveragePct: x.coveragePct, classes: x.classes, adverse: x.adverse, confirmed: x.confirmed, hitR: x.hitR.v, hitX: x.hitX.v, meanR: x.meanR.v, medianR: x.medianR, meanX: x.meanX, medianX: x.medianX, net20: x.net20 };
      }
      return o;
    };
    const exp = { kind: "momentum-ledger.historical-reference", schemaVersion: 1, ruleVersion, period: { first: result.sessions.first, last: result.sessions.last, sessions: result.sessions.count }, source: "scripts/research/breakout-characteristics.mts (docs/research/BREAKOUT_CHARACTERISTICS.md); in-sample, already examined", meta, groups: Object.fromEntries(Object.entries(result.dashboard).map(([k, g]) => [k, pick(g)])) };
    writeFileSync(exportPath, JSON.stringify(exp) + "\n");
    console.log(`dashboard reference written ${exportPath}`);
  }
  console.log(`written ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`::error::breakout characteristics study failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
