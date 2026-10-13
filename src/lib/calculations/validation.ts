import type { DailyBar } from "../../types/market";

export interface ValidationResult {
  bars: DailyBar[];
  warnings: string[];
  /**
   * Every price discontinuity found in the cleaned series (oldest first).
   * When the series was truncated, `bars` starts at the latest one.
   */
  breaks: PriceBreak[];
}

export interface ValidateOptions {
  /**
   * When true (the default), a series containing a price discontinuity is
   * truncated to the bars FROM the latest discontinuity onward - see
   * splitAtPriceBreaks. Callers that need every segment (the backtest) pass
   * false and split the series themselves.
   */
  splitAtBreaks?: boolean;
  /**
   * The market's trading calendar (ascending ISO dates, e.g. the NIFTY 500
   * index dates). When given, a calendar session missing from the series
   * between two of its bars is a "missing-sessions" discontinuity. Dates
   * outside the calendar's own range are not judged.
   */
  calendar?: readonly string[];
}

/**
 * Both the open and the close must be at most this fraction of the previous
 * close (or at least its reciprocal) for a day to count as a suspected
 * corporate-action break.
 */
export const PRICE_BREAK_RATIO = 0.6;

/**
 * A FALL where both the open and the close are at most this fraction of the
 * previous close (but above PRICE_BREAK_RATIO) is an "unverified
 * discontinuity": smaller bonuses (3:2 = 0.667, 4:3 = 0.75, 5:4 = 0.8,
 * 6:5 = 0.833) and rights issues look like this, but so do genuine crashes.
 * Only falls are checked: splits, bonuses and rights issues never raise the
 * unadjusted price, and reverse splits exceed the PRICE_BREAK_RATIO test.
 */
export const UNVERIFIED_DISCONTINUITY_RATIO = 0.85;

/**
 * A stock whose latest bar is more than this many calendar days older than
 * the market date is "stale" (e.g. it moved to a series the pipeline did not
 * fetch, or was suspended). Its last price must not be passed off as current.
 * 7 days clears NSE's longest regular holiday runs.
 */
export const STALE_AFTER_CALENDAR_DAYS = 7;

/** True when `lastDate` is more than STALE_AFTER_CALENDAR_DAYS before `asOfDate` (both ISO dates). */
export function isStale(lastDate: string, asOfDate: string): boolean {
  const ageDays = (Date.parse(asOfDate) - Date.parse(lastDate)) / 86_400_000;
  return ageDays > STALE_AFTER_CALENDAR_DAYS;
}

export type PriceBreakKind = "corporate-action-break" | "unverified-discontinuity" | "missing-sessions";

export interface PriceBreak {
  kind: PriceBreakKind;
  /** First bar after the discontinuity. */
  date: string;
  prevDate: string;
  prevClose: number;
  open: number;
  close: number;
  /** close / previous close. */
  ratio: number;
  /** Calendar sessions missing between prevDate and date (missing-sessions only). */
  missingSessions?: number;
}

/** Plain-language description of a discontinuity, used in data-quality messages and the UI. */
export function describeBreak(b: PriceBreak): string {
  switch (b.kind) {
    case "corporate-action-break":
      return `${b.date}: suspected unadjusted split/bonus/demerger (open and close x${b.ratio.toFixed(2)} of the previous close)`;
    case "unverified-discontinuity":
      return `${b.date}: unverified price discontinuity (open and close x${b.ratio.toFixed(2)} of the previous close) - could be an unadjusted bonus/rights issue or a genuine fall; NSE adjustment factors are not available to tell`;
    case "missing-sessions":
      return `${b.prevDate} to ${b.date}: ${b.missingSessions} trading session(s) missing from the price history`;
  }
}

/**
 * NSE's bhavcopy prices are NOT adjusted for splits, bonuses, rights issues or
 * demergers, so on the ex-date a 1:1 bonus shows up as a -50% "return". A
 * series with missing trading sessions has the same problem in a different
 * form: "N sessions back" no longer means what it says. Prices on the two
 * sides of either kind of discontinuity must not be compared, so this splits
 * the series there:
 *
 * - corporate-action-break: BOTH open and close <= 60% of (or >= 1/0.6 x) the
 *   previous close. Audit of the 2025-07 to 2026-10 dataset: all 42 such days
 *   were confirmed corporate actions; no genuine market move met both.
 * - unverified-discontinuity: a fall with BOTH open and close <= 85% of the
 *   previous close. In the same audit 5 days qualified: 4 real corporate
 *   actions (TRENT 3:2, BRIGADE 4:3, CUB 4:3 bonuses; HCC rights) and 1
 *   genuine -20% day (TARIL). It cannot tell them apart - hence "unverified".
 * - missing-sessions: a calendar session absent between two bars (needs `calendar`).
 *
 * NOT detected: bonuses smaller than about 6:5, rights issues with a small
 * price effect, dividends. These remain unadjusted - see AUDIT_REPORT.md.
 */
