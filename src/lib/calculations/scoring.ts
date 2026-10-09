import type { BreadthMetrics, Maybe, ReturnMetrics, ScoreBreakdown, ScoreCondition } from "../../types/metrics";
import type { ScoringConfig } from "../../types/config";

export interface ScoringInput {
  returns: ReturnMetrics;
  breadth: BreadthMetrics;
  distanceFrom52wHigh: Maybe<number>;
  relativePerformance3m: Maybe<number>;
}

/** Evaluates `predicate(value)` only when the metric is available; null otherwise (never coerced to a failing condition). */
export function evalCondition(metric: Maybe<number>, predicate: (v: number) => boolean): boolean | null {
  return metric.available ? predicate(metric.value) : null;
}

/**
 * Shared scoring aggregator used by every scoring engine in this app (sector,
 * stock, industry): sums points for conditions that evaluated to true, and
 * separately tracks how many of `maxPossiblePoints` could even be evaluated
 * (`pointsPossible`) - a condition with `passed === null` contributes to
 * neither earned nor possible, so missing data is never scored as a failure.
 */
export function aggregateScoreConditions(conditions: ScoreCondition[], maxPossiblePoints: number): ScoreBreakdown {
  const pointsPossible = conditions.filter((c) => c.passed !== null).reduce((s, c) => s + c.points, 0);
  const pointsEarned = conditions.filter((c) => c.passed === true).reduce((s, c) => s + c.points, 0);
  return {
    conditions,
    pointsEarned,
    pointsPossible,
    completenessPct: (pointsPossible / maxPossiblePoints) * 100,
  };
}

/**
 * This is a transparent screening heuristic, not a validated predictive model.
 * A passing condition contributes its points only when the underlying metric
 * was actually computable - missing data is excluded from both the earned and
 * possible totals, never treated as a failed (0-point) condition.
 */
export function computeScore(input: ScoringInput, config: ScoringConfig): ScoreBreakdown {
  const conditions: ScoreCondition[] = [
    {
      id: "return-1m-positive",
      label: "1M return is positive",
      passed: evalCondition(input.returns.m1, (v) => v > 0),
      points: 1,
    },
    {
      id: "return-3m-positive",
      label: "3M return is positive",
      passed: evalCondition(input.returns.m3, (v) => v > 0),
      points: 1,
    },
    {
      id: "return-6m-positive",
      label: "6M return is positive",
      passed: evalCondition(input.returns.m6, (v) => v > 0),
      points: 1,
    },
    {
      id: "breadth-20dma-above-threshold",
      label: `Above-20-DMA breadth exceeds ${config.breadthBullishThresholdPct}%`,
      passed: evalCondition(input.breadth.above20dma.pct, (v) => v > config.breadthBullishThresholdPct),
      points: 1,
    },
    {
      id: "breadth-50dma-above-threshold",
      label: `Above-50-DMA breadth exceeds ${config.breadthBullishThresholdPct}%`,
      passed: evalCondition(input.breadth.above50dma.pct, (v) => v > config.breadthBullishThresholdPct),
      points: 1,
    },
    {
      id: "breadth-200dma-above-threshold",
      label: `Above-200-DMA breadth exceeds ${config.breadthBullishThresholdPct}%`,
      passed: evalCondition(input.breadth.above200dma.pct, (v) => v > config.breadthBullishThresholdPct),
      points: 1,
    },
    {
      id: "relative-performance-3m-positive",
      label: "3M relative performance vs NIFTY 500 is positive",
      passed: evalCondition(input.relativePerformance3m, (v) => v > 0),
      points: config.relativePerformancePoints,
    },
    {
      id: "near-52w-high",
      label: `Within ${config.near52wHighThresholdPct}% of 52-week high`,
      passed: evalCondition(input.distanceFrom52wHigh, (v) => v >= -config.near52wHighThresholdPct),
      points: 1,
    },
  ];

  const maxPossiblePoints = 1 + 1 + 1 + 1 + 1 + 1 + config.relativePerformancePoints + 1;
  return aggregateScoreConditions(conditions, maxPossiblePoints);
}
