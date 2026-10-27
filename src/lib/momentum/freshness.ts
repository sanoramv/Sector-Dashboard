import type { Manifest } from "../../types/dataset";

export interface FreshnessNotice {
  level: "info" | "warning" | "error";
  text: string;
}

/**
 * What the page must say about the data's date and state before showing any
 * mover. Never labels an older session as "today": the date shown is always
 * the NSE session date the bars are for, and a failed/partial pipeline run
 * or a stale dataset is stated up front.
 */
export function momentumFreshnessNotices(
  manifest: Manifest,
  selectedDate: string,
  latestDate: string,
  dataStatus: string,
  supplements: { activity: "ok" | "unavailable" | "loading"; announcements: "ok" | "unavailable" | "loading" },
): FreshnessNotice[] {
  const out: FreshnessNotice[] = [];
  const r = manifest.refresh;
  if (!r) {
    out.push({ level: "warning", text: "The pipeline did not report whether its last refresh was complete - the latest session may be missing." });
  } else if (r.outcome === "failed") {
    out.push({
      level: "error",
      text: `The last data refresh FAILED: latest market data is ${manifest.latestMarketDate}, ${r.tradingDaysBehind} trading day(s) behind the latest due session (${r.latestDueDate}). These lists are NOT for the most recent session.`,
    });
  } else if (r.outcome === "partial") {
    out.push({ level: "warning", text: `The last data refresh was partial: ${r.reasons.join(" ")}` });
  }
  if (dataStatus === "stale") {
    out.push({ level: "error", text: `Market data (${manifest.latestMarketDate}) is older than expected - the scheduled pipeline may have stopped.` });
  } else if (dataStatus === "cached") {
    out.push({ level: "warning", text: "Showing a cached copy from this browser, not freshly loaded data." });
  }
  if (selectedDate !== latestDate) {
    out.push({ level: "info", text: `Historical view: session ${selectedDate}. The latest session in the data is ${latestDate}.` });
  }
  if (supplements.activity === "unavailable") {
    out.push({ level: "warning", text: "Volume/turnover data could not be loaded: relative volume and liquidity are unavailable and most stocks are labelled 'Insufficient evidence'." });
  }
  const sup = manifest.supplements;
  if (sup?.activity?.latestDate && sup.activity.latestDate < manifest.latestMarketDate) {
    out.push({ level: "warning", text: `Volume data ends ${sup.activity.latestDate}, before the latest price date ${manifest.latestMarketDate}: relative volume is unavailable for later sessions.` });
  }
  if (sup?.announcements?.lastAttemptOutcome === "failed") {
    out.push({
      level: "warning",
      text: `The latest filings-feed read failed (${sup.announcements.lastAttemptDetail ?? "unknown error"})${sup.announcements.lastSuccessfulReadAt ? `; last successful read ${sup.announcements.lastSuccessfulReadAt}` : ""}. Filings after that are not covered.`,
    });
  }
  if (supplements.announcements === "unavailable") {
    out.push({ level: "warning", text: "Exchange filings could not be loaded: catalyst information is unavailable (not 'no news')." });
  }
  return out;
}
