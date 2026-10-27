import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar } from "../../src/types/market";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { discover } from "../../src/lib/momentum/discovery";
import { nextSessionOutcome } from "../../src/lib/momentum/outcomes";
import {
  MIN_DISTINCT_DATES,
  MIN_OBSERVATIONS,
  clusteredMean,
  computeOutcomeStats,
  runMomentumEvaluation,
  walkForward,
  type Observation,
} from "../../src/lib/momentum/evaluation";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "./fixtures";

const dates = weekdays("2025-06-02", 90);
const bench = barsFrom(dates, flatCloses(90, 1000, 0.002));

describe("next-session outcome definitions", () => {
  // t = dates[60]; next = dates[61]
  const bars = barsFrom(dates.slice(0, 60), flatCloses(60, 100));
  const t: DailyBar = { date: dates[60], open: 100, high: 104, low: 99, close: 103 };
  const n1: DailyBar = { date: dates[61], open: 104, high: 105, low: 98, close: 103.5 };
  const u = prepareUniverse(buildDataset(bench.slice(0, 62), [{ symbol: "S", bars: [...bars, t, n1] }]), null);
  const s = u.bySymbol.get("S")!;

  it("keeps close-to-close, high/low breaches and the tradable open-to-close outcome separate", () => {
    const r = nextSessionOutcome(u, s, 60, 20);
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    const o = r.outcome;
    expect(o.nextDate).toBe(dates[61]);
    expect(o.closeToClosePct).toBeCloseTo((103.5 / 103 - 1) * 100, 10); // positive...
    expect(o.lowerLow).toBe(true); // ...while also trading below today's low
    expect(o.higherHigh).toBe(true);
    expect(o.gapPct).toBeCloseTo((104 / 103 - 1) * 100, 10);
    expect(o.openToCloseNetPct).toBeCloseTo((103.5 / 104 - 1) * 100 - 0.2, 10); // entry at next open, minus 20 bps
    expect(o.mfeFromOpenPct).toBeCloseTo((105 / 104 - 1) * 100, 10);
    expect(o.maeFromOpenPct).toBeCloseTo((98 / 104 - 1) * 100, 10);
    const benchRet = (bench[61].close / bench[60].close - 1) * 100;
    expect(o.excessVsNifty500Pp).toBeCloseTo(o.closeToClosePct - benchRet, 10);
  });

  it("is pending on the latest session - never filled in", () => {
    expect(nextSessionOutcome(u, s, 61, 20).kind).toBe("pending");
  });

  it("excludes a next bar that starts a discontinuity, and a missing next bar", () => {
    const crash = { ...n1, open: 50, high: 51, low: 49, close: 50 };
    const u2 = prepareUniverse(buildDataset(bench.slice(0, 62), [{ symbol: "S", bars: [...bars, t, crash] }]), null);
    const r = nextSessionOutcome(u2, u2.bySymbol.get("S")!, 60, 20);
    expect(r).toEqual({ kind: "discontinuity", nextDate: dates[61], breakKind: "corporate-action-break" });
    const u3 = prepareUniverse(buildDataset(bench.slice(0, 63), [{ symbol: "S", bars: [...bars, t, { ...n1, date: dates[62] }] }]), null);
    expect(nextSessionOutcome(u3, u3.bySymbol.get("S")!, 60, 20)).toEqual({ kind: "no-next-bar", nextDate: dates[61] });
  });
});

/** 30 stocks with random-looking but deterministic moves, so every session has gainers and losers. */
function market(nDates: number, seed = 7) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const d = dates.slice(0, nDates);
  const stocks = Array.from({ length: 30 }, (_, k) => {
    let c = 100 + k;
    const closes = d.map(() => (c *= 1 + (rnd() - 0.5) * 0.08));
    return { symbol: `S${String(k).padStart(2, "0")}`, bars: barsFrom(d, closes), industry: k % 3 === 0 ? "IT" : k % 3 === 1 ? "Power" : "Healthcare" };
  });
  return { d, stocks, ds: buildDataset(bench.slice(0, nDates), stocks), activity: Object.fromEntries(stocks.map((s) => [s.symbol, activityFor(d, 100_000 + s.symbol.length)])) };
}

