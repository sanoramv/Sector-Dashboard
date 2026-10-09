import type { Maybe, ReturnMetrics, ScoreBreakdown, ScoreCondition } from "../../types/metrics";
import type { ScoringConfig } from "../../types/config";
import type { ConsolidationResult, ResistanceResult, TriangleResult } from "./patterns";
import { evalCondition, aggregateScoreConditions } from "./scoring";

export interface StockScoringInput {
  returns: ReturnMetrics;
  distanceFrom52wHigh: Maybe<number>;
  relativePerformance3m: Maybe<number>;
  above50dma: Maybe<boolean>;
  above200dma: Maybe<boolean>;
  resistance: Maybe<ResistanceResult>;
  consolidation: Maybe<ConsolidationResult>;
  triangle: Maybe<TriangleResult>;
}

function evalBoolCondition<T>(metric: Maybe<T>, predicate: (v: T) => boolean): boolean | null {
  return metric.available ? predicate(metric.value) : null;
}

/**
 * Stock-level screening score - deliberately a SEPARATE 0-10 scale from the
 * sector/industry 0-9 scale (different conditions entirely), so the two are
 * never confused or compared directly. Like the sector score, this is a
 * transparent, configurable screening heuristic, not a validated predictive
 * model: a condition contributes points only when it could actually be
 * evaluated, and pattern-detection conditions (resistance/consolidation/
 * triangle) are explicitly disclosed heuristics - see src/lib/calculations/patterns.ts.
 */
export function computeStockScore(input: StockScoringInput, config: ScoringConfig): ScoreBreakdown {
  const conditions: ScoreCondition[] = [
    {
      id: "near-52w-high",
      label: `Within ${config.near52wHighThresholdPct}% of 52-week high`,
      passed: evalCondition(input.distanceFrom52wHigh, (v) => v >= -config.near52wHighThresholdPct),
      points: 1,
    },
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
      id: "above-50dma",
      label: "Price is above its own 50-day moving average",
      passed: evalBoolCondition(input.above50dma, (v) => v),
      points: 1,
    },
    {
      id: "above-200dma",
      label: "Price is above its own 200-day moving average",
      passed: evalBoolCondition(input.above200dma, (v) => v),
      points: 1,
    },
    {
      id: "relative-performance-3m-positive",
      label: "3M relative performance vs NIFTY 500 is positive",
      passed: evalCondition(input.relativePerformance3m, (v) => v > 0),
      points: config.relativePerformancePoints,
    },
    {
      id: "approaching-resistance",
      label: "Approaching a prior resistance level (heuristic)",
      passed: evalBoolCondition(input.resistance, (v) => v.isApproaching),
      points: 1,
    },
    {
      id: "consolidating",
      label: "Trading range has contracted vs. its own baseline (heuristic)",
      passed: evalBoolCondition(input.consolidation, (v) => v.isConsolidating),
      points: 1,
    },
    {
      id: "triangle-pattern",
      label: "A triangle price-structure heuristic was detected",
      passed: evalBoolCondition(input.triangle, (v) => v.detected),
      points: 1,
    },
  ];

  const maxPossiblePoints = 1 + 1 + 1 + 1 + 1 + config.relativePerformancePoints + 1 + 1 + 1;
  return aggregateScoreConditions(conditions, maxPossiblePoints);
}
