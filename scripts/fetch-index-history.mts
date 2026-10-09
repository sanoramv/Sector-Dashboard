/**
 * Fetches historical daily closes for every sector index + the NIFTY 500
 * benchmark from NSE's official daily all-indices archive:
 *   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 * This file is published once per trading day by NSE itself and requires no
 * authentication. It is NOT CORS-enabled for browser fetches, which is why
 * this script runs server-side (locally or in GitHub Actions) and publishes
 * the result as static JSON for the frontend to read same-origin.
 *
 * Incremental: reads the existing public/data/index-series.json (if present),
 * fetches only the dates missing within the backfill window, merges, sorts,
 * dedupes and prunes anything older than the window. Safe to re-run daily.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK, SECTOR_UNIVERSE } from "../src/config/sectorUniverse.ts";
import { MARKET_CAP_SEGMENTS } from "../src/config/marketCapSegments.ts";
import type { IndexSeries } from "../src/types/market.ts";
import { fetchTextOrNull, mapWithConcurrency } from "./lib/http.mts";
import { toDdMmYyyy, toIsoDate, nseDateToIso, weekdaysBack } from "./lib/dates.mts";
import { parseCsvObjects } from "./lib/csv.mts";

const BACKFILL_DAYS = 420; // > 365 days so a full 52-week high/return window is always available
const PRUNE_BEYOND_DAYS = 450;
const OUT_PATH = path.resolve("public/data/index-series.json");
const CONCURRENCY = 5;

// MARKET_CAP_SEGMENTS includes NIFTY 500 again (as the self-benchmark entry) -
// excluded here since it's already covered by BENCHMARK, same slug/index name.
const NEW_SEGMENT_DEFS = MARKET_CAP_SEGMENTS.filter((s) => s.slug !== BENCHMARK.slug);
const ALL_DEFS = [BENCHMARK, ...SECTOR_UNIVERSE, ...NEW_SEGMENT_DEFS];

async function loadExisting(): Promise<Record<string, IndexSeries>> {
  try {
    const text = await readFile(OUT_PATH, "utf-8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function buildUrl(date: Date): string {
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${toDdMmYyyy(date)}.csv`;
}

async function main() {
  const existing = await loadExisting();
  for (const def of ALL_DEFS) {
    existing[def.slug] ??= { slug: def.slug, nseIndexName: def.nseIndexName, bars: [] };
  }

  const targetDates = weekdaysBack(BACKFILL_DAYS);
  const existingDateSets = new Map(
    ALL_DEFS.map((def) => [def.slug, new Set(existing[def.slug].bars.map((b) => b.date))]),
  );

  // A date only needs fetching if at least one sector is missing it.
  const missingDates = targetDates.filter((d) => {
    const iso = toIsoDate(d);
    return ALL_DEFS.some((def) => !existingDateSets.get(def.slug)!.has(iso));
  });

  console.log(`[index-history] ${missingDates.length} of ${targetDates.length} target dates need fetching.`);

  let fetched = 0;
  let notFound = 0;
  let failed = 0;

  await mapWithConcurrency(missingDates, CONCURRENCY, async (date) => {
    const url = buildUrl(date);
    let text: string | null;
    try {
      text = await fetchTextOrNull(url);
    } catch (err) {
      failed += 1;
      console.warn(`[index-history] failed ${toIsoDate(date)}: ${String(err)}`);
      return;
    }
    if (text === null) {
      notFound += 1; // weekend/holiday - no file published, not an error
      return;
    }
    fetched += 1;

    const rows = parseCsvObjects(text);
    for (const def of ALL_DEFS) {
      const row = rows.find((r) => r["Index Name"]?.trim() === def.nseIndexName);
      if (!row) continue;
      const iso = nseDateToIso(row["Index Date"]);
      const bar = {
        date: iso,
        open: Number(row["Open Index Value"]),
        high: Number(row["High Index Value"]),
        low: Number(row["Low Index Value"]),
        close: Number(row["Closing Index Value"]),
      };
      if (![bar.open, bar.high, bar.low, bar.close].every((v) => Number.isFinite(v) && v > 0)) continue;
      existing[def.slug].bars.push(bar);
      existingDateSets.get(def.slug)!.add(iso);
    }
  });

  const cutoffIso = toIsoDate(weekdaysBack(PRUNE_BEYOND_DAYS)[weekdaysBack(PRUNE_BEYOND_DAYS).length - 1]);
  for (const def of ALL_DEFS) {
    const dedup = new Map(existing[def.slug].bars.map((b) => [b.date, b]));
    existing[def.slug].bars = [...dedup.values()]
      .filter((b) => b.date >= cutoffIso)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(existing, null, 2));

  console.log(
    `[index-history] done. fetched=${fetched} notFound(holiday/weekend)=${notFound} failed=${failed}. Wrote ${OUT_PATH}`,
  );
  for (const def of ALL_DEFS) {
    console.log(`  ${def.slug}: ${existing[def.slug].bars.length} bars`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
