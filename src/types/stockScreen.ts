import type { DataQuality, Maybe, ReturnMetrics, ScoreBreakdown } from "./metrics";
import type { DailyBar } from "./market";
import type { ConsolidationResult, ResistanceResult, TriangleResult } from "../lib/calculations/patterns";

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
  priceSeries: DailyBar[];
}
