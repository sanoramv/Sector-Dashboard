/**
 * Regression tests for defects found in the Phase 13 data-accuracy audit
 * (see AUDIT_REPORT.md). Price fixtures marked "real" are copied verbatim from
 * public/data/stocks.json as fetched from NSE's sec_bhavdata_full archive, and
 * were cross-checked against Yahoo Finance's split events on 2026-10-13.
 */
import { describe, it, expect } from "vitest";
import { splitAtPriceBreaks, validateBars, isStale } from "../../src/lib/calculations/validation";
import { computeBreadth } from "../../src/lib/calculations/breadth";
import { computeIndustryMetrics } from "../../src/lib/calculations/industry";
import { assembleStockScreenResult } from "../../src/lib/calculations/stockScreen";
import { computeDistanceFrom52wHigh } from "../../src/lib/calculations/distanceFromHigh";
import { runBacktest } from "../../src/lib/backtest/engine";
import { METRIC_GLOSSARY } from "../../src/content/metricGlossary";
import { detectTriangle } from "../../src/lib/calculations/patterns";
import { DABUR_40, AFFLE_40 } from "./fixtures";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar, StockSeries } from "../../src/types/market";
import { makeBars, addDays } from "../helpers";

// Real: HDFCBANK 1:1 bonus, ex-date 2025-08-26.
const HDFCBANK_BONUS: DailyBar[] = [
  { date: "2025-08-25", open: 1960.2, high: 1977.4, low: 1957, close: 1964.1 },
  { date: "2025-08-26", open: 979.5, high: 985.7, low: 968, close: 973.4 },
];
// Real: KOTAKBANK 1:5 split, ex-date 2026-01-14.
const KOTAK_SPLIT: DailyBar[] = [
  { date: "2026-01-13", open: 2126.9, high: 2144.4, low: 2120, close: 2132.6 },
  { date: "2026-01-14", open: 426, high: 427.6, low: 418.8, close: 421 },
];
// Real: POLICYBZR genuine -36% day (opened only -10%) - must NOT be treated as a corporate action.
const POLICYBZR_CRASH: DailyBar[] = [
  { date: "2026-09-23", open: 1800, high: 1904.9, low: 1793, close: 1886.3 },
  { date: "2026-09-24", open: 1697.7, high: 1697.7, low: 1207.2, close: 1207.2 },
];
// Real: IEX genuine -30% day, 2025-07-24.
const IEX_CRASH: DailyBar[] = [
  { date: "2025-07-23", open: 192.7, high: 193.41, low: 186.61, close: 187.89 },
  { date: "2025-07-24", open: 169.1, high: 169.1, low: 131.5, close: 132.32 },
];

/** `n` flat bars ending the day before `pair[0]`, followed by the real pair, followed by `after` flat bars at the post-event price. */
function around(pair: DailyBar[], before: number, after: number): DailyBar[] {
  const pre = Array.from({ length: before }, (_, i) => {
    const c = pair[0].close;
    return { date: addDays(pair[0].date, i - before), open: c, high: c, low: c, close: c };
  });
  const post = Array.from({ length: after }, (_, i) => {
    const c = pair[1].close;
    return { date: addDays(pair[1].date, i + 1), open: c, high: c, low: c, close: c };
  });
  return [...pre, ...pair, ...post];
}

