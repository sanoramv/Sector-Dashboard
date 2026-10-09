import { describe, it, expect } from "vitest";
import { computeStockScore } from "../../src/lib/calculations/stockScoring";
import { ok, unavailable } from "../../src/types/metrics";
import { DEFAULT_SETTINGS } from "../../src/types/config";

describe("computeStockScore", () => {
  it("awards full points when every condition passes", () => {
    const score = computeStockScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
        distanceFrom52wHigh: ok(-1),
        relativePerformance3m: ok(1),
        above50dma: ok(true),
        above200dma: ok(true),
        resistance: ok({ level: 100, levelDate: "2024-01-01", distancePct: -1, isApproaching: true }),
        consolidation: ok({ recentRangePct: 1, baselineRangePct: 3, contractionRatio: 0.3, isConsolidating: true }),
        triangle: ok({ type: "symmetrical", highSlopePctPerSession: -0.1, lowSlopePctPerSession: 0.1, swingHighCount: 2, swingLowCount: 2, detected: true }),
      },
      DEFAULT_SETTINGS.scoring,
    );
    expect(score.pointsEarned).toBe(score.pointsPossible);
    expect(score.completenessPct).toBe(100);
  });

  it("excludes unavailable pattern conditions from both earned and possible points", () => {
    const score = computeStockScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
        distanceFrom52wHigh: ok(-1),
        relativePerformance3m: ok(1),
        above50dma: ok(true),
        above200dma: ok(true),
        resistance: unavailable("not enough history"),
        consolidation: unavailable("not enough history"),
        triangle: unavailable("not enough history"),
      },
      DEFAULT_SETTINGS.scoring,
    );
    const resistanceCondition = score.conditions.find((c) => c.id === "approaching-resistance");
    expect(resistanceCondition?.passed).toBeNull();
    // 1 (52w) + 1(1m) + 1(3m) + 1(50dma) + 1(200dma) + 2(rs) = 7, out of 7 possible (patterns excluded)
    expect(score.pointsPossible).toBe(7);
    expect(score.pointsEarned).toBe(7);
  });

  it("never treats a failed pattern as the same as 'not detected' being bad - false is a valid, scored outcome", () => {
    const score = computeStockScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(-1), m3: ok(-1), m6: ok(-1) },
        distanceFrom52wHigh: ok(-20),
        relativePerformance3m: ok(-1),
        above50dma: ok(false),
        above200dma: ok(false),
        resistance: ok({ level: 100, levelDate: "2024-01-01", distancePct: -20, isApproaching: false }),
        consolidation: ok({ recentRangePct: 3, baselineRangePct: 3, contractionRatio: 1, isConsolidating: false }),
        triangle: ok({ type: "none", highSlopePctPerSession: 0.5, lowSlopePctPerSession: 0.5, swingHighCount: 2, swingLowCount: 2, detected: false }),
      },
      DEFAULT_SETTINGS.scoring,
    );
    expect(score.pointsEarned).toBe(0);
    expect(score.pointsPossible).toBeGreaterThan(0); // everything was evaluable, just all failed
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
      distanceFrom52wHigh: ok(-1),
      relativePerformance3m: ok(1),
      above50dma: ok(true),
      above200dma: ok(true),
      resistance: ok({ level: 100, levelDate: "2024-01-01", distancePct: -1, isApproaching: true }),
      consolidation: ok({ recentRangePct: 1, baselineRangePct: 3, contractionRatio: 0.3, isConsolidating: true }),
      triangle: ok({ type: "symmetrical" as const, highSlopePctPerSession: -0.1, lowSlopePctPerSession: 0.1, swingHighCount: 2, swingLowCount: 2, detected: true }),
    };
    expect(computeStockScore(input, DEFAULT_SETTINGS.scoring)).toEqual(computeStockScore(input, DEFAULT_SETTINGS.scoring));
  });
});
