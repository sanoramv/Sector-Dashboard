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
 * `npm run fetch:constituents` first). Only rows for symbols that actually
 * appear in the tracked universe are kept, and only in the series NSE uses
 * for their instrument type; everything else in the ~3000-row daily file is
 * discarded immediately to keep storage small. TRACKED_SERIES below is
 * deliberately not just "EQ": a handful of legitimate index constituents
 * (e.g. BAGMANE, BIRET, EMBASSY - REITs that are real NIFTY 500/Smallcap 250
 * constituents) trade under NSE's "RR" (REIT/InvIT) series, not "EQ". An
 * earlier EQ-only filter silently excluded them, surfacing as a
 * "no price history" data-quality warning for stocks that actually do
 * trade - see README's "Known limitations" for the remaining, genuinely
 * non-trading cases (dummy corporate-action placeholder symbols, and
 * constituent-list entries ahead of their actual trading start).
 *
 * Which dates to request, and what happened to each, is tracked in
 * public/data/refresh-state.json (see scripts/lib/refresh-state.mts). A date
 * is re-extracted when it was never resolved, previously failed, or was
 * ingested for a different symbol/series set (so adding a series or symbols
 * backfills them, in bounded batches) - not, as before, whenever any one
 * symbol lacks it, which re-downloaded every date on every run because
 * placeholder symbols never have rows.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StockSeries } from "../src/types/market.ts";
import type { ActivityRow, StockActivityFile } from "../src/types/activity.ts";
import { decodeAllActivity, encodeActivity } from "../src/lib/activity.ts";
import { createPacer, fetchArchive, mapWithConcurrency } from "./lib/http.mts";
import { toDdMmYyyy } from "./lib/dates.mts";
import { validateArchiveText } from "./lib/archives.mts";
import { finalizeBars, ingestStockOutcome } from "./lib/ingest.mts";
import { STOCK_EXTRACT_FIELDS, TRACKED_SERIES, loadRequiredSymbols } from "./lib/series.mts";
import {
  BOOTSTRAP_HASH,
  emptyState,
  loadState,
  planFetch,
  pruneState,
  saveState,
  symbolSetHash,
  targetDates,
  type RefreshState,
} from "./lib/refresh-state.mts";

// 52-week-high distance needs ~365 calendar days of history (see
// distanceFromHigh.ts); 420 days of backfill matches the index-history
// window and gives headroom for holidays while keeping the daily download
// volume (one ~400KB file per date) manageable.
const BACKFILL_DAYS = 420;
const PRUNE_BEYOND_DAYS = 450;
const OUT_PATH = path.resolve("public/data/stocks.json");
const ACTIVITY_PATH = path.resolve("public/data/stock-activity.json");
const STATE_PATH = path.resolve("public/data/refresh-state.json");
const CONCURRENCY = 2;
const MIN_REQUEST_INTERVAL_MS = 400;
const MAX_BACKFILL_DATES = Number(process.env.MAX_BACKFILL_DATES ?? 40);
// Which NSE series are kept (EQ, RR, BE, BZ) is defined in scripts/lib/series.mts.
/** A validated file must contain at least this share of the symbols expected to trade that day, or it is not merged. */
const MIN_SYMBOL_COVERAGE = 0.8;

