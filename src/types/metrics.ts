import type { DailyBar } from "./market";

/** A metric that may legitimately be unavailable - never silently coerced to 0 or false. */
export type Maybe<T> = { available: true; value: T } | { available: false; reason: string };

export const ok = <T>(value: T): Maybe<T> => ({ available: true, value });
export const unavailable = <T>(reason: string): Maybe<T> => ({ available: false, reason });

export interface ReturnMetrics {
  d1: Maybe<number>;
  w1: Maybe<number>;
  m1: Maybe<number>;
  m3: Maybe<number>;
  m6: Maybe<number>;
}

export interface BreadthWindowResult {
  pct: Maybe<number>;
  /** How many constituents had enough price history to evaluate this MA window. */
  eligible: number;
  /** Total constituents in the sector's universe (eligible + ineligible). */
  total: number;
}

export interface BreadthMetrics {
  above20dma: BreadthWindowResult;
  above50dma: BreadthWindowResult;
  above200dma: BreadthWindowResult;
  /** True when breadth is computed from a documented proxy universe rather than official constituents. */
  isProxy: boolean;
}

export interface RelativeStrengthMetrics {
  /** Sector return minus NIFTY 500 return, in percentage points, per timeframe. */
  w1: Maybe<number>;
  m1: Maybe<number>;
  m3: Maybe<number>;
  m6: Maybe<number>;
  /** Sector close / NIFTY 500 close, trend series for charting. */
  ratioSeries: Maybe<Array<{ date: string; ratio: number }>>;
}

export interface ScoreCondition {
  id: string;
  label: string;
  /** null = could not be evaluated because an input metric was unavailable. */
  passed: boolean | null;
  points: number;
}

export interface ScoreBreakdown {
  conditions: ScoreCondition[];
  pointsEarned: number;
  pointsPossible: number;
  /** pointsEarned / pointsAvailable (conditions that COULD be evaluated), as a percentage. */
  completenessPct: number;
}

export type Regime = "bullish" | "bearish" | "sideways" | "insufficient-data";

export interface RegimeAssessment {
  regime: Regime;
  reasons: string[];
  /** Disagreement between short-term (1M) and long-term (6M) direction. */
  shortVsLongConflict: boolean;
  /** Heuristic confidence based on data completeness & metric agreement - NOT a calibrated probability. */
  confidence: "low" | "medium" | "high";
  confidenceReasons: string[];
}

export type DataQualityStatus = "complete" | "partial" | "unavailable";

export interface DataQuality {
  status: DataQualityStatus;
  missing: string[];
}

export interface MarketOverview {
  benchmarkDisplayName: string;
  benchmarkReturns: ReturnMetrics;
  bullishCount: number;
  sidewaysCount: number;
  bearishCount: number;
  insufficientDataCount: number;
  /** Null when broad-market breadth could not be computed at all (not just unavailable per-window). */
  broadMarketBreadth: BreadthMetrics | null;
}

export interface SectorMetrics {
  slug: string;
  displayName: string;
  currentClose: Maybe<number>;
  latestDate: Maybe<string>;
  returns: ReturnMetrics;
  breadth: BreadthMetrics;
  distanceFrom52wHigh: Maybe<number>;
  relativeStrength: RelativeStrengthMetrics;
  score: ScoreBreakdown;
  regime: RegimeAssessment;
  dataQuality: DataQuality;
  priceSeries: DailyBar[];
  excludeFromHeadlineCount?: boolean;
  overlapNote?: string;
}
