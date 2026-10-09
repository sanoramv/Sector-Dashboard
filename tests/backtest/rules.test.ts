import { describe, it, expect } from "vitest";
import { runBacktest } from "../../src/lib/backtest/engine";
import { BACKTEST_RULES } from "../../src/lib/backtest/rules";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { makeBars } from "../helpers";

describe("BACKTEST_RULES", () => {
  it("every rule is runnable end-to-end against a realistic synthetic universe without throwing", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 15) * 15 + i * 0.05);
    const benchCloses = Array.from({ length: 300 }, (_, i) => 100 + i * 0.03);
    const universe = [
      { symbol: "A", bars: makeBars(closes) },
      { symbol: "B", bars: makeBars(closes.map((c) => c * 1.1)) },
    ];
    const benchmark = makeBars(benchCloses);

    for (const rule of BACKTEST_RULES) {
      const signalFn = rule.makeSignal(DEFAULT_SETTINGS);
      const result = runBacktest(rule.id, universe, benchmark, signalFn, { holdingSessions: 10, costBps: 20 });
      expect(result.ruleName).toBe(rule.id);
      expect(result.baselineStats).not.toBeNull();
      // Signal stats may legitimately be null if the rule never fired - that's fine, just must not throw.
    }
  });

  it("'above-200dma' rule agrees with the underlying moving-average check at a known point", () => {
    // Flat-then-jump series: above 200dma should fire only once the price is clearly above its trailing average.
    const closes = [...Array.from({ length: 250 }, () => 100), ...Array.from({ length: 20 }, () => 200)];
    const universe = [{ symbol: "A", bars: makeBars(closes) }];
    const benchmark = makeBars(closes);
    const rule = BACKTEST_RULES.find((r) => r.id === "above-200dma")!;
    const signalFn = rule.makeSignal(DEFAULT_SETTINGS);

    const result = runBacktest(rule.id, universe, benchmark, signalFn, { holdingSessions: 5, costBps: 0 });
    expect(result.signalStats).not.toBeNull();
    expect(result.signalStats!.n).toBeGreaterThan(0);
  });
});
