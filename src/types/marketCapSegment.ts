import type { SectorMetrics } from "./metrics";

export interface ConstituentCoverage {
  totalConstituents: number;
  /** Constituents with at least one valid price bar anywhere in the tracked history. */
  symbolsWithHistory: number;
  missingHistoryCount: number;
}

/**
 * Full computed metrics for one market-cap segment panel (NIFTY 500, Midcap
 * 150, Smallcap 250 or Microcap 250). Reuses the exact same SectorMetrics
 * shape/calculation engine as sectors and industries - a market-cap segment
 * is, computationally, just another "basket of stocks with an index", so no
 * new calculation logic was written for returns/breadth/distance/regime.
 */
export interface MarketCapSegmentMetrics {
  slug: string;
  panelLabel: string;
  isSelfBenchmark: boolean;
  overlapNote: string;
  metrics: SectorMetrics;
  coverage: ConstituentCoverage;
}
