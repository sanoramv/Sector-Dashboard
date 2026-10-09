import type { BreadthMetrics, DataQuality, Maybe, RegimeAssessment, ReturnMetrics, ScoreBreakdown } from "./metrics";

/**
 * Metrics for one NSE industry grouping (NSE's published macro-industry
 * classification, e.g. "Automobile and Auto Components", "Capital Goods").
 *
 * NSE does not publish a price index for most of these industries, so
 * `returns` and `distanceFrom52wHigh` here are a computed, equal-weighted
 * AVERAGE of the industry's own constituent stocks' individual metrics -
 * explicitly a derived aggregate, never presented as an official index
 * value. `breadth` uses the same real constituent-stock mechanism as sector
 * breadth. Each averaged field carries its own sample size so the UI can
 * show exactly how many stocks contributed.
 */
export interface IndustryMetrics {
  name: string;
  slug: string;
  stockCount: number;
  asOfDate: Maybe<string>;

  returns: ReturnMetrics;
  returnsSampleSize: { d1: number; w1: number; m1: number; m3: number; m6: number };

  distanceFrom52wHigh: Maybe<number>;
  distanceSampleSize: number;

  relativePerformance3m: Maybe<number>;
  relativePerformanceSampleSize: number;

  breadth: BreadthMetrics;
  score: ScoreBreakdown;
  regime: RegimeAssessment;
  dataQuality: DataQuality;
}
