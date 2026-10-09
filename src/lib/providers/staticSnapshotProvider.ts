import type { RawDataset, Manifest } from "../../types/dataset";
import { SCHEMA_VERSION } from "../../types/dataset";
import type { IndexSeries, SectorConstituents, StockCloseSeries } from "../../types/market";
import type { DataStatus, FetchResult, MarketDataProvider } from "./types";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;
const STALE_THRESHOLD_DAYS = 5;

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  // Cache-bust so a "Refresh Data" click always re-checks the server rather
  // than silently reusing the browser's HTTP cache of a stale manifest.
  const url = `${DATA_BASE}/${path}?t=${Date.now()}`;
  const res = await fetch(url, { signal, cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${path}: HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 86_400_000;
  return Math.abs(new Date(isoA).getTime() - new Date(isoB).getTime()) / msPerDay;
}

/**
 * Reads the dataset published under /data by the scheduled fetch pipeline
 * (see scripts/*.mts and README.md). This is a STATIC snapshot, not a live
 * call to NSE: NSE's archive hosts don't send CORS headers, so a browser
 * (including this one running on GitHub Pages) cannot fetch them directly.
 * The pipeline runs server-side (GitHub Actions or a local run) and commits
 * validated JSON that this provider simply reads same-origin.
 *
 * "status" here only ever reflects THIS network fetch, not browser history:
 * - "live": fetch succeeded and the data isn't stale.
 * - "partial": fetch succeeded but the pipeline's own manifest reported warnings.
 * - "stale": fetch succeeded but the latest market date is suspiciously old,
 *   suggesting the scheduled pipeline itself has stopped running.
 * Whether to label something "cached" (served from THIS browser's prior
 * session without a fresh fetch) is decided by the caller, not here.
 */
export class StaticSnapshotProvider implements MarketDataProvider {
  readonly name = "NSE official archives (via scheduled fetch pipeline)";

  async fetchSnapshot(signal?: AbortSignal): Promise<FetchResult> {
    const manifest = await fetchJson<Manifest>("manifest.json", signal);

    if (manifest.schemaVersion !== SCHEMA_VERSION) {
      throw new Error(
        `Dataset schema version ${manifest.schemaVersion} is not compatible with this app build (expects ${SCHEMA_VERSION}). Rebuild/redeploy the site.`,
      );
    }

    const [indexSeries, constituents, stockCloses] = await Promise.all([
      fetchJson<Record<string, IndexSeries>>("index-series.json", signal),
      fetchJson<Record<string, SectorConstituents>>("constituents.json", signal),
      fetchJson<Record<string, StockCloseSeries>>("stocks.json", signal),
    ]);

    const dataset: RawDataset = { manifest, indexSeries, constituents, stockCloses };

    const today = new Date().toISOString().slice(0, 10);
    const staleDays = daysBetween(manifest.latestMarketDate, today);

    let status: DataStatus = "live";
    const warnings = [...manifest.warnings];
    if (staleDays > STALE_THRESHOLD_DAYS) {
      status = "stale";
      warnings.push(
        `Latest market data is dated ${manifest.latestMarketDate}, which is ${Math.round(staleDays)} days ago. The scheduled data pipeline may not be running.`,
      );
    } else if (manifest.warnings.length > 0) {
      status = "partial";
    }

    return { dataset, status, warnings };
  }
}
