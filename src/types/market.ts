/** One trading day's OHLC close record for an index or a stock. */
export interface DailyBar {
  /** ISO date string, e.g. "2026-10-08". Always the trading/close date, never a fetch timestamp. */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** Full historical close series for one index. */
export interface IndexSeries {
  slug: string;
  nseIndexName: string;
  /** Ascending by date, deduplicated, no gaps verified (holidays simply absent). */
  bars: DailyBar[];
}

/**
 * Full OHLC historical series for one constituent stock. Full OHLC (not just
 * close) is needed for 52-week-high distance (uses the daily high) and for
 * pattern detection (consolidation range, triangle trendlines), both of
 * which need the intraday high/low, not just the closing price.
 */
export interface StockSeries {
  symbol: string;
  /** Ascending by date, deduplicated. */
  bars: DailyBar[];
}

export interface ConstituentRef {
  symbol: string;
  companyName: string;
  /** NSE's published industry classification for this stock (from the constituent list CSV's "Industry" column). */
  industry: string;
}

export interface SectorConstituents {
  slug: string;
  constituents: ConstituentRef[];
  /** When the constituent list itself was last fetched (changes rarely). */
  fetchedAt: string;
}
