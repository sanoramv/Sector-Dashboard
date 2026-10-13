import type { DataQuality, Maybe, ReturnMetrics, ScoreBreakdown } from "./metrics";
import type { DailyBar } from "./market";
import type { ConsolidationResult, ResistanceResult, TriangleResult } from "../lib/calculations/patterns";
import type { PriceBreak } from "../lib/calculations/validation";

/**
 * Whether this stock's metrics rest on a continuous, comparable price history.
 * - clean: no discontinuity detected (undetectable small corporate actions remain possible - see Help).
 * - post-discontinuity-only: metrics use only prices after the latest discontinuity; longer windows are unavailable.
 * - stale: no current price; no metrics or score are computed.
 * - no-data: no usable price history at all.
 */
export interface PriceIntegrity {
  state: "clean" | "post-discontinuity-only" | "stale" | "no-data";
  /** First date whose price feeds the metrics (null when nothing is computed). */
  usableFrom: string | null;
  /** Every discontinuity found in the stock's history, oldest first. */
  breaks: PriceBreak[];
  note: string | null;
}

export interface StockScreenResult {
  symbol: string;
  companyName: string;
  industry: string;
  /** Slugs of every tracked sector index this stock is a constituent of (a stock can be in more than one, e.g. a sector index + NIFTY 500). */
  sectorSlugs: string[];

  currentClose: Maybe<number>;
  latestDate: Maybe<string>;
  returns: ReturnMetrics;
  distanceFrom52wHigh: Maybe<number>;
  relativePerformance3m: Maybe<number>;

  above50dma: Maybe<boolean>;
  above200dma: Maybe<boolean>;

  resistance: Maybe<ResistanceResult>;
  consolidation: Maybe<ConsolidationResult>;
  triangle: Maybe<TriangleResult>;

  score: ScoreBreakdown;
  dataQuality: DataQuality;
  priceIntegrity: PriceIntegrity;
  priceSeries: DailyBar[];
}
