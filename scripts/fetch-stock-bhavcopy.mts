/**
 * Fetches daily equity OHLC prices for every constituent stock across the
 * tracked sector universe, from NSE's official daily equity bhavcopy archive:
 *   https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
 * This is the ONLY legitimate source this project uses for per-stock history,
 * which is what makes moving-average breadth, 52-week-high distance and
 * pattern detection real, non-fabricated metrics instead of a guess. Like
 * ind_close_all, it is official, requires no authentication, and is not
 * CORS-enabled for browsers - hence server-side only.
 *
 * Full OHLC (not just close) is captured: 52-week-high distance uses the
 * daily high, and pattern detection (consolidation range, triangle
 * trendlines) needs the daily high/low, not just the close.
 *
 * Requires public/data/constituents.json to already exist (run
 * `npm run fetch:constituents` first). Only EQ-series rows for symbols that
 * actually appear in the tracked universe are kept; everything else in the
 * ~3000-row daily file is discarded immediately to keep storage small.
 *
 * Incremental like fetch-index-history.mts: fetches only missing dates,
 * merges with the existing public/data/stocks.json, prunes anything older
 * than the backfill window.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SectorConstituents, StockSeries } from "../src/types/market.ts";
import { fetchTextOrNull, mapWithConcurrency } from "./lib/http.mts";
import { toDdMmYyyy, toIsoDate, nseMonthNameDateToIso, weekdaysBack } from "./lib/dates.mts";
import { parseCsvObjects } from "./lib/csv.mts";

// 52-week-high distance needs ~365 calendar days of history (see
// distanceFromHigh.ts); 420 days of backfill matches the index-history
// window and gives headroom for holidays while keeping the daily download
// volume (one ~340KB file per date) manageable.
const BACKFILL_DAYS = 420;
const PRUNE_BEYOND_DAYS = 450;
const CONSTITUENTS_PATH = path.resolve("public/data/constituents.json");
const OUT_PATH = path.resolve("public/data/stocks.json");
const CONCURRENCY = 4;

async function loadRequiredSymbols(): Promise<Set<string>> {
  const text = await readFile(CONSTITUENTS_PATH, "utf-8");
  const constituents: Record<string, SectorConstituents> = JSON.parse(text);
  const symbols = new Set<string>();
  for (const sector of Object.values(constituents)) {
    for (const c of sector.constituents) symbols.add(c.symbol);
  }
  return symbols;
}

async function loadExisting(): Promise<Record<string, StockSeries>> {
  try {
    return JSON.parse(await readFile(OUT_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function buildUrl(date: Date): string {
  return `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${toDdMmYyyy(date)}.csv`;
}

async function main() {
  const requiredSymbols = await loadRequiredSymbols();
  console.log(`[stocks] tracking ${requiredSymbols.size} unique symbols across the sector universe.`);

  const existing = await loadExisting();
  for (const symbol of requiredSymbols) {
    existing[symbol] ??= { symbol, bars: [] };
  }

  const targetDates = weekdaysBack(BACKFILL_DAYS);
  // A date needs fetching if ANY tracked symbol is missing it. Checking one
  // representative symbol's date set is a good-enough heuristic for "have we
  // already processed this date" without an O(symbols x dates) scan.
  const sampleSymbol = [...requiredSymbols][0];
  const haveDate = new Set(existing[sampleSymbol]?.bars.map((b) => b.date) ?? []);
  const missingDates = targetDates.filter((d) => !haveDate.has(toIsoDate(d)));

  console.log(`[stocks] ${missingDates.length} of ${targetDates.length} target dates need fetching.`);

  let fetched = 0;
  let notFound = 0;
  let failed = 0;

  await mapWithConcurrency(missingDates, CONCURRENCY, async (date) => {
    const url = buildUrl(date);
    let text: string | null;
    try {
      text = await fetchTextOrNull(url, { timeoutMs: 30_000 });
    } catch (err) {
      failed += 1;
      console.warn(`[stocks] failed ${toIsoDate(date)}: ${String(err)}`);
      return;
    }
    if (text === null) {
      notFound += 1;
      return;
    }
    fetched += 1;

    const rows = parseCsvObjects(text);
    for (const row of rows) {
      if (row["SERIES"] !== "EQ") continue;
      const symbol = row["SYMBOL"];
      if (!requiredSymbols.has(symbol)) continue;
      const bar = {
        date: nseMonthNameDateToIso(row["DATE1"]),
        open: Number(row["OPEN_PRICE"]),
        high: Number(row["HIGH_PRICE"]),
        low: Number(row["LOW_PRICE"]),
        close: Number(row["CLOSE_PRICE"]),
      };
      if (![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) continue;
      existing[symbol].bars.push(bar);
    }
  });

  const cutoffIso = toIsoDate(weekdaysBack(PRUNE_BEYOND_DAYS)[weekdaysBack(PRUNE_BEYOND_DAYS).length - 1]);
  for (const symbol of Object.keys(existing)) {
    const dedup = new Map(existing[symbol].bars.map((b) => [b.date, b]));
    existing[symbol].bars = [...dedup.values()]
      .filter((b) => b.date >= cutoffIso)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(existing));

  const withData = Object.values(existing).filter((s) => s.bars.length > 0).length;
  console.log(
    `[stocks] done. fetched=${fetched} notFound(holiday/weekend)=${notFound} failed=${failed}. ${withData}/${requiredSymbols.size} symbols have data. Wrote ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