async function loadExisting(): Promise<Record<string, StockSeries>> {
  let text: string;
  try {
    text = await readFile(OUT_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return JSON.parse(text); // a corrupt file throws: never silently restart from empty
}

/** Volume/turnover/delivery rows already published (see src/types/activity.ts). A corrupt file throws - it is never silently reset. */
async function loadExistingActivity(): Promise<Record<string, ActivityRow[]>> {
  let text: string;
  try {
    text = await readFile(ACTIVITY_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  const file = JSON.parse(text) as StockActivityFile;
  if (file.schemaVersion !== 1 || !Array.isArray(file.dates) || typeof file.symbols !== "object") {
    throw new Error(`${ACTIVITY_PATH} has an unexpected shape - refusing to overwrite it`);
  }
  return decodeAllActivity(file);
}

function buildUrl(iso: string): string {
  return `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${toDdMmYyyy(new Date(`${iso}T00:00:00Z`))}.csv`;
}

/** First run with the state file: any date some stock has a bar for was ingested before, under the pre-BE/BZ rules. */
function bootstrapFrom(existing: Record<string, StockSeries>, base: () => RefreshState): () => RefreshState {
  return () => {
    const state = base();
    for (const series of Object.values(existing)) {
      for (const b of series.bars) state.archives.stocks[b.date] ??= { status: "ok", checkedAt: "bootstrap", symbolSetHash: BOOTSTRAP_HASH };
    }
    return state;
  };
}

async function main() {
  const requiredSymbols = await loadRequiredSymbols(path.resolve("public/data/constituents.json"));
  const hash = symbolSetHash(requiredSymbols, TRACKED_SERIES, STOCK_EXTRACT_FIELDS);
  console.log(`[stocks] tracking ${requiredSymbols.size} unique symbols in series ${[...TRACKED_SERIES].join("/")} (set ${hash}).`);

  const existing = await loadExisting();
  const activity = await loadExistingActivity();
  const activitySkipped = { count: 0 };
  for (const symbol of requiredSymbols) {
    existing[symbol] ??= { symbol, bars: [] };
  }
  // The index step normally creates the state file first; bootstrap covers running this script alone.
  const state = await loadState(STATE_PATH, bootstrapFrom(existing, emptyState));
  if (Object.keys(state.archives.stocks).length === 0) bootstrapFrom(existing, () => state)();

  const targets = targetDates(new Date(), BACKFILL_DAYS);
  const plan = planFetch("stocks", targets, state, { maxBackfill: MAX_BACKFILL_DATES, currentSymbolSetHash: hash });
  const dates = [...plan.recent, ...plan.backfill];
  console.log(
    `[stocks] latest due date ${targets[0]}; fetching ${plan.recent.length} recent + ${plan.backfill.length} backfill date(s)` +
      (plan.deferred > 0 ? `; ${plan.deferred} older date(s) deferred to later runs (raise MAX_BACKFILL_DATES to catch up faster)` : ""),
  );

  // Symbols expected to trade on a date: those whose existing history spans it
  // (or is current, for dates newer than our data). Used to reject a file that
  // validates structurally but lacks most of our universe.
  const spans = Object.values(existing)
    .filter((s) => s.bars.length > 0)
    .map((s) => ({ first: s.bars[0].date, last: s.bars[s.bars.length - 1].date }));
  const latestStockDate = spans.reduce((m, s) => (s.last > m ? s.last : m), "");
  const expectedOn = (iso: string) => spans.filter((s) => s.first <= iso && s.last >= (iso < latestStockDate ? iso : latestStockDate)).length;

  const pacer = createPacer(MIN_REQUEST_INTERVAL_MS);
  const tally: Record<string, number> = {};
  const rowsPerSeries = new Map<string, number>();
  await mapWithConcurrency(dates, CONCURRENCY, async (iso) => {
    const outcome = await fetchArchive(buildUrl(iso), { label: `stocks ${iso}`, validate: (t) => validateArchiveText("stocks", t), pacer });
    const entry = ingestStockOutcome(existing, state, iso, outcome, {
      requiredSymbols,
      trackedSeries: TRACKED_SERIES,
      symbolSetHash: hash,
      expectedSymbols: expectedOn(iso),
      minCoverage: MIN_SYMBOL_COVERAGE,
      checkedAt: new Date().toISOString(),
      rowsPerSeries,
      activity,
      activitySkipped,
    });
    if (entry.status === "failed" || entry.status === "invalid" || entry.status === "incomplete") {
      console.warn(`[stocks] UNRESOLVED ${iso}: ${entry.status} (${entry.detail}) after ${entry.attempts} attempt(s) - existing data kept`);
    }
    const s = state.archives.stocks[iso].status;
    tally[s] = (tally[s] ?? 0) + 1;
  });

  const cutoffIso = targetDates(new Date(), PRUNE_BEYOND_DAYS).at(-1)!;
  // Later bars for the same date win: a re-extracted date replaces the old row.
  for (const symbol of Object.keys(existing)) existing[symbol].bars = finalizeBars(existing[symbol].bars, cutoffIso);
  for (const symbol of Object.keys(activity)) activity[symbol] = finalizeBars(activity[symbol], cutoffIso);
  pruneState(state, cutoffIso);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(existing));
  await writeFile(ACTIVITY_PATH, JSON.stringify(encodeActivity(activity)));
  await saveState(STATE_PATH, state);

  const withData = Object.values(existing).filter((s) => s.bars.length > 0).length;
  const newest = Object.values(existing).reduce((m, s) => (s.bars.length && s.bars[s.bars.length - 1].date > m ? s.bars[s.bars.length - 1].date : m), "");
  console.log(`[stocks] done. outcomes this run: ${JSON.stringify(tally)}. ${withData}/${requiredSymbols.size} symbols have data; newest bar ${newest || "none"}.`);
  console.log(`[stocks] rows kept this run by series: ${JSON.stringify(Object.fromEntries(rowsPerSeries))}`);
  const activityDates = new Set(Object.values(activity).flatMap((rows) => rows.map((r) => r.date)));
  console.log(
    `[stocks] activity (volume/turnover/delivery): ${activityDates.size} date(s) across ${Object.keys(activity).length} symbols` +
      (activitySkipped.count > 0 ? `; ${activitySkipped.count} row(s) this run had unparseable activity columns (bar kept, no activity recorded)` : ""),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
