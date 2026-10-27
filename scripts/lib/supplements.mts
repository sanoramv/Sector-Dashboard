/**
 * Per-source status of the supplementary datasets (volume/turnover,
 * exchange filings) for the manifest. Pure so it is unit-tested. A missing
 * or unreadable supplementary file is reported as unavailable here and NEVER
 * affects the market-price refresh outcome.
 */
import type { SupplementStatus } from "../../src/types/dataset.ts";
import type { StockActivityFile } from "../../src/types/activity.ts";
import type { AnnouncementsFile } from "../../src/types/announcements.ts";

export function summarizeSupplements(activity: StockActivityFile | null, announcements: AnnouncementsFile | null): SupplementStatus {
  const lastOk = announcements?.checks.find((c) => c.outcome === "ok") ?? null;
  const last = announcements?.checks[0] ?? null;
  return {
    activity: activity ? { latestDate: activity.dates[activity.dates.length - 1] ?? null, sessions: activity.dates.length } : null,
    announcements: announcements
      ? {
          lastSuccessfulReadAt: lastOk?.checkedAt ?? null,
          lastAttemptAt: last?.checkedAt ?? null,
          lastAttemptOutcome: last?.outcome ?? null,
          lastAttemptDetail: last?.outcome === "failed" ? (last.detail ?? null) : null,
          retainedItems: announcements.items.length,
          retentionDays: announcements.retentionDays,
        }
      : null,
  };
}
