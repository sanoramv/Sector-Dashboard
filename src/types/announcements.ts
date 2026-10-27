/**
 * Company filings collected from NSE's official corporate-announcements RSS
 * feed (https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml)
 * by the scheduled pipeline into public/data/announcements.json.
 *
 * The feed only carries roughly the most recent day of filings, so history
 * exists only from when collection started, and any gap between pipeline
 * runs is a period with NO coverage. `checks` records exactly which time
 * span each successful read covered, so the UI can tell "no filing found in
 * a covered period" apart from "not covered - unknown".
 *
 * These are exchange filings, not news articles. No sentiment is inferred:
 * a category is assigned from NSE's own SUBJECT text only.
 */

export type FilingCategory =
  | "results"
  | "orders-contracts"
  | "acquisition-merger"
  | "corporate-action"
  | "fund-raising"
  | "credit-rating"
  | "legal-regulatory"
  | "management-change"
  | "meeting-investor-communication"
  | "routine-compliance"
  | "other";

export interface Announcement {
  /** Stable de-duplication key. */
  id: string;
  symbol: string;
  /** Company name exactly as in the feed item title. */
  company: string;
  /** NSE's SUBJECT text. */
  subject: string;
  /** Feed description (filing summary), trimmed. */
  description: string;
  /** Direct link to the filing on nsearchives.nseindia.com. */
  url: string;
  /** Publication time as published by NSE, ISO with the IST offset, e.g. 2026-10-27T23:53:39+05:30. */
  publishedAt: string;
  category: FilingCategory;
  /** How the item was mapped to a tracked symbol. */
  matchedBy: "filing-link-symbol" | "company-name";
}

export interface FeedCheck {
  checkedAt: string;
  outcome: "ok" | "failed";
  detail?: string;
  itemsInFeed?: number;
  itemsMatched?: number;
  /** Oldest and newest publication time in the feed at this check (ISO, IST offset). */
  oldestInFeed?: string;
  newestInFeed?: string;
}

export interface AnnouncementsFile {
  schemaVersion: 1;
  source: { name: string; feedUrl: string };
  retentionDays: number;
  /** Most recent feed checks, newest first. */
  checks: FeedCheck[];
  /** Newest first. */
  items: Announcement[];
}