describe("no look-ahead", () => {
  it("candidates and every feature for date t are identical whatever happens after t", () => {
    const { d, stocks, ds, activity } = market(90);
    const t = d[70];
    const u = prepareUniverse(ds, activity);
    const before = discover(u, t, DEFAULT_SETTINGS, "sideways", 10);

    // Rewrite every bar and activity row AFTER t.
    const future = stocks.map((s) => ({
      ...s,
      bars: s.bars.map((b) => (b.date > t ? { ...b, open: b.open * 3, high: b.high * 3, low: b.low * 3, close: b.close * 3 } : b)),
    }));
    const futureActivity = Object.fromEntries(Object.entries(activity).map(([k, rows]) => [k, rows.map((r) => (r.date > t ? { ...r, volume: 9e9 } : r))]));
    const after = discover(prepareUniverse(buildDataset(bench.slice(0, 90), future), futureActivity), t, DEFAULT_SETTINGS, "sideways", 10);
    expect(after).toEqual(before);
  });

  it("evaluation observations for date t depend only on data through t+1", () => {
    const { d, stocks, ds, activity } = market(90);
    const r1 = runMomentumEvaluation(prepareUniverse(ds, activity), DEFAULT_SETTINGS, { topN: 5, costBps: 20 });
    const cut = d[80];
    const changed = stocks.map((s) => ({ ...s, bars: s.bars.map((b) => (b.date > cut ? { ...b, close: b.close * 1.5, high: b.high * 1.5 } : b)) }));
    const r2 = runMomentumEvaluation(prepareUniverse(buildDataset(bench.slice(0, 90), changed), activity), DEFAULT_SETTINGS, { topN: 5, costBps: 20 });
    const early = (r: typeof r1) => r.observations.filter((o) => o.date < d[79]);
    expect(early(r2)).toEqual(early(r1));
  });

  it("walk-forward predictions only use outcomes from earlier dates", () => {
    const obs: Observation[] = [];
    const outcome = (pos: boolean) => ({ nextDate: "", closeToClosePct: pos ? 1 : -1, excessVsNifty500Pp: 0, higherHigh: false, lowerLow: false, gapPct: 0, openToCloseNetPct: 0, mfeFromOpenPct: 0, maeFromOpenPct: 0 });
    // 40 dates x 1 observation of label A, always positive; then on date 41 a negative one.
    for (let i = 0; i < 41; i++) {
      obs.push({ date: dates[i], symbol: `X${i}`, group: "gainer", label: "possible-breakout", volume: "confirmed", regime: "sideways", repeat: false, outcome: outcome(i < 40) });
    }
    const w = walkForward(obs, "gainer");
    // First scored prediction is on date 31 (after 30 prior observations), using 30 positives.
    expect(w.predictions[0].date).toBe(dates[30]);
    expect(w.predictions[0].pLabel).toBeCloseTo(31 / 32, 10);
    // The last (negative) observation is predicted from the 40 earlier positives only - its own outcome is not used.
    const lastP = w.predictions[w.predictions.length - 1];
    expect(lastP.date).toBe(dates[40]);
    expect(lastP.positive).toBe(false);
    expect(lastP.pLabel).toBeCloseTo(41 / 42, 10);
  });
});

describe("sample-size and uncertainty reporting", () => {
  const o = (date: string, r: number) => ({ date, symbol: date, repeat: false, outcome: { nextDate: "", closeToClosePct: r, excessVsNifty500Pp: r, higherHigh: r > 0, lowerLow: r < 0, gapPct: 0, openToCloseNetPct: r, mfeFromOpenPct: 1, maeFromOpenPct: -1 } });

  it("flags fewer than 30 observations or fewer than 20 distinct dates as insufficient", () => {
    const few = computeOutcomeStats(Array.from({ length: MIN_OBSERVATIONS - 1 }, (_, i) => o(dates[i], 1)));
    expect(few?.sufficient).toBe(false);
    expect(few?.insufficientReason).toMatch(/only 29 observations/);
    const clustered = computeOutcomeStats(Array.from({ length: 100 }, (_, i) => o(dates[i % (MIN_DISTINCT_DATES - 1)], i % 2 ? 1 : -1)));
    expect(clustered?.sufficient).toBe(false);
    expect(clustered?.insufficientReason).toMatch(/distinct dates/);
    expect(computeOutcomeStats([])).toBeNull();
  });

  it("computes win rate, distribution and outperformance from the observations", () => {
    const s = computeOutcomeStats([o(dates[0], 2), o(dates[1], -1), o(dates[2], 4), o(dates[3], -3)])!;
    expect(s.pctPositive).toBeCloseTo(50, 10);
    expect(s.meanPct).toBeCloseTo(0.5, 10);
    expect(s.medianPct).toBeCloseTo(0.5, 10);
    expect(s.pctDown3).toBeCloseTo(25, 10);
    expect(s.pctLowerLow).toBeCloseTo(50, 10);
  });

  it("clusters the confidence interval by date: a duplicated observation does not narrow it like a new date would", () => {
    const vals = [1, -1, 2, -2, 0.5];
    const ds = dates.slice(0, 5);
    const once = clusteredMean(vals, ds);
    const twice = clusteredMean([...vals, ...vals], [...ds, ...ds]);
    const width = (c: [number, number] | null) => (c ? c[1] - c[0] : NaN);
    expect(twice.mean).toBeCloseTo(once.mean, 10);
    expect(width(twice.ci)).toBeCloseTo(width(once.ci), 10);
    expect(clusteredMean([1, 2], [ds[0], ds[0]]).ci).toBeNull();
  });
});

describe("full evaluation run", () => {
  const { ds, activity } = market(90);
  const r = runMomentumEvaluation(prepareUniverse(ds, activity), DEFAULT_SETTINGS, { topN: 5, costBps: 20 });

  it("evaluates every session except the first and the last, with top-N per group", () => {
    expect(r.sessionsEvaluated).toBe(88);
    expect(r.observations.filter((o) => o.group === "gainer").length).toBeLessThanOrEqual(88 * 5);
    expect(r.exclusions.pendingNextSession).toBeGreaterThan(0); // the latest session's candidates have no outcome yet
    expect(r.baselineAllStocks?.n).toBeGreaterThan(r.observations.length);
  });

  it("reports results by label, regime, volume confirmation and chronological fold, with warnings", () => {
    expect(r.byGroup).toHaveLength(2);
    expect(r.byGroupLabel.length).toBeGreaterThan(0);
    expect(r.byFold.filter((f) => f.key.label === null)).toHaveLength(6);
    expect(r.warnings.join(" ")).toMatch(/survivorship/);
    expect(r.warnings.join(" ")).toMatch(/not fitted/);
    expect(r.walkForward.map((w) => w.group)).toEqual(["gainer", "loser"]);
  });
});
