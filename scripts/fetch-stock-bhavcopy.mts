/**
 * Fetches daily equity closing prices for every constituent stock across the
 * tracked sector universe, from NSE's official daily equity bhavcopy archive:
 *   https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv
 * This is the ONLY legitimate source this project uses for per-stock history,
 * which is what makes moving-average breadth a real, non-fabricated metric
 * instead of a guess. Like ind_close_all, it is official, requires no
 * authentication, and is not CORS-enabled for browsers - hence server-side only.
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
import type { SectorConstituents, StockCloseSeries } from "../src/types/market.ts";
import { fetchTextOrNull, mapWithConcurrency } from "./lib/http.mts";
import { toDdMmYyyy, toIsoDate, nseMonthNameDateToIso, weekdaysBack } from "./lib/dates.mts";
import { parseCsvObjects } from "./lib/csv.mts";

// 200-DMA needs 200 trading sessions; 300 calendar days (~214 weekdays) gives headroom
// for holidays while keeping the daily download volume (one ~340KB file per date) manageable.
const BACKFILL_DAYS = 300;
const PRUNE_BEYOND_DAYS = 330;
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

async function loadExisting(): Promise<Record<string, StockCloseSeries>> {
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
    existing[symbol] ??= { symbol, closes: [] };
  }

  const targetDates = weekdaysBack(BACKFILL_DAYS);
  // A date needs fetching if ANY tracked symbol is missing it. Checking one
  // representative symbol's date set is a good-enough heuristic for "have we
  // already processed this date" without an O(symbols x dates) scan.
  const sampleSymbol = [...requiredSymbols][0];
  const haveDate = new Set(existing[sampleSymbol]?.closes.map((c) => c.date) ?? []);
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
      const close = Number(row["CLOSE_PRICE"]);
      if (!Number.isFinite(close) || close <= 0) continue;
      const iso = nseMonthNameDateToIso(row["DATE1"]);
      existing[symbol].closes.push({ date: iso, close });
    }
  });

  const cutoffIso = toIsoDate(weekdaysBack(PRUNE_BEYOND_DAYS)[weekdaysBack(PRUNE_BEYOND_DAYS).length - 1]);
  for (const symbol of Object.keys(existing)) {
    const dedup = new Map(existing[symbol].closes.map((c) => [c.date, c]));
    existing[symbol].closes = [...dedup.values()]
      .filter((c) => c.date >= cutoffIso)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(existing));

  const withData = Object.values(existing).filter((s) => s.closes.length > 0).length;
  console.log(
    `[stocks] done. fetched=${fetched} notFound(holiday/weekend)=${notFound} failed=${failed}. ${withData}/${requiredSymbols.size} symbols have data. Wrote ${OUT_PATH}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
