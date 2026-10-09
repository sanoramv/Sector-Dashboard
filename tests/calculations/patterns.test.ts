import { describe, it, expect } from "vitest";
import { detectResistance, detectConsolidation, detectTriangle } from "../../src/lib/calculations/patterns";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar } from "../../src/types/market";

function bar(date: string, close: number, high = close, low = close, open = close): DailyBar {
  return { date, open, high, low, close };
}

function dateAt(i: number): string {
  const d = new Date("2024-01-01T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
}

describe("detectResistance", () => {
  it("is unavailable without enough history", () => {
    const bars = [bar(dateAt(0), 100)];
    const result = detectResistance(bars, DEFAULT_SETTINGS.screening);
    expect(result.available).toBe(false);
  });

  it("identifies the highest prior high as the resistance level", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(dateAt(i), 100, 100));
    bars[30] = bar(dateAt(30), 100, 130); // a clear spike high mid-window
    bars.push(bar(dateAt(60), 127)); // today, just below the spike, approaching
    const result = detectResistance(bars, { resistanceLookbackSessions: 60, resistanceProximityPct: 3 });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.level).toBe(130);
      expect(result.value.isApproaching).toBe(true);
    }
  });

  it("does not flag 'approaching' when far below the resistance level", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(dateAt(i), 100, 100));
    bars[30] = bar(dateAt(30), 100, 130);
    bars.push(bar(dateAt(60), 100)); // today, well below 130
    const result = detectResistance(bars, { resistanceLookbackSessions: 60, resistanceProximityPct: 3 });
    expect(result.available).toBe(true);
    if (result.available) expect(result.value.isApproaching).toBe(false);
  });

  it("does not flag 'approaching' once price has already closed above the level", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(dateAt(i), 100, 100));
    bars[30] = bar(dateAt(30), 100, 130);
    bars.push(bar(dateAt(60), 135)); // today, already broke above
    const result = detectResistance(bars, { resistanceLookbackSessions: 60, resistanceProximityPct: 3 });
    expect(result.available).toBe(true);
    if (result.available) expect(result.value.isApproaching).toBe(false);
  });
});

describe("detectConsolidation", () => {
  it("is unavailable without enough history", () => {
    const bars = [bar(dateAt(0), 100, 101, 99)];
    const result = detectConsolidation(bars, DEFAULT_SETTINGS.screening);
    expect(result.available).toBe(false);
  });

  it("detects a recent range contraction relative to the baseline", () => {
    const bars: DailyBar[] = [];
    // Baseline: wide daily range (10% of price)
    for (let i = 0; i < 45; i++) bars.push(bar(dateAt(i), 100, 105, 95));
    // Recent 15 sessions: tight daily range (1% of price)
    for (let i = 45; i < 60; i++) bars.push(bar(dateAt(i), 100, 100.5, 99.5));
    const result = detectConsolidation(bars, {
      consolidationLookbackSessions: 15,
      consolidationBaselineSessions: 60,
      consolidationContractionRatio: 0.6,
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.isConsolidating).toBe(true);
      expect(result.value.contractionRatio).toBeLessThan(0.6);
    }
  });

  it("does not flag consolidation when the range is unchanged", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(bar(dateAt(i), 100, 105, 95));
    const result = detectConsolidation(bars, {
      consolidationLookbackSessions: 15,
      consolidationBaselineSessions: 60,
      consolidationContractionRatio: 0.6,
    });
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.isConsolidating).toBe(false);
      expect(result.value.contractionRatio).toBeCloseTo(1, 5);
    }
  });
});

/**
 * Builds a clean zigzag series: `high` oscillates in a triangle wave (period
 * `period`, amplitude `ampHigh`) around a linearly-trending baseline (slope
 * `slopeHigh`/session), and `low` does the same independently with its own
 * slope/amplitude. Amplitude >> slope*period guarantees each wave crest/
 * trough is a genuine, unambiguous local extremum for the swing-pivot
 * detector, regardless of the underlying trend direction.
 */
function buildZigzagBars(n: number, period: number, slopeHigh: number, slopeLow: number, ampHigh = 4, ampLow = 4): DailyBar[] {
  const bars: DailyBar[] = [];
  const tri = (i: number) => {
    const phase = i % period;
    const half = period / 2;
    return phase <= half ? phase / half : (period - phase) / half;
  };
  for (let i = 0; i < n; i++) {
    const high = 150 + slopeHigh * i + ampHigh * tri(i);
    const low = 100 + slopeLow * i - ampLow * tri(i);
    const close = (high + low) / 2;
    bars.push(bar(dateAt(i), close, high, low));
  }
  return bars;
}

describe("detectTriangle", () => {
  const config = { triangleLookbackSessions: 40, trianglePivotSpacing: 2, triangleMinPivots: 2, triangleFlatSlopePctPerSession: 0.03 };

  it("is unavailable without enough history", () => {
    const bars = [bar(dateAt(0), 100)];
    const result = detectTriangle(bars, config);
    expect(result.available).toBe(false);
  });

  it("classifies clearly descending highs + ascending lows as symmetrical", () => {
    const bars = buildZigzagBars(40, 8, -0.15, 0.15); // falling highs, rising lows
    const result = detectTriangle(bars, config);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.type).toBe("symmetrical");
      expect(result.value.detected).toBe(true);
      expect(result.value.highSlopePctPerSession).toBeLessThan(0);
      expect(result.value.lowSlopePctPerSession).toBeGreaterThan(0);
    }
  });

  it("classifies flat highs + ascending lows as ascending", () => {
    const bars = buildZigzagBars(40, 8, 0, 0.15); // flat resistance, rising support
    const result = detectTriangle(bars, config);
    expect(result.available).toBe(true);
    if (result.available) expect(result.value.type).toBe("ascending");
  });

  it("classifies flat lows + descending highs as descending", () => {
    const bars = buildZigzagBars(40, 8, -0.15, 0); // falling resistance, flat support
    const result = detectTriangle(bars, config);
    expect(result.available).toBe(true);
    if (result.available) expect(result.value.type).toBe("descending");
  });

  it("reports 'none' when highs and lows are both trending the same direction (a channel, not a triangle)", () => {
    const bars = buildZigzagBars(40, 8, 0.15, 0.15); // both rising in parallel
    const result = detectTriangle(bars, config);
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.value.type).toBe("none");
      expect(result.value.detected).toBe(false);
    }
  });

  it("is deterministic for identical inputs", () => {
    const bars = buildZigzagBars(40, 8, -0.1, 0.1);
    expect(detectTriangle(bars, config)).toEqual(detectTriangle(bars, config));
  });
});
