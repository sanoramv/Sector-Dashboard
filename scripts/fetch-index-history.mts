/**
 * Fetches historical daily closes for every sector index + the NIFTY 500
 * benchmark from NSE's official daily all-indices archive:
 *   https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
 * This file is published once per trading day by NSE itself and requires no
 * authentication. It is NOT CORS-enabled for browser fetches, which is why
 * this script runs server-side (locally or in GitHub Actions) and publishes
 * the result as static JSON for the frontend to read same-origin.
 *
 * Incremental and honest about failures: which dates to request comes from
 * public/data/refresh-state.json (see scripts/lib/refresh-state.mts), every
 * request goes through the shared retrying/validating fetchArchive(), and
 * every date's outcome (ok / 404 / failed / invalid) is recorded there. Only
 * rows from a validated file for exactly the requested date are merged;
 * existing data is never replaced by a failed or partial download. Whether
 * the refresh as a whole is complete is decided later by build-manifest and
 * enforced by check-refresh.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK } from "../src/config/sectorUniverse.ts";
import { ALL_INDEX_DEFS, INDEX_SET_HASH } from "./lib/index-defs.mts";
import type { IndexSeries } from "../src/types/market.ts";
import { createPacer, fetchArchive, mapWithConcurrency } from "./lib/http.mts";
import { toDdMmYyyy } from "./lib/dates.mts";
import { validateArchiveText } from "./lib/archives.mts";
import { finalizeBars, ingestIndexOutcome } from "./lib/ingest.mts";
import { emptyState, loadState, planFetch, pruneState, saveState, targetDates, type RefreshState } from "./lib/refresh-state.mts";

const BACKFILL_DAYS = 420; // > 365 days so a full 52-week high/return window is always available
const PRUNE_BEYOND_DAYS = 450;
const OUT_PATH = path.resolve("public/data/index-series.json");
const STATE_PATH = path.resolve("public/data/refresh-state.json");
const CONCURRENCY = 2;
const MIN_REQUEST_INTERVAL_MS = 400;
const MAX_BACKFILL_DATES = Number(process.env.MAX_BACKFILL_DATES ?? 40);

const ALL_DEFS = ALL_INDEX_DEFS;

async function loadExisting(): Promise<Record<string, IndexSeries>> {
  let text: string;
  try {
    text = await readFile(OUT_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return JSON.parse(text); // a corrupt file throws: never silently restart from empty
}

function buildUrl(iso: string): string {
  return `https://nsearchives.nseindia.com/content/indices/ind_close_all_${toDdMmYyyy(new Date(`${iso}T00:00:00Z`))}.csv`;
}

/** First run with the state file: dates already present in the benchmark series were downloaded OK before. */
function bootstrapFrom(existing: Record<string, IndexSeries>): () => RefreshState {
  return () => {
    const state = emptyState();
    for (const b of existing[BENCHMARK.slug]?.bars ?? []) {
      state.archives.index[b.date] = { status: "ok", checkedAt: "bootstrap" };
    }
    return state;
  };
}

async function main() {
  const existing = await loadExisting();
  for (const def of ALL_DEFS) {
    existing[def.slug] ??= { slug: def.slug, nseIndexName: def.nseIndexName, bars: [] };
  }
  const state = await loadState(STATE_PATH, bootstrapFrom(existing));

  const targets = targetDates(new Date(), BACKFILL_DAYS);
  const plan = planFetch("index", targets, state, { maxBackfill: MAX_BACKFILL_DATES, currentSymbolSetHash: INDEX_SET_HASH });
  const dates = [...plan.recent, ...plan.backfill];
  console.log(
    `[index-history] latest due date ${targets[0]}; fetching ${plan.recent.length} recent + ${plan.backfill.length} backfill date(s)` +
      (plan.deferred > 0 ? `; ${plan.deferred} older date(s) deferred to later runs` : ""),
  );

  const pacer = createPacer(MIN_REQUEST_INTERVAL_MS);
  const tally: Record<string, number> = {};
  await mapWithConcurrency(dates, CONCURRENCY, async (iso) => {
    const outcome = await fetchArchive(buildUrl(iso), { label: `index ${iso}`, validate: (t) => validateArchiveText("index", t), pacer });
    const entry = ingestIndexOutcome(existing, state, iso, outcome, {
      defs: ALL_DEFS,
      benchmarkIndexName: BENCHMARK.nseIndexName,
      checkedAt: new Date().toISOString(),
      indexSetHash: INDEX_SET_HASH,
    });
    if (entry.status === "failed" || entry.status === "invalid") {
      console.warn(`[index-history] UNRESOLVED ${iso}: ${entry.status} (${entry.detail}) after ${entry.attempts} attempt(s)`);
    }
    const s = state.archives.index[iso].status;
    tally[s] = (tally[s] ?? 0) + 1;
  });

  const cutoffIso = targetDates(new Date(), PRUNE_BEYOND_DAYS).at(-1)!;
  for (const def of ALL_DEFS) existing[def.slug].bars = finalizeBars(existing[def.slug].bars, cutoffIso);
  pruneState(state, cutoffIso);

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(existing, null, 2));
  await saveState(STATE_PATH, state);

  console.log(`[index-history] done. outcomes this run: ${JSON.stringify(tally)}. Latest ${BENCHMARK.slug} bar: ${existing[BENCHMARK.slug].bars.at(-1)?.date ?? "none"}.`);
  for (const def of ALL_DEFS) {
    console.log(`  ${def.slug}: ${existing[def.slug].bars.length} bars`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
