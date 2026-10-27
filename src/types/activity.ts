/**
 * Daily trading activity per stock, extracted by the pipeline from the SAME
 * official NSE equity bhavcopy rows as the OHLC bars in stocks.json
 * (sec_bhavdata_full_DDMMYYYY.csv: TTL_TRD_QNTY, TURNOVER_LACS, DELIV_PER,
 * SERIES). Published separately as public/data/stock-activity.json so the
 * main dashboard's payload does not grow; only the Next-Day Momentum page
 * loads it.
 */

/** NSE series a row traded under. BE/BZ are trade-for-trade: every trade is settled by delivery (no intraday netting), so delivery % is 100% by rule there and says nothing about conviction. */
export type ActivitySeries = "EQ" | "RR" | "BE" | "BZ";

export interface ActivityRow {
  /** ISO session date - the same date as the matching OHLC bar. */
  date: string;
  /** Shares traded (TTL_TRD_QNTY). */
  volume: number;
  /** Traded value in Rs lakh (TURNOVER_LACS). */
  turnoverLakhs: number;
  /** Deliverable quantity as % of traded quantity (DELIV_PER); null when NSE publishes "-". */
  deliveryPct: number | null;
  series: ActivitySeries;
}

/** Column-oriented per-symbol encoding (keeps the published file small). */
export interface EncodedActivity {
  /** Indexes into StockActivityFile.dates, ascending. */
  d: number[];
  v: number[];
  t: number[];
  p: Array<number | null>;
  /** One character per row: E=EQ, R=RR, B=BE, Z=BZ. */
  s: string;
}

export interface StockActivityFile {
  schemaVersion: 1;
  source: string;
  /** Ascending ISO dates referenced by EncodedActivity.d. */
  dates: string[];
  symbols: Record<string, EncodedActivity>;
}
