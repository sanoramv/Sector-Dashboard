import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RawDataset } from "../types/dataset";
import type { AppSettings } from "../types/config";
import type { DataStatus } from "../lib/providers/types";
import { StaticSnapshotProvider } from "../lib/providers/staticSnapshotProvider";
import { buildDashboardData, type DashboardData } from "../lib/dashboard";
import { idbDelete, idbGet, idbSet } from "../lib/storage/idbCache";
import { loadSettings, saveSettings } from "../lib/storage/settings";
import { listSnapshotHistory, recordSnapshot } from "../lib/storage/snapshotHistory";
import type { SnapshotHistoryEntry } from "../types/snapshotHistory";

const CACHE_KEY = "lastSnapshot:v1";
const REFRESH_TIMEOUT_MS = 45_000;

interface CachedSnapshot {
  dataset: RawDataset;
  cachedAt: string;
}

export type RefreshOutcome = "success" | "partial" | "failed" | null;

export interface MarketDataState {
  dashboardData: DashboardData | null;
  rawDataset: RawDataset | null;
  settings: AppSettings;
  status: DataStatus | "unavailable";
  warnings: string[];
  error: string | null;
  isRefreshing: boolean;
  lastFetchAttemptAt: string | null;
  lastSuccessfulFetchAt: string | null;
  lastRefreshOutcome: RefreshOutcome;
  providerName: string;
  snapshotHistory: SnapshotHistoryEntry[];
  refresh: () => Promise<void>;
  updateSettings: (settings: AppSettings) => void;
  clearCache: () => Promise<void>;
}

export function useMarketData(): MarketDataState {
  const provider = useMemo(() => new StaticSnapshotProvider(), []);
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [rawDataset, setRawDataset] = useState<RawDataset | null>(null);
  const [status, setStatus] = useState<DataStatus | "unavailable">("unavailable");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastFetchAttemptAt, setLastFetchAttemptAt] = useState<string | null>(null);
  const [lastSuccessfulFetchAt, setLastSuccessfulFetchAt] = useState<string | null>(null);
  const [lastRefreshOutcome, setLastRefreshOutcome] = useState<RefreshOutcome>(null);
  const [snapshotHistory, setSnapshotHistory] = useState<SnapshotHistoryEntry[]>([]);

  const isRefreshingRef = useRef(false);
  const hasAutoFetchedRef = useRef(false);

  // Load any previously cached snapshot immediately on mount so a returning
  // visitor sees data without waiting on the network - explicitly labeled
  // "cached", never "live", until a fresh fetch succeeds.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await idbGet<CachedSnapshot>(CACHE_KEY);
      if (cancelled || !cached) return;
      setRawDataset(cached.dataset);
      setStatus("cached");
      setLastSuccessfulFetchAt(cached.cachedAt);
    })();
    (async () => {
      const history = await listSnapshotHistory();
      if (!cancelled) setSnapshotHistory(history);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (isRefreshingRef.current) return; // prevent concurrent/overlapping refreshes
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    setError(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    const attemptedAt = new Date().toISOString();
    setLastFetchAttemptAt(attemptedAt);

    try {
      const result = await provider.fetchSnapshot(controller.signal);
      setRawDataset(result.dataset);
      setStatus(result.status);
      setWarnings(result.warnings);
      setLastSuccessfulFetchAt(new Date().toISOString());
      setLastRefreshOutcome(result.status === "partial" || result.status === "stale" ? "partial" : "success");
      await idbSet<CachedSnapshot>(CACHE_KEY, { dataset: result.dataset, cachedAt: new Date().toISOString() });
      // Only record history for a genuinely fresh fetch, never for cache fallback -
      // otherwise reloading the page would spuriously re-timestamp old data.
      await recordSnapshot(buildDashboardData(result.dataset, settings));
      setSnapshotHistory(await listSnapshotHistory());
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? `Refresh timed out after ${REFRESH_TIMEOUT_MS / 1000}s.`
          : err instanceof Error
            ? err.message
            : String(err);
      setError(message);
      setLastRefreshOutcome("failed");
      // Never clear rawDataset/status here - the last valid snapshot (if any) stays visible.
      setStatus((prev) => (prev === "unavailable" ? "unavailable" : "cached"));
    } finally {
      clearTimeout(timer);
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [provider, settings]);

  // One automatic refresh attempt on first load, after the cache (if any) has
  // already been shown. This is the dashboard trying to get current data by
  // default; it is still subject to the exact same honest status labeling.
  useEffect(() => {
    if (hasAutoFetchedRef.current) return;
    hasAutoFetchedRef.current = true;
    void refresh();
  }, [refresh]);

  const updateSettings = useCallback((next: AppSettings) => {
    setSettings(next);
    saveSettings(next);
  }, []);

  const clearCache = useCallback(async () => {
    setRawDataset(null);
    setStatus("unavailable");
    setLastSuccessfulFetchAt(null);
    setWarnings([]);
    setError(null);
    setLastRefreshOutcome(null);
    await idbDelete(CACHE_KEY);
  }, []);

  const dashboardData = useMemo(() => (rawDataset ? buildDashboardData(rawDataset, settings) : null), [
    rawDataset,
    settings,
  ]);

  return {
    dashboardData,
    rawDataset,
    settings,
    status,
    warnings,
    error,
    isRefreshing,
    lastFetchAttemptAt,
    lastSuccessfulFetchAt,
    lastRefreshOutcome,
    providerName: provider.name,
    snapshotHistory,
    refresh,
    updateSettings,
    clearCache,
  };
}
