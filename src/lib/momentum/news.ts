import type { Announcement, AnnouncementsFile, FilingCategory } from "../../types/announcements";

/**
 * Filings for a candidate relative to its evaluation session. NSE's equity
 * session closes at 15:30 IST and the next one opens at 09:15 IST, so for
 * session date t the relevant window runs from the previous session's close
 * to the next session's open (or "now", if that has not happened):
 *
 *   before-close  previous close < published <= t 15:30 IST   (could have driven today's move)
 *   after-close   t 15:30 IST < published <= next open         (known before the next session, not reflected in today's close)
 *
 * Coverage: the feed only ever holds the current day's filings and is read a
 * few times a day, so a window can be only partly covered. Each successful
 * read is known to cover [oldest item in the feed, time of the read]; the
 * union of those spans is what was actually seen. "No filing found" is only
 * reported as such when the whole window was covered.
 */

export const CATEGORY_TEXT: Record<FilingCategory, string> = {
  results: "Financial results",
  "orders-contracts": "Orders / contracts",
  "acquisition-merger": "Acquisition / merger",
  "corporate-action": "Corporate action",
  "fund-raising": "Fund raising / allotment",
  "credit-rating": "Credit rating",
  "legal-regulatory": "Legal / regulatory",
  "management-change": "Management / board change",
  "meeting-investor-communication": "Meeting / investor communication",
  "routine-compliance": "Routine compliance",
  other: "Other filing",
};

/**
 * Why a filing of this category CAN matter - generic, evidence-based context
 * for the reader, never a judgement of this particular filing (open it).
 */
export const CATEGORY_RELEVANCE: Record<FilingCategory, string> = {
  results: "Earnings filings often move prices on whether results differed from expectations; the filing itself does not say how the market expected them.",
  "orders-contracts": "Order wins can change revenue visibility; relevance depends on the order's size relative to the company's revenue.",
  "acquisition-merger": "Deals can change the company's business or capital structure; terms and approvals determine the effect.",
  "corporate-action": "Dividends, bonuses, splits and record dates can change the quoted price mechanically on the ex-date without changing value.",
  "fund-raising": "New shares or debt can dilute existing holders or fund growth; the price and size matter.",
  "credit-rating": "A rating change affects borrowing costs and is often read as a signal of financial health.",
  "legal-regulatory": "Regulatory or legal developments can carry penalties or restrictions; check the order's scope.",
  "management-change": "Leadership changes can affect strategy and confidence; usually less price-moving than results.",
  "meeting-investor-communication": "Investor meetings and presentations may contain guidance; often a schedule notice with no new information.",
  "routine-compliance": "Routine compliance filing - rarely price-relevant.",
  other: "Uncategorised filing - open it to judge its relevance.",
};

const IST = "+05:30";
export const sessionCloseIst = (date: string) => `${date}T15:30:00${IST}`;
export const sessionOpenIst = (date: string) => `${date}T09:15:00${IST}`;

export type FilingTiming = "before-close" | "after-close";

export interface TimedFiling extends Announcement {
  timing: FilingTiming;
  relevance: string;
  /** An earlier filing of the same category for this stock within the retained window (more than 24h before) - this may be a follow-up, not new information. */
  followUpOf: { publishedAt: string; subject: string } | null;
}

export type CoverageStatus = "covered" | "partial" | "not-covered" | "no-data";

export interface FilingWindowResult {
  windowStart: string;
  windowEnd: string;
  filings: TimedFiling[];
  coverage: CoverageStatus;
  /** Share of the window covered by successful feed reads, 0-100. */
  coveredPct: number;
  summary: string;
}

/** Union length of [start,end] spans clipped to [a,b], in ms. */
function coveredMs(spans: Array<[number, number]>, a: number, b: number): number {
  const clipped = spans
    .map(([s, e]) => [Math.max(s, a), Math.min(e, b)] as [number, number])
    .filter(([s, e]) => e > s)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cs = -Infinity;
  let ce = -Infinity;
  for (const [s, e] of clipped) {
    if (s > ce) {
      if (ce > cs) total += ce - cs;
      cs = s;
      ce = e;
    } else ce = Math.max(ce, e);
  }
  if (ce > cs) total += ce - cs;
  return total;
}

export function feedSpans(file: AnnouncementsFile): Array<[number, number]> {
  return file.checks
    .filter((c) => c.outcome === "ok" && c.oldestInFeed)
    .map((c) => [Date.parse(c.oldestInFeed as string), Date.parse(c.checkedAt)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e >= s);
}

/**
 * @param prevSession previous trading date (window start = its close); null when unknown
 * @param nextSession next trading date if it is already in the data; otherwise the window ends at `now`
 */
export function filingsForSession(
  file: AnnouncementsFile | null,
  symbol: string,
  session: string,
  prevSession: string | null,
  nextSession: string | null,
  now: Date,
): FilingWindowResult {
  const windowStart = prevSession ? sessionCloseIst(prevSession) : `${session}T00:00:00${IST}`;
  const nextOpen = nextSession ? sessionOpenIst(nextSession) : null;
  const end = nextOpen && Date.parse(nextOpen) < now.getTime() ? Date.parse(nextOpen) : now.getTime();
  const windowEnd = new Date(end).toISOString();
  const a = Date.parse(windowStart);
  const close = Date.parse(sessionCloseIst(session));

  if (!file) {
    return { windowStart, windowEnd, filings: [], coverage: "no-data", coveredPct: 0, summary: "Filings data could not be loaded - catalyst information is unavailable." };
  }
  const filings: TimedFiling[] = file.items
    .filter((i) => i.symbol === symbol)
    .filter((i) => {
      const t = Date.parse(i.publishedAt);
      return t > a && t <= end;
    })
    .map((i) => {
      const t = Date.parse(i.publishedAt);
      const earlier = file.items
        .filter((e) => e.symbol === symbol && e.category === i.category && e.id !== i.id && Date.parse(e.publishedAt) < t - 86_400_000)
        .sort((x, y) => Date.parse(y.publishedAt) - Date.parse(x.publishedAt))[0];
      return {
        ...i,
        timing: (t <= close ? "before-close" : "after-close") as FilingTiming,
        relevance: CATEGORY_RELEVANCE[i.category],
        followUpOf: earlier ? { publishedAt: earlier.publishedAt, subject: earlier.subject } : null,
      };
    })
    .sort((x, y) => Date.parse(x.publishedAt) - Date.parse(y.publishedAt));

  const span = Math.max(0, end - a);
  const pct = span > 0 ? Math.min(100, (coveredMs(feedSpans(file), a, end) / span) * 100) : 0;
  const coverage: CoverageStatus = pct >= 99.9 ? "covered" : pct > 0 ? "partial" : "not-covered";

  const pctText = pct < 1 ? "under 1%" : `${pct.toFixed(0)}%`;
  let summary: string;
  if (filings.length > 0) {
    summary =
      `${filings.length} exchange filing(s) found` +
      (coverage === "covered" ? "." : ` (the feed covered only ${pctText} of this window, so there may be others).`);
  } else if (coverage === "covered") {
    summary = "No exchange filing found - the feed was read across this whole window.";
  } else if (coverage === "partial") {
    summary = `No filing found, but the feed covered only ${pctText} of this window - filings may exist in the uncovered part.`;
  } else {
    summary = "Not covered - filings were not collected for this period (collection only started recently and the feed keeps about one day). Unknown, not 'no news'.";
  }
  return { windowStart, windowEnd, filings, coverage, coveredPct: pct, summary };
}
