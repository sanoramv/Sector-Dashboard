/**
 * Research baseline tests (Phase 1B). Run with:  npx vitest run --config vitest.research.config.ts
 *
 * Deliberately named *.spec.ts so the app suite (`npm test`, which gates the scheduled data + live-capture commit in
 * update-data.yml) never runs research tests: research must not be able to block live capture. Everything here is
 * synthetic - no git, no real market data, no network.
 */
import { describe, expect, it } from "vitest";
import type { DailyBar } from "../../src/types/market";
import type { ActivityRow } from "../../src/types/activity";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { moversOn, rankMovers } from "../../src/lib/momentum/discovery";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays, type FixtureStock } from "../momentum/fixtures";
import {
  assertDatasetBeforeFence,
  bootstrapDiff,
  buildPopulations,
  isRealDate,
  METRICS,
  mulberry32,
  od1Classify,
  od1Epsilon,
  od1For,
  od1FromBars,
  od1SigmaWindow,
  populationSd,
  resultDigest,
  runBaseline,
  type StockDay,
} from "../../scripts/research/breakout-baseline.mts";

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic market
// ---------------------------------------------------------------------------------------------------------------------
const N = 90;
const dates = weekdays("2025-01-06", N);
const ALL_UP = 70; // every filler stock rises: more than 50 gainers
const BREAKOUT_DAY = 75;
const BONUS_DAY = 60;
const BON_GAIN_DAY = 57;
const GAP_MISSING = 66;
const GAP_GAIN_DAY = 64;
const LISTING_DAY = 60;

function build() {
  const bench = barsFrom(dates, flatCloses(N, 1000, 0.002));
  const stocks: FixtureStock[] = [];
  const activity: Record<string, ActivityRow[]> = {};
  for (let s = 0; s < 70; s++) {
    const rnd = mulberry32(s + 1);
    const closes = [100 + s];
    for (let k = 1; k < N; k++) closes.push(closes[k - 1] * (k === ALL_UP ? 1.005 + s * 0.0005 : 1 + (rnd() - 0.5) * 0.03));
    const symbol = `F${String(s).padStart(2, "0")}`;
    stocks.push({ symbol, bars: barsFrom(dates, closes) });
    activity[symbol] = activityFor(dates);
  }
  // BRK: quiet for 75 sessions, then +6% above its 60-session high on 3x volume -> "Possible breakout setup".
  const brk = flatCloses(N, 100, 0.005);
  brk[BREAKOUT_DAY] = brk[BREAKOUT_DAY - 1] * 1.06;
  for (let k = BREAKOUT_DAY + 1; k < N; k++) brk[k] = brk[BREAKOUT_DAY];
  stocks.push({ symbol: "BRK", bars: barsFrom(dates, brk) });
  activity.BRK = activityFor(dates).map((r, k) => (k === BREAKOUT_DAY ? { ...r, volume: r.volume * 3 } : r));
  // BON: +8% day, then a 1:1 bonus (open and close both halve) three sessions later -> corporate-action break.
  const bon = flatCloses(N, 200, 0.004);
  bon[BON_GAIN_DAY] = bon[BON_GAIN_DAY - 1] * 1.08;
  for (let k = BON_GAIN_DAY + 1; k < N; k++) bon[k] = bon[BON_GAIN_DAY] * (k >= BONUS_DAY ? 0.5 : 1);
  const bonBars = barsFrom(dates, bon);
  bonBars[BONUS_DAY] = { ...bonBars[BONUS_DAY], open: bon[BONUS_DAY], high: bon[BONUS_DAY] * 1.01, low: bon[BONUS_DAY] * 0.99 };
  stocks.push({ symbol: "BON", bars: bonBars });
  activity.BON = activityFor(dates);
  // GAP: +8% day, then no bar two sessions later (suspension / data gap).
  const gap = flatCloses(N, 300, 0.004);
  gap[GAP_GAIN_DAY] = gap[GAP_GAIN_DAY - 1] * 1.08;
  for (let k = GAP_GAIN_DAY + 1; k < N; k++) gap[k] = gap[GAP_GAIN_DAY];
  stocks.push({ symbol: "GAP", bars: barsFrom(dates, gap).filter((_, k) => k !== GAP_MISSING) });
  activity.GAP = activityFor(dates.filter((_, k) => k !== GAP_MISSING));
  // NEW: a recent listing (too little history for the OD1 sigma).
  const newDates = dates.slice(LISTING_DAY);
  stocks.push({ symbol: "NEW", bars: barsFrom(newDates, newDates.map((_, k) => 50 * 1.005 ** k)) });
  activity.NEW = activityFor(newDates);
  const dataset = buildDataset(bench, stocks);
  return { dataset, activity, u: prepareUniverse(dataset, activity) };
}
const fx = build();
const LATE_FENCE = "2099-01-01";
const all = buildPopulations(fx.u, DEFAULT_SETTINGS, LATE_FENCE);
const at = (rows: StockDay[], date: string, symbol: string) => rows.find((o) => o.date === date && o.symbol === symbol);

