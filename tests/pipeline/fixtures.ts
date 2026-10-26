/**
 * CSV builders matching NSE's real archive formats. The header lines and
 * sample rows are copied verbatim from the official files for 2026-10-23
 * (ind_close_all_23102026.csv, sec_bhavdata_full_23102026.csv), fetched
 * 2026-10-26; filler rows pad the files to realistic row counts.
 */
export const INDEX_HEADER =
  "Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield";
export const STOCK_HEADER =
  "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;
const ddMonyyyy = (iso: string) => `${iso.slice(8, 10)}-${MONTHS[Number(iso.slice(5, 7)) - 1]}-${iso.slice(0, 4)}`;

/** An ind_close_all file for `iso` with Nifty 500 (real 2026-10-23 values) plus `extraRows` filler indices. */
export function indexCsv(iso: string, opts: { extraRows?: number; includeNifty500?: boolean } = {}): string {
  const d = ddmmyyyy(iso);
  const rows = [INDEX_HEADER];
  if (opts.includeNifty500 ?? true) rows.push(`Nifty 500,${d},21708.1,21718.45,21207.5,21427.6,-268.95,-1.24,3029207737,87564.27,20.84,3,1.35`);
  rows.push(`Nifty Auto,${d},24000,24100,23800,23950,-50,-.21,1,1,1,1,1`);
  for (let i = 0; i < (opts.extraRows ?? 120); i++) rows.push(`Filler Index ${i},${d},100,101,99,100.5,0,0,1,1,1,1,1`);
  return rows.join("\n") + "\n";
}

/** A sec_bhavdata_full file for `iso` containing the given symbols (and series) plus `filler` untracked rows. */
export function stockCsv(iso: string, symbols: Array<{ symbol: string; series?: string; close?: number }>, filler = 1200): string {
  const d = ddMonyyyy(iso);
  const rows = [STOCK_HEADER];
  for (const { symbol, series = "EQ", close = 100 } of symbols) {
    rows.push(`${symbol}, ${series}, ${d}, ${close}, ${close}, ${close * 1.01}, ${close * 0.99}, ${close}, ${close}, ${close}, 1000, 10.00, 100, 500, 50.00`);
  }
  for (let i = 0; i < filler; i++) rows.push(`FILL${i}, EQ, ${d}, 10, 10, 10.5, 9.5, 10, 10, 10, 1, 0.01, 1, 1, 100.00`);
  return rows.join("\n") + "\n";
}

/** The HTML page NSE's edge serves with a 404 (and which any proxy/CDN error page resembles). */
export const HTML_ERROR_PAGE = "<!DOCTYPE html>\n<html><head><title>Page Not Found</title></head><body>Sorry</body></html>";
