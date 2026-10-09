import type { DailyBar } from "../../types/market";
import type { Maybe, RelativeStrengthMetrics } from "../../types/metrics";
import { ok, unavailable } from "../../types/metrics";
import { computeReturnOverSessions, SESSION_LOOKBACK } from "./returns";

function relativeReturn(sectorBars: DailyBar[], benchmarkBars: DailyBar[], sessions: number): Maybe<number> {
  const sectorRet = computeReturnOverSessions(sectorBars, sessions);
  const benchmarkRet = computeReturnOverSessions(benchmarkBars, sessions);
  if (!sectorRet.available) return unavailable(`sector return unavailable: ${sectorRet.reason}`);
  if (!benchmarkRet.available) return unavailable(`benchmark return unavailable: ${benchmarkRet.reason}`);
  return ok(sectorRet.value - benchmarkRet.value);
}

/**
 * Relative Performance (pp) = Sector Return - NIFTY 500 Return, per timeframe.
 * RS Ratio series = Sector Close / NIFTY 500 Close, joined on matching dates only
 * (an inner join - dates where one series is missing a bar are skipped rather
 * than interpolated, since interpolating would fabricate a price).
 */
export function computeRelativeStrength(
  sectorBars: DailyBar[],
  benchmarkBars: DailyBar[],
): RelativeStrengthMetrics {
  const benchmarkBySDate = new Map(benchmarkBars.map((b) => [b.date, b.close]));
  const ratioSeries = sectorBars
    .filter((b) => benchmarkBySDate.has(b.date))
    .map((b) => ({ date: b.date, ratio: b.close / (benchmarkBySDate.get(b.date) as number) }));

  return {
    w1: relativeReturn(sectorBars, benchmarkBars, SESSION_LOOKBACK.w1),
    m1: relativeReturn(sectorBars, benchmarkBars, SESSION_LOOKBACK.m1),
    m3: relativeReturn(sectorBars, benchmarkBars, SESSION_LOOKBACK.m3),
    m6: relativeReturn(sectorBars, benchmarkBars, SESSION_LOOKBACK.m6),
    ratioSeries: ratioSeries.length > 0 ? ok(ratioSeries) : unavailable("no overlapping dates with benchmark series"),
  };
}
