import type { DashboardData } from "../dashboard";
import type { SnapshotHistoryEntry } from "../../types/snapshotHistory";
import { idbGet, idbSet } from "./idbCache";

const HISTORY_KEY = "snapshotHistory:v1";
const MAX_ENTRIES = 180; // ~6 months of trading days, bounds local storage growth

/** Pure summarization - exported separately from the IndexedDB IO below so it's unit-testable without a storage environment. */
export function summarizeDashboardData(data: DashboardData): SnapshotHistoryEntry {
  const topSectors = [...data.sectors]
    .filter((s) => !s.excludeFromHeadlineCount)
    .sort((a, b) => b.score.pointsEarned - a.score.pointsEarned)
    .slice(0, 5)
    .map((s) => ({
      slug: s.slug,
      displayName: s.displayName,
      score: s.score.pointsEarned,
      scorePossible: s.score.pointsPossible,
      regime: s.regime.regime,
    }));

  const topStocks = [...data.stockScreen]
    .sort((a, b) => b.score.pointsEarned - a.score.pointsEarned)
    .slice(0, 10)
    .map((s) => ({ symbol: s.symbol, score: s.score.pointsEarned, scorePossible: s.score.pointsPossible }));

  return {
    marketDate: data.latestMarketDate,
    recordedAt: new Date().toISOString(),
    bullishCount: data.overview.bullishCount,
    sidewaysCount: data.overview.sidewaysCount,
    bearishCount: data.overview.bearishCount,
    insufficientDataCount: data.overview.insufficientDataCount,
    benchmarkReturn1m: data.overview.benchmarkReturns.m1.available ? data.overview.benchmarkReturns.m1.value : null,
    topSectors,
    topStocks,
  };
}

/**
 * Records a snapshot for `data.latestMarketDate`, overwriting any existing
 * entry for the same date (idempotent across repeated refreshes on the same
 * trading day). Call this only after a genuinely fresh fetch, never for data
 * loaded from the "last valid snapshot" cache - otherwise reloading the page
 * would spuriously re-timestamp old data as a new history entry.
 */
export async function recordSnapshot(data: DashboardData): Promise<void> {
  const history = (await idbGet<SnapshotHistoryEntry[]>(HISTORY_KEY)) ?? [];
  const next = history.filter((h) => h.marketDate !== data.latestMarketDate);
  next.push(summarizeDashboardData(data));
  next.sort((a, b) => a.marketDate.localeCompare(b.marketDate));
  const trimmed = next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
  await idbSet(HISTORY_KEY, trimmed);
}

export async function listSnapshotHistory(): Promise<SnapshotHistoryEntry[]> {
  const history = await idbGet<SnapshotHistoryEntry[]>(HISTORY_KEY);
  return history ?? [];
}
