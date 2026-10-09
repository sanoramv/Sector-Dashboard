import type { RawDataset } from "../../types/dataset";

export type DataStatus = "live" | "cached" | "stale" | "partial" | "unavailable";

export interface FetchResult {
  dataset: RawDataset;
  /** "live" only when this fetch just retrieved data matching the latest expected trading date; providers must not self-report "live" otherwise. */
  status: DataStatus;
  warnings: string[];
}

/**
 * Abstraction over where market data comes from, so the calculation engine
 * and UI never know (or care) whether a snapshot came from the bundled
 * static JSON, a future alternate provider, or a local dev proxy.
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchSnapshot(signal?: AbortSignal): Promise<FetchResult>;
}
