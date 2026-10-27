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

/**
 * What the last pipeline run actually achieved (see scripts/lib/refresh-state.mts).
 * Optional so manifests written before it existed still load.
 */
export interface RefreshStatus {
  /** complete: every due date resolved. partial: recent data complete, older gaps/backfill remain. failed: a recent trading day is missing. */
  outcome: "complete" | "partial" | "failed";
  /** When the pipeline run that produced this manifest evaluated its data (ISO datetime). */
  evaluatedAt: string;
  /** When a run last ended "complete" - NOT advanced by partial or failed runs (null if never). */
  lastCompleteRefreshAt: string | null;
  /** Latest weekday whose NSE archives were due when the run happened (ISO date). */
  latestDueDate: string;
  /** Due trading days after latestMarketDate that are missing. */
  tradingDaysBehind: number;
  /** Plain-language reasons the outcome is not "complete". */
  reasons: string[];
}

/** Status of supplementary datasets used only by the Next-Day Momentum page. Never affects `refresh`. Null fields = file missing/unreadable. */
export interface SupplementStatus {
  activity: { latestDate: string | null; sessions: number } | null;
  announcements: {
    lastSuccessfulReadAt: string | null;
    lastAttemptAt: string | null;
    lastAttemptOutcome: "ok" | "failed" | null;
    lastAttemptDetail: string | null;
    retainedItems: number;
    retentionDays: number;
  } | null;
}

export interface Manifest {
  schemaVersion: number;
  /** When this manifest file was written by the pipeline (ISO datetime). Says nothing about whether market data advanced - see `refresh`. */
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
  refresh?: RefreshStatus;
  supplements?: SupplementStatus;
}

import type { IndexSeries, SectorConstituents, StockSeries } from "./market";

export interface RawDataset {
  manifest: Manifest;
  indexSeries: Record<string, IndexSeries>; // keyed by slug, includes benchmark
  constituents: Record<string, SectorConstituents>; // keyed by slug
  stocks: Record<string, StockSeries>; // keyed by symbol
}
