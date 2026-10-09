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

export interface AppSettings {
  scoring: ScoringConfig;
  regime: RegimeConfig;
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
};