describe("Defect C1: unadjusted corporate-action price breaks", () => {
  it("detects real split/bonus ex-dates", () => {
    expect(splitAtPriceBreaks(HDFCBANK_BONUS).breaks.map((b) => b.date)).toEqual(["2025-08-26"]);
    expect(splitAtPriceBreaks(KOTAK_SPLIT).breaks.map((b) => b.date)).toEqual(["2026-01-14"]);
  });

  it("does not flag genuine one-day crashes where the open did not gap by the same ratio", () => {
    expect(splitAtPriceBreaks(POLICYBZR_CRASH).breaks).toEqual([]);
    expect(splitAtPriceBreaks(IEX_CRASH).breaks).toEqual([]);
  });

  it("flags upward breaks (reverse splits / consolidations) symmetrically", () => {
    const bars = makeBars([10, 10, 50]);
    expect(splitAtPriceBreaks(bars).breaks).toHaveLength(1);
  });

  it("validateBars keeps only post-break bars by default and says why", () => {
    const { bars, warnings } = validateBars(around(HDFCBANK_BONUS, 30, 5));
    expect(bars[0].date).toBe("2025-08-26");
    expect(bars).toHaveLength(6);
    expect(warnings.join(" ")).toMatch(/split\/bonus\/demerger/i);
  });

  it("validateBars can return the full series for callers that segment it themselves", () => {
    const { bars, warnings } = validateBars(around(HDFCBANK_BONUS, 30, 5), { splitAtBreaks: false });
    expect(bars).toHaveLength(37);
    expect(warnings).toEqual([]);
  });

  it("never reports a bonus as a -50% fall from the 52-week high", () => {
    // Before the fix this returned ~-50.4% (973.4 vs the pre-bonus high of 1964.1).
    const bars = around(HDFCBANK_BONUS, 370, 5);
    const { bars: clean } = validateBars(bars);
    expect(computeDistanceFrom52wHigh(clean).available).toBe(false);
  });

  it("does not count a stock as below its moving average just because of a bonus", () => {
    // 30 pre-bonus sessions at 1964.1, then 25 post-bonus sessions at 973.4.
    // Before the fix the stock was counted 'below 50-DMA' purely because of the bonus.
    const stock: StockSeries = { symbol: "HDFCBANK", bars: around(HDFCBANK_BONUS, 30, 24) };
    const asOf = stock.bars[stock.bars.length - 1].date;
    const result = computeBreadth([stock], asOf, false);
    expect(result.above50dma.eligible).toBe(0); // only 25 comparable bars
    expect(result.above20dma.eligible).toBe(1);
  });

  it("detects breaks in breadth using only bars up to asOfDate (no look-ahead)", () => {
    // Break happens AFTER asOfDate - the pre-break history must still be fully usable at asOfDate.
    const stock: StockSeries = { symbol: "HDFCBANK", bars: around(HDFCBANK_BONUS, 60, 5) };
    const asOf = HDFCBANK_BONUS[0].date;
    expect(computeBreadth([stock], asOf, false).above50dma.eligible).toBe(1);
  });

  it("backtest never measures a forward return across a break", () => {
    // Flat prices on both sides: every legitimate forward return is exactly 0%.
    // Before the fix, windows spanning the bonus produced ~-50% returns.
    const universe = [{ symbol: "HDFCBANK", bars: around(HDFCBANK_BONUS, 40, 40) }];
    const result = runBacktest("always", universe, makeBars(Array(100).fill(100), "2025-07-01"), () => true, {
      holdingSessions: 5,
      costBps: 0,
    });
    expect(result.signalStats!.n).toBeGreaterThan(0);
    // The ex-date bar's own open-to-close move is the only non-zero return possible.
    expect(Math.min(...[result.signalStats!.medianReturnPct, result.signalStats!.avgReturnPct])).toBeGreaterThan(-1);
    expect(result.warnings.join(" ")).toMatch(/not adjusted for corporate actions/);
  });
});

describe("Defect H2: stale prices treated as current", () => {
  const MARKET_DATE = "2024-03-31";
  const current = makeBars(Array.from({ length: 91 }, (_, i) => 100 + i), "2024-01-01"); // ends 2024-03-31, rising
  const stale = makeBars(Array.from({ length: 60 }, (_, i) => 100 + i), "2024-01-01"); // ends 2024-02-29

  it("isStale uses a 7-calendar-day tolerance", () => {
    expect(isStale("2024-03-24", MARKET_DATE)).toBe(false);
    expect(isStale("2024-03-23", MARKET_DATE)).toBe(true);
  });

  it("breadth excludes a stock with no recent price instead of using its old close", () => {
    const result = computeBreadth(
      [
        { symbol: "CUR", bars: current },
        { symbol: "OLD", bars: stale },
      ],
      MARKET_DATE,
      false,
    );
    expect(result.above20dma.eligible).toBe(1);
    expect(result.above20dma.total).toBe(2);
  });

  it("industry averages leave out stale stocks", () => {
    const bench = makeBars(Array.from({ length: 91 }, () => 100), "2024-01-01");
    const stocks = { CUR: { symbol: "CUR", bars: current }, OLD: { symbol: "OLD", bars: stale } };
    const m = computeIndustryMetrics("Test", ["CUR", "OLD"], stocks, bench, DEFAULT_SETTINGS);
    expect(m.returnsSampleSize.m1).toBe(1);
  });

  it("the screener gives a stale stock no metrics and no score, so it cannot rank, but states its real as-of date", () => {
    const bench = makeBars(Array.from({ length: 91 }, () => 100), "2024-01-01");
    const r = assembleStockScreenResult(
      { symbol: "OLD", companyName: "Old Ltd", industry: "Test", sectorSlugs: [], rawBars: stale },
      bench,
      DEFAULT_SETTINGS,
    );
    expect(r.priceIntegrity.state).toBe("stale");
    expect(r.dataQuality.status).toBe("unavailable");
    expect(r.dataQuality.missing.join(" ")).toMatch(/latest bar is 2024-02-29/);
    expect(r.score.pointsEarned).toBe(0);
    expect(r.score.pointsPossible).toBe(0);
    expect(r.returns.m1.available).toBe(false);
    expect(r.triangle.available).toBe(false);
    expect(r.resistance.available).toBe(false);
    expect(r.latestDate).toEqual({ available: true, value: "2024-02-29" });
  });
});

