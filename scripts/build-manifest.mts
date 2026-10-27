/**
 * Builds public/data/manifest.json, the small file the frontend reads first
 * on every "Refresh Data" click to learn the latest market date, pipeline
 * run time, and any data-quality warnings - before deciding whether to fetch
 * the (much larger) index-series.json / stocks.json files at all.
 * Must run last, after fetch-constituents / fetch-index-history / fetch-stock-bhavcopy.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK, SECTOR_UNIVERSE } from "../src/config/sectorUniverse.ts";
import type { IndexSeries, SectorConstituents, StockSeries } from "../src/types/market.ts";
import type { Manifest } from "../src/types/dataset.ts";
import { SCHEMA_VERSION } from "../src/types/dataset.ts";
import { isStale, splitAtPriceBreaks, type PriceBreakKind } from "../src/lib/calculations/validation.ts";
import { evaluateRefresh, loadState, symbolSetHash, targetDates, toRefreshStatus } from "./lib/refresh-state.mts";
import { STOCK_EXTRACT_FIELDS, TRACKED_SERIES, loadRequiredSymbols } from "./lib/series.mts";

/** Must match the fetch scripts' window. */
const BACKFILL_DAYS = 420;

const DATA_DIR = path.resolve("public/data");

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(path.join(DATA_DIR, file), "utf-8"));
}

async function main() {
  const indexSeries = await readJson<Record<string, IndexSeries>>("index-series.json");
  const constituents = await readJson<Record<string, SectorConstituents>>("constituents.json");
  const stocks = await readJson<Record<string, StockSeries>>("stocks.json");

  const latestDates = Object.values(indexSeries)
    .map((s) => s.bars.at(-1)?.date)
    .filter((d): d is string => Boolean(d));
  if (latestDates.length === 0) {
    throw new Error("No index series data found - run fetch-index-history before build-manifest.");
  }
  const latestMarketDate = latestDates.sort().at(-1)!;

  const warnings: string[] = [];
  const staleSeries = Object.values(indexSeries).filter((s) => s.bars.at(-1)?.date !== latestMarketDate);
  if (staleSeries.length > 0) {
    warnings.push(
      `${staleSeries.length} series did not reach the latest market date (${staleSeries.map((s) => s.slug).join(", ")}).`,
    );
  }

  let symbolsWithNoData = 0;
  let totalSymbols = 0;
  for (const sector of Object.values(constituents)) {
    for (const c of sector.constituents) {
      totalSymbols += 1;
      if (!stocks[c.symbol] || stocks[c.symbol].bars.length === 0) symbolsWithNoData += 1;
    }
  }
  if (symbolsWithNoData > 0) {
    warnings.push(
      `${symbolsWithNoData} of ${totalSymbols} tracked constituent references have no price history yet (breadth for affected sectors will show reduced eligibility).`,
    );
  }

  // Per-symbol data-quality checks, so problems are visible on the homepage
  // instead of only surfacing as odd numbers in individual rows.
  const benchmarkDates = indexSeries[BENCHMARK.slug]?.bars.map((b) => b.date) ?? [];
  const staleSymbols: string[] = [];
  const byKind: Record<PriceBreakKind, string[]> = { "corporate-action-break": [], "unverified-discontinuity": [], "missing-sessions": [] };
  for (const [symbol, series] of Object.entries(stocks)) {
    if (series.bars.length === 0) continue;
    const last = series.bars[series.bars.length - 1].date;
    if (isStale(last, latestMarketDate)) staleSymbols.push(`${symbol} (last ${last})`);
    for (const br of splitAtPriceBreaks(series.bars, benchmarkDates).breaks) {
      byKind[br.kind].push(
        br.kind === "missing-sessions"
          ? `${symbol} ${br.prevDate}..${br.date} (${br.missingSessions})`
          : `${symbol} ${br.date} x${br.ratio.toFixed(2)}`,
      );
    }
  }
  if (staleSymbols.length > 0) {
    warnings.push(
      `${staleSymbols.length} stock(s) have no price within 7 days of ${latestMarketDate}; they get no metrics or score and are excluded from breadth and industry averages: ${staleSymbols.join(", ")}.`,
    );
  }
  if (byKind["missing-sessions"].length > 0) {
    warnings.push(
      `${byKind["missing-sessions"].length} gap(s) of missing trading sessions in stock histories; affected stocks use only prices after their latest gap: ${byKind["missing-sessions"].join(", ")}.`,
    );
  }
  if (byKind["corporate-action-break"].length > 0) {
    warnings.push(
      `${byKind["corporate-action-break"].length} suspected unadjusted corporate-action break(s) (NSE prices are not split/bonus-adjusted); affected stocks use only post-break prices: ${byKind["corporate-action-break"].join(", ")}.`,
    );
  }
  if (byKind["unverified-discontinuity"].length > 0) {
    warnings.push(
      `${byKind["unverified-discontinuity"].length} unverified price discontinuity(ies) - a 15%+ gap-down that may be an unadjusted bonus/rights issue or a genuine fall (no official adjustment factors available); affected stocks use only later prices: ${byKind["unverified-discontinuity"].join(", ")}. Smaller corporate actions are not detected.`,
    );
  }

  // Refresh outcome: judged from what each date's archives actually returned,
  // not from whether the fetch scripts exited.
  const state = await loadState(path.join(DATA_DIR, "refresh-state.json"), () => {
    throw new Error("public/data/refresh-state.json is missing - run fetch-index-history and fetch-stock-bhavcopy first.");
  });
  const benchmarkLatest = indexSeries[BENCHMARK.slug]?.bars.at(-1)?.date ?? latestMarketDate;
  const hash = symbolSetHash(await loadRequiredSymbols(path.join(DATA_DIR, "constituents.json")), TRACKED_SERIES, STOCK_EXTRACT_FIELDS);
  const now = new Date();
  const summary = evaluateRefresh(state, targetDates(now, BACKFILL_DAYS), benchmarkLatest, hash, now);
  let previousComplete: string | null = null;
  try {
    previousComplete = (await readJson<Manifest>("manifest.json")).refresh?.lastCompleteRefreshAt ?? null;
  } catch {
    // first manifest with refresh status
  }
  if (summary.outcome !== "complete") {
    warnings.unshift(
      `Data refresh ${summary.outcome.toUpperCase()} (pipeline run ${summary.evaluatedAt}): ${summary.reasons.join(" | ")}`,
    );
  }

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    latestMarketDate,
    source: {
      name: "NSE (National Stock Exchange of India) - official archives, fetched by a scheduled pipeline",
      indexDataUrl: "https://nsearchives.nseindia.com/content/indices/",
      constituentDataUrl: "https://niftyindices.com/IndexConstituent/",
      equityDataUrl: "https://nsearchives.nseindia.com/products/content/",
    },
    sectors: SECTOR_UNIVERSE.map((s) => s.slug),
    benchmark: BENCHMARK.slug,
    warnings,
    refresh: toRefreshStatus(summary, previousComplete),
  };

  await writeFile(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(
    `[manifest] latestMarketDate=${latestMarketDate} latestDueDate=${summary.latestDueDate} refresh=${summary.outcome} ` +
      `(behind ${summary.tradingDaysBehind}, unresolved recent ${summary.unresolvedRecent.length}, historical ${summary.unresolvedHistorical.length}, ` +
      `pending ${summary.pendingPublication.length}, non-trading ${summary.nonTradingDates}, backfill remaining ${summary.backfillRemaining}) warnings=${warnings.length}`,
  );
  warnings.forEach((w) => console.log(`  - ${w}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
