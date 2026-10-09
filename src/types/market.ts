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

/** Close-only series for one constituent stock (sufficient for MA breadth). */
export interface StockCloseSeries {
  symbol: string;
  /** Ascending by date. */
  closes: Array<{ date: string; close: number }>;
}

export interface ConstituentRef {
  symbol: string;
  companyName: string;
}

export interface SectorConstituents {
  slug: string;
  constituents: ConstituentRef[];
  /** When the constituent list itself was last fetched (changes rarely). */
  fetchedAt: string;
}
