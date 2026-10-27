/**
 * Pure parsing and merging for NSE's corporate-announcements RSS feed - no
 * network, so every rule is unit-tested against the real item format:
 *
 *   <item><title>ROUTE MOBILE LIMITED</title>
 *   <link>https://nsearchives.nseindia.com/corporate/ROUTE_27102026235143_upload-outcome.pdf</link>
 *   <description>... |SUBJECT: Outcome of Board Meeting</description>
 *   <pubDate>27-Oct-2026 23:53:39</pubDate></item>
 *
 * The feed does not carry the trading symbol. The filing link's file name
 * usually starts with it ("ROUTE_..."), but not always ("Infosys_...",
 * "ALTERATION_..."), so an item is mapped to a tracked stock only when that
 * prefix is an exact tracked symbol, or the normalized company name equals
 * a tracked company's - and dropped if the two disagree. Unmatched items
 * are discarded, never guessed.
 */
import type { Announcement, AnnouncementsFile, FeedCheck, FilingCategory } from "../../src/types/announcements.ts";

export const ANNOUNCEMENTS_FEED_URL = "https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml";
export const RETENTION_DAYS = 30;
export const MAX_CHECKS_KEPT = 60;
const MAX_DESCRIPTION_CHARS = 280;

export interface FeedItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();
}

/** Structural check used as fetchArchive's `validate`. */
export function validateFeedText(text: string): string | null {
  if (text.trim().length === 0) return "empty body";
  if (!/<rss[\s>]/.test(text) || !/<channel>/.test(text)) return "not an RSS document";
  if (!/<item>/.test(text)) return "RSS feed has no items";
  return null;
}

export function parseFeed(text: string): FeedItem[] {
  const items: FeedItem[] = [];
  for (const m of text.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const tag = (name: string) => decodeEntities(m[1].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    items.push({ title: tag("title"), link: tag("link"), description: tag("description"), pubDate: tag("pubDate") });
  }
  return items;
}

const MONTHS: Record<string, string> = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };

/** "27-Oct-2026 23:53:39" (IST, as NSE publishes it) -> "2026-10-27T23:53:39+05:30"; null if not in that exact form. */
export function parseNsePubDate(s: string): string | null {
  const m = s.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()];
  if (!month) return null;
  const iso = `${m[3]}-${month}-${m[1]}T${m[4]}:${m[5]}:${m[6]}+05:30`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Upper-case company name with legal suffixes and punctuation removed, e.g. "360 ONE WAM Ltd." and "360 ONE WAM LIMITED" -> "360ONEWAM". */
export function normalizeCompanyName(name: string): string {
  return name
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/\b(LIMITED|LTD)\b\.?/g, " ")
    .replace(/[^A-Z0-9]/g, "");
}

export function subjectOf(description: string): string {
  return description.match(/\|\s*SUBJECT:\s*(.*)$/s)?.[1]?.trim() ?? "";
}

/** Category from NSE's SUBJECT (and, for board-meeting outcomes, the description). First matching rule wins. Never a sentiment. */
export function categorize(subject: string, description: string): FilingCategory {
  const s = subject.toLowerCase();
  const d = description.toLowerCase();
  if (/financial result|\bresults?\b/.test(s) || (/outcome of board meeting/.test(s) && /financial result/.test(d))) return "results";
  if (/order|contract/.test(s) && !/court|tribunal/.test(s)) return "orders-contracts";
  if (/acqui|amalgamation|merger|demerger|scheme of arrangement|takeover/.test(s)) return "acquisition-merger";
  if (/dividend|bonus|split|buy ?back|rights issue|record date|book closure/.test(s)) return "corporate-action";
  if (/fund raising|preferential|qip|allotment|capital/.test(s)) return "fund-raising";
  if (/credit rating/.test(s)) return "credit-rating";
  if (/insolvency|litigation|penalt|show cause|court|tribunal|sebi|search|raid|fraud|default/.test(s)) return "legal-regulatory";
  if (/director|kmp|smp|management|appointment|resignation|cessation|auditor/.test(s)) return "management-change";
  if (/board meeting|shareholders meeting|investor|analyst|con\. call|presentation|press release/.test(s)) return "meeting-investor-communication";
  if (/\bnav\b|newspaper|trading window|certificate|esop|esos|esps|xbrl|regulation|loss of share|duplicate/.test(s)) return "routine-compliance";
  return "other";
}

