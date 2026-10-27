import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar } from "../../src/types/market";
import { computeActivityFeatures, computePatternContext, computePriceAction } from "../../src/lib/momentum/features";
import { detectConsolidation, detectResistance, detectTriangle } from "../../src/lib/calculations/patterns";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { discover } from "../../src/lib/momentum/discovery";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "./fixtures";

const dates = weekdays("2025-03-03", 90);

describe("price-action features", () => {
  const prev: DailyBar = { date: "2026-10-22", open: 99, high: 101, low: 98, close: 100 };
  const today: DailyBar = { date: "2026-10-23", open: 102, high: 110, low: 101, close: 108 };

  it("separates previous-close-to-close, open-to-close, gap and close location", () => {
    const p = computePriceAction([prev, today]);
    expect(p.dailyChangePct).toBeCloseTo(8, 10);
    expect(p.openToClosePct).toBeCloseTo((108 / 102 - 1) * 100, 10);
    expect(p.gapPct).toBeCloseTo(2, 10);
    expect(p.closeLocation).toBeCloseTo(7 / 9, 10);
    expect(p.rangePct).toBeCloseTo(9, 10);
  });

  it("reports unavailable (never zero) when history is too short", () => {
    const p = computePriceAction([prev, today]);
    expect(p.r3.available).toBe(false);
    expect(p.volatility20.available).toBe(false);
    expect(p.moveZ.available).toBe(false);
    expect(p.distSma20Pct.available).toBe(false);
    expect(p.distanceFrom52wHigh.available).toBe(false);
  });

  it("has no close location when the high equals the low (no intraday range)", () => {
    expect(computePriceAction([prev, { ...today, open: 105, high: 105, low: 105, close: 105 }]).closeLocation).toBeNull();
  });

  it("measures the move against the stock's own previous 20 daily changes, excluding today", () => {
    const closes = Array.from({ length: 22 }, (_, i) => 100 * (i % 2 === 0 ? 1 : 1.01));
    const bars = barsFrom(weekdays("2026-01-01", 22), closes);
    const p = computePriceAction(bars);
    expect(p.volatility20.available).toBe(true);
    if (p.volatility20.available && p.moveZ.available) expect(p.moveZ.value).toBeCloseTo(p.dailyChangePct / p.volatility20.value, 10);
    expect(p.r20.available && p.r20.value).toBeCloseTo((bars[21].close / bars[1].close - 1) * 100, 10);
  });
});

describe("volume and participation features", () => {
  const bars = barsFrom(dates.slice(0, 21), flatCloses(21));
  const map = (rows: ReturnType<typeof activityFor>) => new Map(rows.map((r) => [r.date, r]));
  const base = activityFor(dates.slice(0, 20), 100_000, { turnoverLakhs: 400, deliveryPct: 40 });

  it("relative volume = today / mean of the previous 20 sessions; turnover in crore; delivery averages", () => {
    const a = computeActivityFeatures(bars, map([...base, { date: dates[20], volume: 300_000, turnoverLakhs: 1250, deliveryPct: 55, series: "EQ" }]), true);
    expect(a.relativeVolume.available && a.relativeVolume.value).toBeCloseTo(3, 10);
    expect(a.turnoverCr).toBeCloseTo(12.5, 10);
    expect(a.medianTurnover20Cr.available && a.medianTurnover20Cr.value).toBeCloseTo(4, 10);
    expect(a.avgDeliveryPct20.available && a.avgDeliveryPct20.value).toBeCloseTo(40, 10);
    expect(a.deliveryPct).toBe(55);
    expect(a.liquidityWarnings).toEqual([]);
  });

  it("missing volume for today is unavailable, not zero volume", () => {
    const a = computeActivityFeatures(bars, map(base), true);
    expect(a.available).toBe(false);
    expect(a.volume).toBeNull();
    expect(a.relativeVolume.available).toBe(false);
    expect(a.unavailableReason).toMatch(/no volume\/turnover row/);
  });

  it("a too-short volume baseline makes relative volume unavailable", () => {
    const a = computeActivityFeatures(bars, map([...base.slice(10), { date: dates[20], volume: 1, turnoverLakhs: 1, deliveryPct: null, series: "EQ" }]), true);
    expect(a.available).toBe(true);
    expect(a.relativeVolume.available).toBe(false);
    if (!a.relativeVolume.available) expect(a.relativeVolume.reason).toMatch(/18 of the previous 20/);
  });

  it("flags trade-for-trade (BE) stocks and thin turnover", () => {
    const rows = activityFor(dates.slice(0, 21), 1000, { turnoverLakhs: 50, deliveryPct: 100, series: "BE" });
    const a = computeActivityFeatures(bars, map(rows), true);
    expect(a.tradeForTrade).toBe(true);
    expect(a.series).toBe("BE");
    expect(a.liquidityWarnings.join(" ")).toMatch(/trade-for-trade/);
    expect(a.liquidityWarnings.join(" ")).toMatch(/Thinly traded/);
  });

  it("says when the volume file itself was not loaded", () => {
    expect(computeActivityFeatures(bars, new Map(), false).unavailableReason).toMatch(/not loaded/);
  });
});

