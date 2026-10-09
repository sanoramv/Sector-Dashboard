/**
 * Shape of the static dataset published under /data by the scheduled fetch
 * pipeline (scripts/*.mts) and consumed by StaticSnapshotProvider at runtime.
 * Bump SCHEMA_VERSION whenever a breaking shape change is made, so old cached
 * copies in a user's browser are detected and discarded instead of misread.
 *
 * v2: stock series store full OHLC bars (not close-only), and constituent
 * records carry an `industry` classification - both needed for stock
 * screening, pattern detection and industry-level analysis.
 */
export const SCHEMA_VERSION = 2;

export interface Manifest {
  schemaVersion: number;
  /** When the fetch pipeline last ran successfully (ISO datetime). */
  generatedAt: string;
  /** The latest trading-day date present across the index series (ISO date). */
  latestMarketDate: string;
  /** Data source attribution shown in the header. */
  source: {
    name: string;
    indexDataUrl: string;
    constituentDataUrl: string;
    equityDataUrl: string;
  };
  sectors: string[]; // slugs, matches SECTOR_UNIVERSE
  benchmark: string; // slug
  /** Per-sector note on any fetch issues during the last pipeline run. */
  warnings: string[];
}

import type { IndexSeries, SectorConstituents, StockSeries } from "./market";

export interface RawDataset {
  manifest: Manifest;
  indexSeries: Record<string, IndexSeries>; // keyed by slug, includes benchmark
  constituents: Record<string, SectorConstituents>; // keyed by slug
  stocks: Record<string, StockSeries>; // keyed by symbol
}
