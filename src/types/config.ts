/** Configurable thresholds for the strength score and regime classification. All user-editable via Settings. */
export interface ScoringConfig {
  breadthBullishThresholdPct: number; // default 50
  near52wHighThresholdPct: number; // default 5 (within 5% of 52w high)
  relativePerformancePoints: number; // default 2 (points awarded for positive 3M RS)
}

export interface RegimeConfig {
  /** Minimum number of available breadth measures (of 3) required to apply bullish/bearish rules confidently. */
  minBreadthMeasuresRequired: number; // default 2
  breadthThresholdPct: number; // default 50
}

/** Minimum sample size before an industry (or any aggregate-of-stocks grouping) is treated as reliable. */
export interface IndustryConfig {
  minConstituentsForAggregate: number; // default 3
}

/** Thresholds for the stock-screening pattern detectors. All in trading sessions or percent, all configurable. */
export interface ScreeningConfig {
  /** Trailing window searched for a prior swing high used as a "resistance" reference level. */
  resistanceLookbackSessions: number; // default 60
  /** A stock counts as "approaching resistance" when within this % below that level (and not yet above it). */
  resistanceProximityPct: number; // default 3
  /** Recent window whose trading range is compared against the baseline window to detect a volatility contraction ("consolidation"). */
  consolidationLookbackSessions: number; // default 15
  /** Baseline window used as the "normal" range for comparison. */
  consolidationBaselineSessions: number; // default 60
  /** Recent range must be below this fraction of the baseline range to count as consolidating. */
  consolidationContractionRatio: number; // default 0.6
  /** Trailing window searched for swing-high/swing-low pivots used for triangle-trendline fitting. */
  triangleLookbackSessions: number; // default 40
  /** Minimum bars on each side of a candidate pivot for it to count as a local swing high/low. */
  trianglePivotSpacing: number; // default 3
  /** Minimum number of swing highs AND swing lows required to attempt a triangle fit. */
  triangleMinPivots: number; // default 2
  /** A fitted trendline slope within +/- this %-of-price-per-session is treated as "flat" (horizontal support/resistance) rather than clearly rising or falling. */
  triangleFlatSlopePctPerSession: number; // default 0.03
}

export interface AppSettings {
  scoring: ScoringConfig;
  regime: RegimeConfig;
  industry: IndustryConfig;
  screening: ScreeningConfig;
}

export const DEFAULT_SETTINGS: AppSettings = {
  scoring: {
    breadthBullishThresholdPct: 50,
    near52wHighThresholdPct: 5,
    relativePerformancePoints: 2,
  },
  regime: {
    minBreadthMeasuresRequired: 2,
    breadthThresholdPct: 50,
  },
  industry: {
    minConstituentsForAggregate: 3,
  },
  screening: {
    resistanceLookbackSessions: 60,
    resistanceProximityPct: 3,
    consolidationLookbackSessions: 15,
    consolidationBaselineSessions: 60,
    consolidationContractionRatio: 0.6,
    triangleLookbackSessions: 40,
    trianglePivotSpacing: 3,
    triangleMinPivots: 2,
    triangleFlatSlopePctPerSession: 0.03,
  },
};