// ---------------------------------------------------------------------------------------------------------------------
describe("date fence", () => {
  it("recognises only real calendar dates", () => {
    for (const ok of ["2026-11-18", "2028-02-29"]) expect(isRealDate(ok)).toBe(true);
    for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-11-18T00:00", " 2026-11-18", "", null, undefined, 20261118]) expect(isRealDate(bad)).toBe(false);
  });

  it("accepts a dataset entirely before the fence and refuses one that reaches it", () => {
    expect(() => assertDatasetBeforeFence(fx.dataset, fx.activity, LATE_FENCE)).not.toThrow();
    expect(() => assertDatasetBeforeFence(fx.dataset, fx.activity, dates[N - 1])).toThrow(/on or after the research fence/);
  });

  it("refuses a bar on/after the fence even when the manifest claims an earlier date", () => {
    const ds = structuredClone(fx.dataset);
    ds.manifest.latestMarketDate = dates[N - 3];
    expect(() => assertDatasetBeforeFence(ds, fx.activity, dates[N - 2])).toThrow(/on or after the research fence/);
  });

  it("fails closed on missing or impossible dates", () => {
    const bad = structuredClone(fx.dataset);
    (bad.stocks.F00.bars[3] as { date: string }).date = "2025-02-30";
    expect(() => assertDatasetBeforeFence(bad, fx.activity, LATE_FENCE)).toThrow(/invalid or missing date/);
    const missing = structuredClone(fx.dataset);
    delete (missing.indexSeries.nifty500.bars[5] as Partial<DailyBar>).date;
    expect(() => assertDatasetBeforeFence(missing, fx.activity, LATE_FENCE)).toThrow(/invalid or missing date/);
    const act = structuredClone(fx.activity);
    act.F01[2] = { ...act.F01[2], date: "2025-13-01" };
    expect(() => assertDatasetBeforeFence(fx.dataset, act, LATE_FENCE)).toThrow(/invalid or missing date/);
    expect(() => assertDatasetBeforeFence(fx.dataset, fx.activity, "2026-02-30")).toThrow(/not a real date/);
  });

  it("never observes or computes an outcome on/after the fence; windows that would cross it are pending", () => {
    const fence = dates[80];
    const p = buildPopulations(fx.u, DEFAULT_SETTINGS, fence);
    const rows = [...p.A, ...p.B];
    expect(rows.length).toBeGreaterThan(0);
    for (const o of rows) {
      expect(o.date < fence).toBe(true);
      if (o.legacy.status === "ok") expect(o.legacy.outcome.nextDate < fence).toBe(true);
      for (const h of [o.h1, o.h5]) if (h.status === "complete") expect(h.endDate < fence).toBe(true);
    }
    expect(p.sessions[p.sessions.length - 1]).toBe(dates[79]);
    const lastDay = p.B.filter((o) => o.date === dates[79]);
    expect(lastDay.length).toBeGreaterThan(0);
    for (const o of lastDay) {
      expect(o.legacy.status).toBe("beyond-fence");
      expect(o.h1).toEqual({ status: "pending", reason: "beyond-fence" });
    }
    // t = dates[76]: h=1 ends at 77 (allowed), h=5 would end at 81 (crosses the fence).
    for (const o of p.B.filter((x) => x.date === dates[76])) {
      expect(o.h5).toEqual({ status: "pending", reason: "beyond-fence" });
      expect(o.h1.status === "complete" || o.h1.status === "unavailable").toBe(true);
    }
  });

  it("marks windows past the end of the data as pending, not as outcomes", () => {
    for (const o of all.B.filter((x) => x.date === dates[N - 1])) {
      expect(o.legacy.status).toBe("pending");
      expect(o.h1).toEqual({ status: "pending", reason: "beyond-data" });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("populations", () => {
  it("B is exactly the production top-50 gainer ranking when more than 50 stocks rise", () => {
    const d = dates[ALL_UP];
    const b = all.B.filter((o) => o.date === d);
    const day = moversOn(fx.u, d);
    expect(day.movers.filter((m) => m.changePct > 0).length).toBeGreaterThan(50);
    expect(b.map((o) => o.symbol)).toEqual(rankMovers(day.movers, "gainer", 50).map((m) => m.stock.symbol));
    expect(b.map((o) => o.rank)).toEqual(Array.from({ length: 50 }, (_, k) => k + 1));
    const inB = new Set(b.map((o) => o.symbol));
    const outside = day.movers.filter((m) => m.changePct > 0 && !inB.has(m.stock.symbol)).map((m) => m.changePct);
    expect(Math.min(...b.map((o) => o.changePct))).toBeGreaterThanOrEqual(Math.max(...outside));
    for (const n of new Map(all.B.map((o) => [o.date, all.B.filter((x) => x.date === o.date).length])).values()) expect(n).toBeLessThanOrEqual(50);
  });

  it("classifies the planted breakout as Possible breakout setup and places it in C", () => {
    const o = at(all.C, dates[BREAKOUT_DAY], "BRK");
    expect(o?.label).toBe("possible-breakout");
    expect(o?.rank).toBe(1);
  });

  it("E and F partition C; C and D are disjoint; C, D, E, F are subsets of B; A+ is the up-day part of A", () => {
    const key = (o: StockDay) => `${o.date}|${o.symbol}`;
    const keys = (rows: StockDay[]) => new Set(rows.map(key));
    const B = keys(all.B);
    expect(all.E.length + all.F.length).toBe(all.C.length);
    expect([...keys(all.E)].filter((k) => keys(all.F).has(k))).toEqual([]);
    expect([...keys(all.C)].filter((k) => keys(all.D).has(k))).toEqual([]);
    for (const rows of [all.C, all.D, all.E, all.F]) for (const o of rows) expect(B.has(key(o))).toBe(true);
    for (const o of all.E) expect(o.category).toBe("continuation");
    for (const o of all.F) expect(o.category).not.toBe("continuation");
    expect(all.Aplus.every((o) => o.changePct > 0)).toBe(true);
    expect(all.Aplus.length).toBe(all.A.filter((o) => o.changePct > 0).length);
    const A = keys(all.A);
    for (const o of all.B) expect(A.has(key(o))).toBe(true);
  });

  it("excludes a corporate-action day from ranking and marks an outcome window crossing it as a discontinuity", () => {
    expect(all.moversExcluded["corporate-action-break"]).toBeGreaterThanOrEqual(1);
    expect(at(all.A, dates[BONUS_DAY], "BON")).toBeUndefined();
    const o = at(all.B, dates[BON_GAIN_DAY], "BON")!;
    expect(o.h1.status).toBe("complete"); // window t+1 is before the bonus
    expect(o.h5).toEqual({ status: "unavailable", reason: "discontinuity" });
    expect(o.r5).toBeNull();
  });

  it("marks a window with a missing session as unavailable (no-bar), never as a loss", () => {
    const o = at(all.B, dates[GAP_GAIN_DAY], "GAP")!;
    expect(o.h1.status).toBe("complete");
    expect(o.h5).toEqual({ status: "unavailable", reason: "no-bar" });
  });

  it("marks a stock with too little history as unavailable (insufficient-history)", () => {
    const st = fx.u.bySymbol.get("NEW")!;
    const i = st.indexByDate.get(dates[LISTING_DAY + 10])!;
    expect(od1For(fx.u, st, i, 1, true, LATE_FENCE)).toEqual({ status: "unavailable", reason: "insufficient-history" });
    expect(od1For(fx.u, st, i, 5, true, LATE_FENCE)).toEqual({ status: "unavailable", reason: "insufficient-history" });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("OD1 (sealed protocol/od1.json; worked examples from the decision review section 3.3)", () => {
  const sigma2 = Array.from({ length: 20 }, (_, k) => (k % 2 ? -2 : 2)); // population SD exactly 2.00
  const day = { close: 100, high: 103, low: 96 };
  const bar = (b: Partial<DailyBar> & { close: number }) => ({ open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close });
  const run = (window: ReturnType<typeof bar>[], benchTh: number, up = true, d = day) => od1FromBars({ up, day: d, window, benchT: 20000, benchTh, sigmaChanges: sigma2 });

  it("sigma: population SD of the 20 changes ending at t-1 (worked example 3.2: 1.816%)", () => {
    const ch = [1.2, -0.8, 2.5, -1.9, 0.4, 3.1, -2.2, 1.0, -0.5, 2.0, -3.0, 1.6, 0.2, -1.1, 2.8, -2.6, 0.9, 1.4, -1.7, 1.5];
    expect(populationSd(ch)).toBeCloseTo(1.816, 3);
    expect(populationSd(sigma2)).toBe(2);
    expect(od1Epsilon(2, 1)).toBe(1);
    expect(od1Epsilon(2, 5)).toBeCloseTo(2.236, 3);
  });

  it("sigma window needs 22 comparable bars and excludes day t", () => {
    const closes = Array.from({ length: 22 }, (_, k) => ({ close: 100 + k }));
    expect(od1SigmaWindow(closes.slice(0, 21))).toBeNull();
    const w = od1SigmaWindow([...closes.slice(0, 21), { close: 1000 }])!; // a huge day t must not enter the window
    expect(w).toHaveLength(20);
    expect(Math.max(...w)).toBeLessThan(2);
  });

  it("example 1: strong move -> Confirmed at h=1 and h=5", () => {
    expect(run([bar({ open: 101, close: 103, high: 103.8, low: 100.5 })], 20100).cls).toBe("confirmed");
    const w5 = [101, 102, 104, 105, 107].map((c, k) => bar({ close: c, high: k === 4 ? 108 : c + 0.5, low: c - 1 }));
    expect(run(w5, 20300).cls).toBe("confirmed");
  });

  it("example 2: Confirmed at h=1, Reversal at h=5", () => {
    const t1 = bar({ open: 100.5, close: 101.5, high: 104, low: 100 });
    expect(run([t1], 20060).cls).toBe("confirmed");
    const w5 = [t1, bar({ close: 99, low: 98.5, high: 101 }), bar({ close: 96.5, low: 95.8, high: 99 }), bar({ close: 95, low: 93.8, high: 96.5 }), bar({ close: 94.5, low: 94, high: 95.5 })];
    const r = run(w5, 20300);
    expect(r.R).toBeCloseTo(-5.5, 9);
    expect(r.X).toBeCloseTo(-7.0, 9);
    expect(r.cls).toBe("reversal");
  });

  it("example 3: barely moves -> Sideways at h=1 and h=5", () => {
    expect(run([bar({ close: 100.4, high: 101.5, low: 99.5 })], 20120).cls).toBe("sideways");
    const w5 = [100.2, 100.5, 101, 100.7, 100.9].map((c, k) => bar({ close: c, high: k === 2 ? 102.4 : c + 0.3, low: c - 0.5 }));
    expect(run(w5, 20220).cls).toBe("sideways");
  });

  it("example 4: Failed continuation at h=1, Reversal at h=5", () => {
    expect(run([bar({ close: 97.5, high: 99, low: 96.8 })], 20040).cls).toBe("failed");
    const w5 = [97.5, 95, 93, 92.5, 92].map((c, k) => bar({ close: c, high: c + 1, low: k === 3 ? 91.2 : Math.max(c - 0.5, 91.5) }));
    expect(run(w5, 20100).cls).toBe("reversal");
  });

  it("example 5: gap up that fades -> Partial, flagged abnormalGap (classification is not profitability)", () => {
    const t1 = bar({ open: 107, close: 100.6, high: 108, low: 99.8 });
    const r = run([t1], 20040);
    expect(r.cls).toBe("partial");
    expect(r.abnormalGap).toBe(true);
    const w5 = [t1, ...[100.8, 101, 101.2, 101.5].map((c) => bar({ close: c, high: c + 0.5, low: c - 0.5 }))];
    expect(run(w5, 20200).cls).toBe("partial");
  });

  it("example 7(c): one +18% day in the sigma window -> sigma 4.05, eps 2.03 / 4.53, volWindowOutlier", () => {
    const ch = [...Array(9).fill(1), ...Array(10).fill(-1), 18];
    const s = populationSd(ch);
    expect(s).toBeCloseTo(4.05, 2);
    expect(od1Epsilon(s, 1)).toBeCloseTo(2.03, 2);
    expect(od1Epsilon(s, 5)).toBeCloseTo(4.53, 2);
    const r = od1FromBars({ up: true, day, window: [bar({ close: 101.5, high: 104, low: 100 })], benchT: 20000, benchTh: 20000, sigmaChanges: ch });
    expect(r.volWindowOutlier).toBe(true);
    expect(r.cls).not.toBe("confirmed");
  });

  it("loser mirror: Confirmed downside continuation and Rebound / reversal", () => {
    const d = { close: 98, high: 104, low: 97 };
    const down = run([bar({ close: 95, high: 97.5, low: 94.5 })], 19990, false, d);
    expect(down.R).toBeCloseTo(-3.06, 2);
    expect(down.cls).toBe("confirmed");
    expect(run([bar({ close: 103.2, high: 104.6, low: 97.5 })], 20000, false, d).cls).toBe("reversal");
  });

  describe("boundaries (strict / non-strict inequalities exactly as sealed)", () => {
    const base = { up: true, Ht: 103, Lt: 96, eps: 1 };
    const c = (q: Partial<{ R: number; X: number; Hstar: number; Lstar: number; up: boolean }>) => od1Classify({ ...base, R: 0, X: 0, Hstar: 103, Lstar: 96, ...q });
    it("P is R >= eps; D is R <= -eps", () => {
      expect(c({ R: 1, X: 1, Hstar: 104 }).cls).toBe("confirmed");
      expect(c({ R: 0.999999, X: 1, Hstar: 104 }).cls).toBe("partial");
      expect(c({ R: -1 }).cls).toBe("failed");
      expect(c({ R: -0.999999 }).cls).toBe("sideways");
    });
    it("E is X > 0 (X = 0 is not outperformance); N is H* > H_t (equal is not a new high)", () => {
      expect(c({ R: 2, X: 0, Hstar: 104 }).cls).toBe("partial");
      expect(c({ R: 2, X: 1, Hstar: 103 }).cls).toBe("partial");
      expect(c({ R: 0, X: 0, Hstar: 103 }).cls).toBe("sideways");
    });
    it("B is L* < L_t (equal is not a breach): failed vs reversal", () => {
      expect(c({ R: -2, Lstar: 96 }).cls).toBe("failed");
      expect(c({ R: -2, Lstar: 95.99 }).cls).toBe("reversal");
    });
    it("D is checked before Confirmed (first match wins)", () => {
      expect(c({ R: -2, X: 5, Hstar: 110, Lstar: 90 }).cls).toBe("reversal");
    });
    it("loser mirror boundaries", () => {
      expect(c({ up: false, R: -1, X: -0.1, Lstar: 95 }).cls).toBe("confirmed");
      expect(c({ up: false, R: -1, X: 0, Lstar: 95 }).cls).toBe("partial");
      expect(c({ up: false, R: 1, Hstar: 103 }).cls).toBe("failed");
      expect(c({ up: false, R: 1, Hstar: 103.01 }).cls).toBe("reversal");
    });
    it("zero volatility: the 0.20% floor applies", () => {
      expect(od1Epsilon(0, 1)).toBe(0.2);
      const r = od1FromBars({ up: true, day, window: [bar({ close: 100.2, high: 103.5, low: 99 })], benchT: 20000, benchTh: 20000, sigmaChanges: Array(20).fill(0) });
      expect(r.eps).toBe(0.2);
      expect(r.R).toBeCloseTo(0.2, 9);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("determinism", () => {
  it("identical inputs give an identical result digest", () => {
    const a = runBaseline(fx.u, DEFAULT_SETTINGS, LATE_FENCE);
    const b = runBaseline(build().u, structuredClone(DEFAULT_SETTINGS), LATE_FENCE);
    expect(resultDigest(a)).toBe(resultDigest(b));
  });

  it("the bootstrap is reproducible for a seed and does not mutate its inputs", () => {
    const before = JSON.stringify(all.B);
    const x = bootstrapDiff(all.B.slice(0, 400), all.B.slice(400), METRICS["OD1 h1 adverse (pp)"], 7, 200);
    const y = bootstrapDiff(all.B.slice(0, 400), all.B.slice(400), METRICS["OD1 h1 adverse (pp)"], 7, 200);
    expect(x).toEqual(y);
    expect(JSON.stringify(all.B)).toBe(before);
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()]);
  });

  it("does not mutate the source dataset", () => {
    const fresh = build();
    const snapshot = JSON.stringify(fresh.dataset);
    runBaseline(fresh.u, DEFAULT_SETTINGS, LATE_FENCE);
    expect(JSON.stringify(fresh.dataset)).toBe(snapshot);
  });
});
