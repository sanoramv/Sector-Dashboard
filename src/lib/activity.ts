import type { ActivityRow, ActivitySeries, EncodedActivity, StockActivityFile } from "../types/activity";

/**
 * Encoding/decoding for public/data/stock-activity.json, shared by the
 * pipeline (which writes it) and the app (which reads it) so both always
 * agree on the format.
 */

export const ACTIVITY_SOURCE =
  "NSE official equity bhavcopy (sec_bhavdata_full_DDMMYYYY.csv): TTL_TRD_QNTY, TURNOVER_LACS, DELIV_PER, SERIES";

const SERIES_TO_CODE: Record<ActivitySeries, string> = { EQ: "E", RR: "R", BE: "B", BZ: "Z" };
const CODE_TO_SERIES: Record<string, ActivitySeries> = { E: "EQ", R: "RR", B: "BE", Z: "BZ" };

export function isActivitySeries(s: string): s is ActivitySeries {
  return s in SERIES_TO_CODE;
}

/** Rows per symbol (any order, duplicates allowed - a later row for the same date wins) -> the published file. */
export function encodeActivity(rowsBySymbol: Record<string, ActivityRow[]>): StockActivityFile {
  const perSymbol = new Map<string, ActivityRow[]>();
  const dateSet = new Set<string>();
  for (const [symbol, rows] of Object.entries(rowsBySymbol)) {
    const byDate = new Map(rows.map((r) => [r.date, r]));
    const sorted = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length === 0) continue;
    perSymbol.set(symbol, sorted);
    for (const r of sorted) dateSet.add(r.date);
  }
  const dates = [...dateSet].sort();
  const index = new Map(dates.map((d, i) => [d, i]));
  const symbols: Record<string, EncodedActivity> = {};
  for (const [symbol, rows] of [...perSymbol.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    symbols[symbol] = {
      d: rows.map((r) => index.get(r.date) as number),
      v: rows.map((r) => r.volume),
      t: rows.map((r) => r.turnoverLakhs),
      p: rows.map((r) => r.deliveryPct),
      s: rows.map((r) => SERIES_TO_CODE[r.series]).join(""),
    };
  }
  return { schemaVersion: 1, source: ACTIVITY_SOURCE, dates, symbols };
}

/** Decodes one symbol's rows (ascending by date). Throws on a malformed entry rather than guessing. */
export function decodeSymbolActivity(file: StockActivityFile, symbol: string): ActivityRow[] {
  const e = file.symbols[symbol];
  if (!e) return [];
  const n = e.d.length;
  if (e.v.length !== n || e.t.length !== n || e.p.length !== n || e.s.length !== n) {
    throw new Error(`stock-activity.json: column lengths differ for ${symbol}`);
  }
  const out: ActivityRow[] = [];
  for (let i = 0; i < n; i++) {
    const date = file.dates[e.d[i]];
    const series = CODE_TO_SERIES[e.s[i]];
    if (date === undefined || series === undefined) throw new Error(`stock-activity.json: bad date index or series code for ${symbol}`);
    out.push({ date, volume: e.v[i], turnoverLakhs: e.t[i], deliveryPct: e.p[i], series });
  }
  return out;
}

export function decodeAllActivity(file: StockActivityFile): Record<string, ActivityRow[]> {
  const out: Record<string, ActivityRow[]> = {};
  for (const symbol of Object.keys(file.symbols)) out[symbol] = decodeSymbolActivity(file, symbol);
  return out;
}

/** Parses one bhavcopy row's activity columns; null when volume/turnover are not valid non-negative numbers (never coerced to 0). */
export function parseActivityColumns(
  date: string,
  series: string,
  qty: string | undefined,
  turnoverLakhs: string | undefined,
  deliveryPct: string | undefined,
): ActivityRow | null {
  if (!isActivitySeries(series)) return null;
  const volume = Number(qty?.trim());
  const turnover = Number(turnoverLakhs?.trim());
  if (qty === undefined || qty.trim() === "" || !Number.isFinite(volume) || volume < 0) return null;
  if (turnoverLakhs === undefined || turnoverLakhs.trim() === "" || !Number.isFinite(turnover) || turnover < 0) return null;
  const dp = deliveryPct?.trim();
  const delivery = dp === undefined || dp === "" || dp === "-" ? null : Number(dp);
  return {
    date,
    volume,
    turnoverLakhs: turnover,
    deliveryPct: delivery !== null && Number.isFinite(delivery) && delivery >= 0 && delivery <= 100 ? delivery : null,
    series,
  };
}
