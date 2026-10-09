import type { DailyBar } from "../../types/market";
import { type Maybe, ok, unavailable, type ReturnMetrics } from "../../types/metrics";

/** Trading-session lookbacks, NOT calendar days - see module docs in returns.ts. */
export const SESSION_LOOKBACK = {
  d1: 1,
  w1: 5,
  m1: 21,
  m3: 63,
  m6: 126,
} as const;

/**
 * Return (%) = ((Current Close / Close N sessions ago) - 1) x 100.
 * `bars` must already be validated (sorted ascending, unique dates, positive prices).
 * Looks back by trading-session COUNT, not calendar-day subtraction, so holidays
 * and non-trading days never distort the window.
 */
export function computeReturnOverSessions(bars: DailyBar[], sessionsBack: number): Maybe<number> {
  if (bars.length === 0) {
    return unavailable("no price history available");
  }
  const lastIdx = bars.length - 1;
  const priorIdx = lastIdx - sessionsBack;
  if (priorIdx < 0) {
    return unavailable(
      `need ${sessionsBack} prior trading sessions, only ${lastIdx} available`,
    );
  }
  const current = bars[lastIdx].close;
  const prior = bars[priorIdx].close;
  return ok(((current / prior) - 1) * 100);
}

export function computeReturns(bars: DailyBar[]): ReturnMetrics {
  return {
    d1: computeReturnOverSessions(bars, SESSION_LOOKBACK.d1),
    w1: computeReturnOverSessions(bars, SESSION_LOOKBACK.w1),
    m1: computeReturnOverSessions(bars, SESSION_LOOKBACK.m1),
    m3: computeReturnOverSessions(bars, SESSION_LOOKBACK.m3),
    m6: computeReturnOverSessions(bars, SESSION_LOOKBACK.m6),
  };
}
