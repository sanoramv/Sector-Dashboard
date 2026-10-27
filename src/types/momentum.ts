import type { Maybe, Regime } from "./metrics";
import type { ConsolidationResult, ResistanceResult, TriangleResult } from "../lib/calculations/patterns";
import type { PriceBreakKind } from "../lib/calculations/validation";
import type { ActivitySeries } from "./activity";
import type { IndexContextAt } from "../lib/momentum/market";

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
  /** Candle body |close - open| as a share of the day's range (0-1); null when high == low. */
  bodyShare: number | null;
  /** (high - max(open, close)) / range; null when high == low. */
  upperWickShare: number | null;
  /** (min(open, close) - low) / range; null when high == low. */
  lowerWickShare: number | null;
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
  /** Close vs the highest high of the previous 20 sessions (recent swing high), %. */
  distFromSwingHigh20Pct: Maybe<number>;
}

export interface PatternContext {
  /** Prior-swing-high resistance from detectResistance, evaluated on bars up to and including today. */
  resistance: Maybe<ResistanceResult>;
  /** Close above the prior lookback high today. */
  breakoutToday: boolean | null;
  /** Close below the lowest low of the prior lookback window (the mirror of resistance, used for losers). */
  breakdownToday: boolean | null;
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
  /** A row exists but records no shares traded - distinct from a missing row. */
  zeroVolume: boolean;
  /** Mean volume of the 3 sessions before today / mean of the 20 sessions before those: was participation already fading? */
  priorParticipation: Maybe<number>;
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
  /** NIFTY 50 on the same date (null when the series is not in the data). */
  nifty50: IndexContextAt | null;
  /** The stock's tracked NSE sector index (first in dashboard order), if any. */
  sectorIndex: IndexContextAt | null;
  /** Stock change minus its sector index's change today, pp. */
  stockVsSectorIndexPp: number | null;
}

/** Evidence category (headline classification). For losers, "continuation" means downside continuation and "exhaustion-reversal" means rebound risk. */
export type EvidenceCategory = "continuation" | "mixed" | "exhaustion-reversal" | "insufficient";

export type EvidenceDimension = "price-structure" | "volume" | "relative-strength" | "market" | "extension";

export interface ComponentScore {
  dimension: EvidenceDimension;
  /** Points toward continuation of today's direction (negative = against); null when the inputs are unavailable. */
  score: number | null;
  min: number;
  max: number;
  reasons: string[];
}

export interface EvidenceAssessment {
  category: EvidenceCategory;
  components: ComponentScore[];
  /** Sum of available component scores - an evidence tally, not a probability. */
  total: number;
  /** Inputs that were unavailable, so their evidence is missing. */
  missingEvidence: string[];
  /** Why the category was assigned, in terms of the rules. */
  rationale: string;
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
  assessment: EvidenceAssessment;
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
  /** Universe stocks whose close equalled the previous comparable close (genuine zero change; not ranked). */
  unchangedCount: number;
  excluded: ExcludedMover[];
  gainers: MomentumCandidate[];
  losers: MomentumCandidate[];
  /** Highest relative volume among all ranked stocks (any direction), most unusual first. */
  volumeMovers: MomentumCandidate[];
}