export function splitAtPriceBreaks(
  bars: DailyBar[],
  calendar?: readonly string[],
): { segments: DailyBar[][]; breaks: PriceBreak[] } {
  const segments: DailyBar[][] = [];
  const breaks: PriceBreak[] = [];
  const calStart = calendar?.[0];
  const calEnd = calendar?.[calendar.length - 1];
  let calIdx = 0;
  let current: DailyBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const prev = bars[i - 1];
      const bar = bars[i];
      const base = { date: bar.date, prevDate: prev.date, prevClose: prev.close, open: bar.open, close: bar.close, ratio: bar.close / prev.close };
      let found: PriceBreak | null = null;

      if (calendar && calStart !== undefined && calEnd !== undefined && prev.date >= calStart && bar.date <= calEnd) {
        while (calIdx < calendar.length && calendar[calIdx] <= prev.date) calIdx += 1;
        let missing = 0;
        for (let j = calIdx; j < calendar.length && calendar[j] < bar.date; j++) missing += 1;
        if (missing > 0) found = { kind: "missing-sessions", ...base, missingSessions: missing };
      }
      if (!found) {
        const closeRatio = base.ratio;
        const openRatio = bar.open / prev.close;
        const bigDown = closeRatio <= PRICE_BREAK_RATIO && openRatio <= PRICE_BREAK_RATIO;
        const bigUp = closeRatio >= 1 / PRICE_BREAK_RATIO && openRatio >= 1 / PRICE_BREAK_RATIO;
        const moderateDown = closeRatio <= UNVERIFIED_DISCONTINUITY_RATIO && openRatio <= UNVERIFIED_DISCONTINUITY_RATIO;
        if (bigDown || bigUp) found = { kind: "corporate-action-break", ...base };
        else if (moderateDown) found = { kind: "unverified-discontinuity", ...base };
      }
      if (found) {
        breaks.push(found);
        segments.push(current);
        current = [];
      }
    }
    current.push(bars[i]);
  }
  if (current.length > 0) segments.push(current);
  return { segments, breaks };
}

/**
 * Cleans a raw bar series: drops non-positive/NaN prices, removes duplicate
 * dates (keeping the first occurrence and warning), and sorts ascending by
 * date, then (by default) truncates at the latest price discontinuity - see
 * splitAtPriceBreaks. Every calculation function in this engine assumes its input has
 * already passed through here - they never re-validate, so bad data fails
 * loudly here rather than silently producing wrong numbers downstream.
 */
export function validateBars(rawBars: DailyBar[], options: ValidateOptions = {}): ValidationResult {
  const warnings: string[] = [];
  const seenDates = new Set<string>();
  const cleaned: DailyBar[] = [];

  const sorted = [...rawBars].sort((a, b) => a.date.localeCompare(b.date));

  for (const bar of sorted) {
    const { date, open, high, low, close } = bar;

    if (!date || Number.isNaN(Date.parse(date))) {
      warnings.push(`Dropped bar with invalid date: ${JSON.stringify(bar)}`);
      continue;
    }
    if (![open, high, low, close].every((v) => typeof v === "number" && Number.isFinite(v) && v > 0)) {
      warnings.push(`Dropped bar for ${date} with non-positive or invalid OHLC value`);
      continue;
    }
    if (seenDates.has(date)) {
      warnings.push(`Dropped duplicate bar for ${date} (kept first occurrence)`);
      continue;
    }
    seenDates.add(date);
    cleaned.push({ date, open, high, low, close });
  }

  const { segments, breaks } = splitAtPriceBreaks(cleaned, options.calendar);
  if ((options.splitAtBreaks ?? true) && breaks.length > 0) {
    const latest = breaks[breaks.length - 1];
    const used = segments[segments.length - 1];
    warnings.push(
      `Price discontinuity - ${describeBreak(latest)}. Only the ${used.length} bars from ${latest.date} onward are used; metrics needing a longer window are shown as unavailable rather than computed across it.`,
    );
    return { bars: used, warnings, breaks };
  }

  return { bars: cleaned, warnings, breaks };
}
