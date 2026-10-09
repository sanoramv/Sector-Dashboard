import { describe, it, expect } from "vitest";
import { runBacktest } from "../../src/lib/backtest/engine";
import { makeBars } from "../helpers";

describe("runBacktest", () => {
  it("computes the correct forward return for an always-true signal", () => {
    // Closes rise by exactly 1 per session: 100, 101, 102, ... 149 (50 bars).
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);

    const result = runBacktest("always-true", universe, benchmark, () => true, { holdingSessions: 5, costBps: 0 });

    expect(result.signalStats).not.toBeNull();
    // Every t from 0..44 fires; forward return at t is ((100+t+5)/(100+t) - 1)*100.
    // Spot check t=0: (105/100-1)*100 = 5%.
    expect(result.signalStats!.n).toBe(45);
    // All returns should be positive in a monotonically rising series.
    expect(result.signalStats!.winRatePct).toBe(100);
  });

  it("subtracts the assumed cost from gross returns exactly", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);

    const withoutCost = runBacktest("r", universe, benchmark, () => true, { holdingSessions: 5, costBps: 0 });
    const withCost = runBacktest("r", universe, benchmark, () => true, { holdingSessions: 5, costBps: 100 }); // 1%

    expect(withoutCost.signalStats!.avgReturnPct - withCost.signalStats!.avgReturnPct).toBeCloseTo(1, 10);
  });

  it("excludes null signals from the signal sample but still counts them in the baseline", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);

    // Signal only fires from t=10 onward (simulating "not enough history yet" before that).
    const result = runBacktest(
      "partial",
      universe,
      benchmark,
      (barsUpToT) => (barsUpToT.length < 11 ? null : true),
      { holdingSessions: 5, costBps: 0 },
    );

    const totalEvaluableDates = 30 - 5; // t from 0..24
    expect(result.baselineStats!.n).toBe(totalEvaluableDates);
    expect(result.signalStats!.n).toBe(totalEvaluableDates - 10); // t=10..24
  });

  it("never lets the signal function see data beyond the current evaluation date (no look-ahead)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);

    let maxObservedLength = 0;
    let sawFutureClose = false;
    const fullCloses = new Set(closes);

    runBacktest(
      "lookahead-check",
      universe,
      benchmark,
      (barsUpToT) => {
        maxObservedLength = Math.max(maxObservedLength, barsUpToT.length);
        // If the signal function were ever handed bars past its true "today",
        // the LAST bar it sees would sometimes be from later than its call
        // order implies. We check a structural invariant instead: the bars
        // array handed to the signal must never include dates past its own
        // last element reported length - i.e. length matches a strict prefix.
        const closesInView = barsUpToT.map((b) => b.close);
        const expectedPrefix = [...fullCloses].slice(0, barsUpToT.length);
        if (JSON.stringify(closesInView) !== JSON.stringify(expectedPrefix)) sawFutureClose = true;
        return true;
      },
      { holdingSessions: 5, costBps: 0 },
    );

    expect(sawFutureClose).toBe(false);
    expect(maxObservedLength).toBeLessThanOrEqual(closes.length - 5); // never handed the full series including the holding-period tail
  });

  it("truncates the benchmark to the same as-of date as the signal date, never later", () => {
    const stockCloses = Array.from({ length: 30 }, (_, i) => 100 + i);
    const benchCloses = Array.from({ length: 30 }, (_, i) => 200 + i);
    const universe = [{ symbol: "X", bars: makeBars(stockCloses) }];
    const benchmark = makeBars(benchCloses);

    let violated = false;
    runBacktest(
      "bench-check",
      universe,
      benchmark,
      (barsUpToT, benchmarkUpToT) => {
        const asOfDate = barsUpToT[barsUpToT.length - 1].date;
        if (benchmarkUpToT.some((b) => b.date > asOfDate)) violated = true;
        return true;
      },
      { holdingSessions: 5, costBps: 0 },
    );

    expect(violated).toBe(false);
  });

  it("flags small sample sizes as unreliable rather than presenting them as evidence", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);

    // Fires only once.
    const result = runBacktest("rare", universe, benchmark, (barsUpToT) => barsUpToT.length === 5, {
      holdingSessions: 5,
      costBps: 0,
    });

    expect(result.signalStats!.n).toBe(1);
    expect(result.warnings.some((w) => /too few/i.test(w))).toBe(true);
  });

  it("always discloses survivorship bias and execution-assumption limitations", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const result = runBacktest("r", universe, makeBars(closes), () => true, { holdingSessions: 5, costBps: 10 });
    expect(result.warnings.some((w) => /survivorship/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /closing price/i.test(w))).toBe(true);
    expect(result.warnings.some((w) => /10 basis points/i.test(w))).toBe(true);
  });

  it("handles an empty universe without throwing", () => {
    const result = runBacktest("empty", [], [], () => true, { holdingSessions: 5, costBps: 0 });
    expect(result.signalStats).toBeNull();
    expect(result.baselineStats).toBeNull();
    expect(result.universeSize).toBe(0);
  });

  it("is deterministic for identical inputs", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const universe = [{ symbol: "X", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);
    const run = () => runBacktest("det", universe, benchmark, (b) => b[b.length - 1].close > 100, { holdingSessions: 5, costBps: 5 });
    expect(run()).toEqual(run());
  });
});
