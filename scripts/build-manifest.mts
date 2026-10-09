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
  };

  await writeFile(path.join(DATA_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`[manifest] latestMarketDate=${latestMarketDate} warnings=${warnings.length}`);
  warnings.forEach((w) => console.log(`  - ${w}`));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
