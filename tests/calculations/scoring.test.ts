import { describe, it, expect } from "vitest";
import { computeScore } from "../../src/lib/calculations/scoring";
import { ok, unavailable } from "../../src/types/metrics";
import { DEFAULT_SETTINGS } from "../../src/types/config";

const baseBreadth = {
  above20dma: { pct: ok(60), eligible: 10, total: 10 },
  above50dma: { pct: ok(60), eligible: 10, total: 10 },
  above200dma: { pct: ok(60), eligible: 10, total: 10 },
  isProxy: false,
};

describe("computeScore", () => {
  it("awards full points (9) when every condition passes with default config", () => {
    const score = computeScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
        breadth: baseBreadth,
        distanceFrom52wHigh: ok(-1),
        relativePerformance3m: ok(1),
      },
      DEFAULT_SETTINGS.scoring,
    );
    expect(score.pointsEarned).toBe(9);
    expect(score.pointsPossible).toBe(9);
    expect(score.completenessPct).toBe(100);
  });

  it("awards zero points when every condition fails, but possible points stay at max", () => {
    const score = computeScore(
      {
        returns: { d1: ok(-1), w1: ok(-1), m1: ok(-1), m3: ok(-1), m6: ok(-1) },
        breadth: {
          above20dma: { pct: ok(10), eligible: 10, total: 10 },
          above50dma: { pct: ok(10), eligible: 10, total: 10 },
          above200dma: { pct: ok(10), eligible: 10, total: 10 },
          isProxy: false,
        },
        distanceFrom52wHigh: ok(-50),
        relativePerformance3m: ok(-1),
      },
      DEFAULT_SETTINGS.scoring,
    );
    expect(score.pointsEarned).toBe(0);
    expect(score.pointsPossible).toBe(9);
  });

  it("excludes unavailable metrics from both earned and possible points, never counting them as failed", () => {
    const score = computeScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: unavailable("n/a"), m6: unavailable("n/a") },
        breadth: baseBreadth,
        distanceFrom52wHigh: unavailable("n/a"),
        relativePerformance3m: ok(1),
      },
      DEFAULT_SETTINGS.scoring,
    );
    // Available/passing: m1(1) + breadth20(1) + breadth50(1) + breadth200(1) + RS3m(2) = 6
    // Possible (available conditions only): everything except 3m return, 6m return, 52w-high = 9 - 1 - 1 - 1 = 6
    expect(score.pointsPossible).toBe(6);
    expect(score.pointsEarned).toBe(6);
    expect(score.completenessPct).toBeCloseTo((6 / 9) * 100, 5);

    const m3Condition = score.conditions.find((c) => c.id === "return-3m-positive");
    expect(m3Condition?.passed).toBeNull();
  });

  it("respects a configurable breadth threshold", () => {
    const customConfig = { ...DEFAULT_SETTINGS.scoring, breadthBullishThresholdPct: 70 };
    const score = computeScore(
      {
        returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
        breadth: baseBreadth, // 60%, below the custom 70% threshold
        distanceFrom52wHigh: ok(-1),
        relativePerformance3m: ok(1),
      },
      customConfig,
    );
    const breadthCondition = score.conditions.find((c) => c.id === "breadth-20dma-above-threshold");
    expect(breadthCondition?.passed).toBe(false);
  });

  it("is deterministic for identical inputs", () => {
    const input = {
      returns: { d1: ok(1), w1: ok(1), m1: ok(1), m3: ok(1), m6: ok(1) },
      breadth: baseBreadth,
      distanceFrom52wHigh: ok(-1),
      relativePerformance3m: ok(1),
    };
    expect(computeScore(input, DEFAULT_SETTINGS.scoring)).toEqual(computeScore(input, DEFAULT_SETTINGS.scoring));
  });
});
