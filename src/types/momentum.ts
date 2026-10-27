import type { Maybe, Regime } from "./metrics";
import type { ConsolidationResult, ResistanceResult, TriangleResult } from "../lib/calculations/patterns";
import type { PriceBreakKind } from "../lib/calculations/validation";
import type { ActivitySeries } from "./activity";

/** Which daily-movers list a stock appeared on. */
export type DiscoveryGroup = "gainer" | "loser";

/** Size segment from CURRENT official index membership (a proxy - no market-cap figures are published in the data used). */
export type SizeSegment = "large" | "mid" | "small" | "micro";

/**
 * Research classification of the observed conditions. NOT a trade instruction
 * and NOT a probability - see src/lib/momentum/classify.ts for the exact,
 * pre-declared rules.
 */
export type MomentumLabel =
  | "momentum-continuation"
  | "possible-breakout"
  | "possible-reversal"
  | "extended-reversal-risk"
  | "weak-momentum"
  | "mixed-signals"
  | "insufficient-evidence";

export interface MomentumFactor {
  id: string;
  text: string;
}

export interface PriceActionFeatures {
  close: number;
  prevClose: number;
  /** Previous close -> close, %. */
  dailyChangePct: number;
  /** Open -> close, %. */
  openToClosePct: number;
  /** Previous close -> open, %. */
  gapPct: number;
  /** (close - low) / (high - low): 1 = closed at the day's high, 0 = at the low. Null when high == low. */
  closeLocation: number | null;
  /** (high - low) / previous close, %. */
  rangePct: number;
  r3: Maybe<number>;
  r5: Maybe<number>;
  r10: Maybe<number>;
  r20: Maybe<number>;
  /** Standard deviation of the 20 daily % changes BEFORE today. */
  volatility20: Maybe<number>;
  /** Today's change / volatility20 - how unusual today's move is for this stock. */
  moveZ: Maybe<number>;
  distSma20Pct: Maybe<number>;
  distSma50Pct: Maybe<number>;
  distSma200Pct: Maybe<number>;
  distanceFrom52wHigh: Maybe<number>;
}

export interface PatternContext {
  /** Prior-swing-high resistance from detectResistance, evaluated on bars up to and including today. */
  resistance: Maybe<ResistanceResult>;
  /** Close above the prior lookback high today. */
  breakoutToday: boolean | null;
  /** Intraday high above the prior lookback high, but the close was not. */
  failedBreakoutToday: boolean | null;
  /** A breakout within the previous 10 sessions whose level today's low came back to (within 2%) while the close held above it. */
  retest: { breakoutDate: string; level: number } | null;
  /** Consolidation and triangle evaluated on bars up to the PREVIOUS session - the structure before today's move. */
  consolidationBefore: Maybe<ConsolidationResult>;
  triangleBefore: Maybe<TriangleResult>;
}

export interface ActivityFeatures {
  /** Whether a volume/turnover row exists for today. */
  available: boolean;
  unavailableReason: string | null;
  volume: number | null;
  /** Today's volume / mean volume of the 20 previous sessions. */
  relativeVolume: Maybe<number>;
  turnoverCr: number | null;
  /** Median daily turnover over the 20 previous sessions, Rs crore. */
  medianTurnover20Cr: Maybe<number>;
  deliveryPct: number | null;
  avgDeliveryPct20: Maybe<number>;
  series: ActivitySeries | null;
  /** BE/BZ: trade-for-trade settlement (no intraday netting; delivery % is 100% by rule). */
  tradeForTrade: boolean;
  liquidityWarnings: string[];
}

export interface SectorMarketContext {
  industry: string;
  /** Industry peers (same NSE industry, same universe) with a valid change today, excluding this stock. */
  peerCount: number;
  peerMedianChangePct: number | null;
  /** This stock's change minus the peer median, pp. */
  stockVsPeersPp: number | null;
  moveScope: "sector-wide" | "stock-specific" | "unknown";
  /** Stock 21-session return minus NIFTY 500's, pp (reuses computeRelativeStrength). */
  relativeStrength1m: Maybe<number>;
  /** Industry peers' median 21-session return minus NIFTY 500's, pp. */
  industryRelativeStrength1m: Maybe<number>;
  benchmarkChangePct: Maybe<number>;
  marketRegime: Regime;
}

export interface CandidateDataQuality {
  status: "ok" | "limited";
  /** Number of comparable bars (after the latest price discontinuity) behind the features. */
  barsUsed: number;
  usableFrom: string;
  notes: string[];
}

export interface MomentumCandidate {
  symbol: string;
  companyName: string;
  industry: string;
  segment: SizeSegment | null;
  group: DiscoveryGroup;
  /** 1-based rank within its group on this date (by daily change). */
  rank: number;
  date: string;
  price: PriceActionFeatures;
  patterns: PatternContext;
  activity: ActivityFeatures;
  context: SectorMarketContext;
  quality: CandidateDataQuality;
  label: MomentumLabel;
  /** Factors supporting continuation of today's direction (up for gainers, down for losers). */
  continuationFactors: MomentumFactor[];
  /** Factors supporting a reversal of today's direction. */
  reversalFactors: MomentumFactor[];
  lowConfidenceReasons: string[];
}

export type ExclusionReason = PriceBreakKind | "first-bar-in-history";

export interface ExcludedMover {
  symbol: string;
  reason: ExclusionReason;
  /** Unadjusted previous-bar -> today change, %, shown only to explain the exclusion. */
  rawChangePct: number | null;
  detail: string;
}

export interface DiscoveryResult {
  date: string;
  /** Universe stocks with a comparable change for this date. */
  eligibleCount: number;
  universeSize: number;
  /** Universe stocks with no bar on this date (did not trade, suspended, not yet listed, or stale data). */
  noSessionCount: number;
  excluded: ExcludedMover[];
  gainers: MomentumCandidate[];
  losers: MomentumCandidate[];
}