export interface TrackedCompany {
  symbol: string;
  companyName: string;
}

export interface MatchResult {
  matched: Announcement[];
  unmatched: number;
  ambiguous: number;
  undated: number;
}

export function matchItems(items: FeedItem[], tracked: TrackedCompany[]): MatchResult {
  const symbols = new Set(tracked.map((t) => t.symbol));
  const byName = new Map<string, string>();
  const nameCollisions = new Set<string>();
  for (const t of tracked) {
    const key = normalizeCompanyName(t.companyName);
    if (!key) continue;
    if (byName.has(key) && byName.get(key) !== t.symbol) nameCollisions.add(key);
    byName.set(key, t.symbol);
  }
  const result: MatchResult = { matched: [], unmatched: 0, ambiguous: 0, undated: 0 };
  for (const item of items) {
    const prefix = (item.link.split("/").pop() ?? "").split("_")[0].toUpperCase();
    const bySymbol = symbols.has(prefix) ? prefix : null;
    const nameKey = normalizeCompanyName(item.title);
    const byCompany = nameKey && !nameCollisions.has(nameKey) ? (byName.get(nameKey) ?? null) : null;
    if (bySymbol && byCompany && bySymbol !== byCompany) {
      result.ambiguous += 1;
      continue;
    }
    const symbol = bySymbol ?? byCompany;
    if (!symbol) {
      result.unmatched += 1;
      continue;
    }
    const publishedAt = parseNsePubDate(item.pubDate);
    if (!publishedAt) {
      result.undated += 1;
      continue;
    }
    const subject = subjectOf(item.description);
    const description = item.description.replace(/\|\s*SUBJECT:.*$/s, "").trim().slice(0, MAX_DESCRIPTION_CHARS);
    result.matched.push({
      id: `${item.link}|${subject}|${publishedAt}`,
      symbol,
      company: item.title,
      subject,
      description,
      url: item.link,
      publishedAt,
      category: categorize(subject, item.description),
      matchedBy: bySymbol ? "filing-link-symbol" : "company-name",
    });
  }
  return result;
}

export function emptyAnnouncementsFile(): AnnouncementsFile {
  return {
    schemaVersion: 1,
    source: { name: "NSE corporate announcements RSS feed (official exchange filings)", feedUrl: ANNOUNCEMENTS_FEED_URL },
    retentionDays: RETENTION_DAYS,
    checks: [],
    items: [],
  };
}

/**
 * Merges new items (existing items are never dropped except by age), records
 * the check, and prunes both to the retention window relative to `now`.
 */
export function mergeAnnouncements(file: AnnouncementsFile, matched: Announcement[], check: FeedCheck, now: Date): AnnouncementsFile {
  const cutoff = now.getTime() - RETENTION_DAYS * 86_400_000;
  const byId = new Map(file.items.map((i) => [i.id, i]));
  for (const item of matched) byId.set(item.id, item);
  const items = [...byId.values()]
    .filter((i) => Date.parse(i.publishedAt) >= cutoff)
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  const checks = [check, ...file.checks].filter((c) => Date.parse(c.checkedAt) >= cutoff).slice(0, MAX_CHECKS_KEPT);
  return { ...file, retentionDays: RETENTION_DAYS, checks, items };
}

export function feedSpan(items: FeedItem[]): { oldest?: string; newest?: string } {
  const times = items.map((i) => parseNsePubDate(i.pubDate)).filter((t): t is string => t !== null);
  if (times.length === 0) return {};
  const sorted = [...times].sort((a, b) => Date.parse(a) - Date.parse(b));
  return { oldest: sorted[0], newest: sorted[sorted.length - 1] };
}