describe("pattern context reuses the dashboard detectors", () => {
  const flat = barsFrom(dates.slice(0, 70), flatCloses(70, 100));
  const level = detectResistance([...flat, { date: dates[70], open: 100, high: 100, low: 99, close: 100 }], DEFAULT_SETTINGS.screening);

  it("detects a close above the prior 60-session high as a breakout", () => {
    const bars = [...flat, { date: dates[70], open: 101, high: 111, low: 100, close: 110 }];
    const p = computePatternContext(bars, DEFAULT_SETTINGS);
    expect(p.breakoutToday).toBe(true);
    expect(p.failedBreakoutToday).toBe(false);
    expect(p.resistance).toEqual(detectResistance(bars, DEFAULT_SETTINGS.screening));
  });

  it("detects a failed breakout (traded above, closed below)", () => {
    expect(level.available).toBe(true);
    const lv = level.available ? level.value.level : 0;
    const p = computePatternContext([...flat, { date: dates[70], open: 100, high: lv * 1.03, low: 99, close: lv * 0.99 }], DEFAULT_SETTINGS);
    expect(p.breakoutToday).toBe(false);
    expect(p.failedBreakoutToday).toBe(true);
  });

  it("evaluates consolidation and triangles on the bars BEFORE today's move", () => {
    const bars = [...flat, { date: dates[70], open: 101, high: 111, low: 100, close: 110 }];
    const p = computePatternContext(bars, DEFAULT_SETTINGS);
    expect(p.consolidationBefore).toEqual(detectConsolidation(flat, DEFAULT_SETTINGS.screening));
    expect(p.triangleBefore).toEqual(detectTriangle(flat, DEFAULT_SETTINGS.screening));
  });

  it("recognises a held retest of a recent breakout level", () => {
    const breakout = { date: dates[70], open: 101, high: 109, low: 100, close: 108 };
    const lv = detectResistance([...flat, breakout], DEFAULT_SETTINGS.screening);
    const L = lv.available ? lv.value.level : NaN;
    const today = { date: dates[71], open: 106, high: 107, low: L * 1.01, close: L * 1.04 };
    const p = computePatternContext([...flat, breakout, today], DEFAULT_SETTINGS);
    expect(p.retest).toEqual({ breakoutDate: dates[70], level: L });
    const noRetest = computePatternContext([...flat, breakout, { ...today, low: L * 1.05, close: L * 1.06 }], DEFAULT_SETTINGS);
    expect(noRetest.retest).toBeNull();
  });
});

describe("sector and market context", () => {
  const n = 80;
  const d = dates.slice(0, n);
  const bench = barsFrom(d, flatCloses(n, 1000, 0.002));
  const lastUp = (level: number, pct: number) => {
    const b = barsFrom(d.slice(0, n - 1), flatCloses(n - 1, level));
    const p = b[b.length - 1].close;
    return [...b, { date: d[n - 1], open: p, high: p * (1 + pct / 100) * 1.001, low: p * 0.999, close: p * (1 + pct / 100) }];
  };
  function contextOf(stocks: Array<{ symbol: string; pct: number; industry: string }>) {
    const ds = buildDataset(bench, stocks.map((s, i) => ({ symbol: s.symbol, bars: lastUp(100 + i, s.pct), industry: s.industry })));
    const u = prepareUniverse(ds, Object.fromEntries(stocks.map((s) => [s.symbol, activityFor(d)])));
    return discover(u, d[n - 1], DEFAULT_SETTINGS, "bullish", 50).gainers.find((c) => c.symbol === "STAR")!.context;
  }

  it("calls the move sector-wide when industry peers moved the same way by at least 1% (median)", () => {
    const c = contextOf([
      { symbol: "STAR", pct: 6, industry: "IT" },
      { symbol: "P1", pct: 2, industry: "IT" },
      { symbol: "P2", pct: 1.5, industry: "IT" },
      { symbol: "P3", pct: 3, industry: "IT" },
    ]);
    expect(c.peerCount).toBe(3);
    expect(c.peerMedianChangePct).toBeCloseTo(2, 8);
    expect(c.stockVsPeersPp).toBeCloseTo(4, 8);
    expect(c.moveScope).toBe("sector-wide");
    expect(c.marketRegime).toBe("bullish");
  });

  it("calls it stock-specific when peers were flat, and unknown with fewer than 3 peers", () => {
    expect(
      contextOf([
        { symbol: "STAR", pct: 6, industry: "IT" },
        { symbol: "P1", pct: 0.2, industry: "IT" },
        { symbol: "P2", pct: -0.1, industry: "IT" },
        { symbol: "P3", pct: 0.3, industry: "IT" },
      ]).moveScope,
    ).toBe("stock-specific");
    const few = contextOf([
      { symbol: "STAR", pct: 6, industry: "IT" },
      { symbol: "P1", pct: 2, industry: "IT" },
      { symbol: "X", pct: 2, industry: "Power" },
    ]);
    expect(few.moveScope).toBe("unknown");
    expect(few.peerMedianChangePct).toBeNull();
  });
});