describe("Defect M1: backtest entered at the signal bar's own close", () => {
  it("enters at the next session's open and exits at the close holdingSessions after the signal", () => {
    // open != close on every bar so the two conventions give different answers.
    const bars: DailyBar[] = Array.from({ length: 12 }, (_, i) => ({
      date: addDays("2024-01-01", i),
      open: 100 + i * 10 + 5,
      high: 100 + i * 10 + 6,
      low: 100 + i * 10,
      close: 100 + i * 10,
    }));
    const result = runBacktest("first-bar-only", [{ symbol: "X", bars }], bars, (upTo) => upTo.length === 1, {
      holdingSessions: 3,
      costBps: 0,
    });
    // Signal at t=0 (close 100). Entry = open of t=1 = 115. Exit = close of t=3 = 130.
    expect(result.signalStats!.n).toBe(1);
    expect(result.signalStats!.avgReturnPct).toBeCloseTo((130 / 115 - 1) * 100, 10);
  });
});

describe("Defect L1: Help text for 52-week high disagreed with the code", () => {
  it("documents the intraday high the implementation actually uses", () => {
    expect(METRIC_GLOSSARY.distance52w.formula).toMatch(/intraday High/);
    expect(METRIC_GLOSSARY.distance52w.explanation).not.toMatch(/highest close/);
  });
});

// Real: TRENT 3:2 bonus, ex-date 2026-06-04 (confirmed by Yahoo split event).
const TRENT_BONUS: DailyBar[] = [
  { date: "2026-06-03", open: 4220, high: 4284.8, low: 4165, close: 4257.6 },
  { date: "2026-06-04", open: 2830, high: 2849, low: 2751, close: 2837.6 },
];
// Real: TARIL genuine -20% lower-circuit day (Yahoo shows no corporate action; every close matches).
const TARIL_FALL: DailyBar[] = [
  { date: "2025-11-07", open: 402, high: 405.9, low: 385.7, close: 391.9 },
  { date: "2025-11-10", open: 313.55, high: 323.6, low: 313.55, close: 313.55 },
];

describe("Pre-deployment: smaller corporate actions are never computed across", () => {
  it("flags a 3:2 bonus as an unverified discontinuity, not as clean data", () => {
    const { breaks } = splitAtPriceBreaks(TRENT_BONUS);
    expect(breaks).toHaveLength(1);
    expect(breaks[0].kind).toBe("unverified-discontinuity");
  });

  it("also flags a genuine 15%+ gap-down (it cannot tell them apart) - and says so", () => {
    const { breaks } = splitAtPriceBreaks(TARIL_FALL);
    expect(breaks[0].kind).toBe("unverified-discontinuity");
    const { warnings } = validateBars(TARIL_FALL);
    expect(warnings.join(" ")).toMatch(/could be an unadjusted bonus\/rights issue or a genuine fall/);
  });

  it("does not flag 15%+ RISES (bonuses/splits never raise the unadjusted price)", () => {
    // Real pattern: many +20% upper-circuit days on 2026-02-03.
    expect(splitAtPriceBreaks(makeBars([100, 120])).breaks).toEqual([]);
  });

  it("does not flag an ordinary -10% day", () => {
    expect(splitAtPriceBreaks(makeBars([100, 90])).breaks).toEqual([]);
  });

  it("the TRENT 6M return and 52-week distance become unavailable instead of the misleading raw values", () => {
    const bars = around(TRENT_BONUS, 300, 90);
    const bench = makeBars(Array(bars.length).fill(100), bars[0].date);
    const r = assembleStockScreenResult(
      { symbol: "TRENT", companyName: "Trent", industry: "Consumer Services", sectorSlugs: [], rawBars: bars },
      bench,
      DEFAULT_SETTINGS,
    );
    expect(r.priceIntegrity.state).toBe("post-discontinuity-only");
    expect(r.priceIntegrity.usableFrom).toBe("2026-06-04");
    expect(r.returns.m6.available).toBe(false);
    expect(r.distanceFrom52wHigh.available).toBe(false);
    expect(r.above200dma.available).toBe(false);
    expect(r.returns.m1.available).toBe(true); // a window entirely after the event is still fine
  });
});

