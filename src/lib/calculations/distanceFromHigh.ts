import type { DailyBar } from "../../types/market";
import { type Maybe, ok, unavailable } from "../../types/metrics";

const TRADING_DAYS_PER_YEAR = 252;
const MIN_CALENDAR_DAYS_FOR_52W = 350; // require near-full-year coverage before claiming a "52-week" high
const MS_PER_DAY = 86_400_000;

/**
 * Distance (%) = ((Current Close / 52-week High) - 1) x 100.
 * Uses the daily `high` field over a trailing 365-calendar-day window ending
 * at the latest bar. Requires close to a full year of history; with less,
 * "52-week high" would understate the true figure, so this returns
 * unavailable rather than a misleading number.
 */
export function computeDistanceFrom52wHigh(bars: DailyBar[]): Maybe<number> {
  if (bars.length === 0) {
    return unavailable("no price history available");
  }
  const last = bars[bars.length - 1];
  const firstDate = new Date(bars[0].date).getTime();
  const lastDate = new Date(last.date).getTime();
  const spanDays = (lastDate - firstDate) / MS_PER_DAY;

  if (spanDays < MIN_CALENDAR_DAYS_FOR_52W) {
    return unavailable(
      `insufficient history for a 52-week high (need ~365 days, have ${Math.round(spanDays)} days)`,
    );
  }

  const windowStart = lastDate - 365 * MS_PER_DAY;
  const windowBars = bars.filter((b) => new Date(b.date).getTime() >= windowStart);
  if (windowBars.length < TRADING_DAYS_PER_YEAR * 0.7) {
    // Sparse window (e.g. large data gaps) - don't claim a reliable 52-week high.
    return unavailable(
      `insufficient trading sessions within the trailing 365 days (have ${windowBars.length})`,
    );
  }

  const high52w = Math.max(...windowBars.map((b) => b.high));
  return ok(((last.close / high52w) - 1) * 100);
}
