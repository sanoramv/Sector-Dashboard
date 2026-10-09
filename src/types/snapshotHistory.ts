export interface SnapshotSectorSummary {
  slug: string;
  displayName: string;
  score: number;
  scorePossible: number;
  regime: string;
}

export interface SnapshotStockSummary {
  symbol: string;
  score: number;
  scorePossible: number;
}

/**
 * A compact, point-in-time summary recorded locally every time a refresh
 * successfully fetches NEW data (never for a merely-reloaded cached
 * snapshot) - lets a user see how rankings/regime distribution evolved
 * across sessions without re-storing the full multi-MB raw dataset per day.
 */
export interface SnapshotHistoryEntry {
  /** The market date this snapshot describes (manifest.latestMarketDate), used as the dedupe key. */
  marketDate: string;
  /** When this snapshot was recorded locally (ISO datetime). */
  recordedAt: string;
  bullishCount: number;
  sidewaysCount: number;
  bearishCount: number;
  insufficientDataCount: number;
  benchmarkReturn1m: number | null;
  topSectors: SnapshotSectorSummary[];
  topStocks: SnapshotStockSummary[];
}