describe("Pre-deployment: missing sessions are a discontinuity when the market calendar is known", () => {
  const calendar = makeBars(Array(10).fill(1), "2024-01-01").map((b) => b.date); // 01..10
  const withGap = makeBars(Array(10).fill(100), "2024-01-01").filter((b) => !["2024-01-05", "2024-01-06"].includes(b.date));

  it("detects the gap and counts the missing sessions", () => {
    const { breaks } = splitAtPriceBreaks(withGap, calendar);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toMatchObject({ kind: "missing-sessions", prevDate: "2024-01-04", date: "2024-01-07", missingSessions: 2 });
  });

  it("does not judge dates before the calendar starts", () => {
    const early = makeBars([100, 100], "2023-12-01");
    expect(splitAtPriceBreaks([...early, ...makeBars(Array(10).fill(100), "2024-01-01")], calendar).breaks).toEqual([]);
  });

  it("breadth does not take a moving average across the gap", () => {
    const stock: StockSeries = { symbol: "G", bars: withGap };
    expect(computeBreadth([stock], "2024-01-10", false, calendar).above20dma.eligible).toBe(0);
  });
});

describe("Pre-deployment: weak two-point triangles are tentative, never scored", () => {
  const cfg = DEFAULT_SETTINGS.screening;

  it("DABUR (2 swing highs + 2 swing lows, 2026-10-09) is tentative, not detected", () => {
    const t = detectTriangle(DABUR_40, cfg);
    expect(t.available).toBe(true);
    if (!t.available) return;
    expect(t.value.type).toBe("symmetrical");
    expect(t.value.swingHighCount).toBe(2);
    expect(t.value.swingLowCount).toBe(2);
    expect(t.value.confidence).toBe("tentative");
    expect(t.value.detected).toBe(false);
    expect(t.value.tentativeReason).toMatch(/at least 3/);
  });

  it("AFFLE (3 swing highs + 2 swing lows, 2026-10-09) is tentative, not detected", () => {
    const t = detectTriangle(AFFLE_40, cfg);
    expect(t.available).toBe(true);
    if (!t.available) return;
    expect(t.value.swingLowCount).toBe(2);
    expect(t.value.confidence).toBe("tentative");
    expect(t.value.detected).toBe(false);
  });

  it("a tentative triangle earns no score point", () => {
    // Benchmark on the same trading dates, so no session is "missing".
    const bench = DABUR_40.map((b) => ({ ...b, open: 100, high: 100, low: 100, close: 100 }));
    const r = assembleStockScreenResult(
      { symbol: "DABUR", companyName: "Dabur", industry: "FMCG", sectorSlugs: [], rawBars: DABUR_40 },
      bench,
      DEFAULT_SETTINGS,
    );
    const cond = r.score.conditions.find((c) => c.id === "triangle-pattern")!;
    expect(cond.passed).toBe(false);
  });

  it("a clean converging structure with 3+ well-fitted pivots per line is confirmed", () => {
    // Highs fall 110 -> 104 and lows rise 90 -> 96 in a regular zig-zag: a textbook symmetrical triangle.
    const closes: number[] = [];
    for (let k = 0; k < 7; k++) {
      const hi = 110 - k * 1.2;
      const lo = 90 + k * 1.2;
      closes.push(hi, (hi + lo) / 2 + 1, (hi + lo) / 2 - 1, lo, (hi + lo) / 2 - 1, (hi + lo) / 2 + 1);
    }
    const bars = closes.slice(0, 40).map((c, i) => ({ date: addDays("2024-01-01", i), open: c, high: c, low: c, close: c }));
    const t = detectTriangle(bars, cfg);
    expect(t.available).toBe(true);
    if (!t.available) return;
    expect(t.value.swingHighCount).toBeGreaterThanOrEqual(3);
    expect(t.value.swingLowCount).toBeGreaterThanOrEqual(3);
    expect(t.value.type).toBe("symmetrical");
    expect(t.value.confidence).toBe("confirmed");
    expect(t.value.detected).toBe(true);
  });
});
