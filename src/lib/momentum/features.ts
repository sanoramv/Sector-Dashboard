import type { DailyBar } from "../../types/market";
import type { AppSettings } from "../../types/config";
import type { ActivityRow } from "../../types/activity";
import type { ActivityFeatures, PatternContext, PriceActionFeatures } from "../../types/momentum";
import { ok, unavailable, type Maybe } from "../../types/metrics";
import { computeReturnOverSessions } from "../calculations/returns";
import { computeDistanceFrom52wHigh } from "../calculations/distanceFromHigh";
import { simpleMovingAverage } from "../calculations/breadth";
import { detectConsolidation, detectResistance, detectTriangle } from "../calculations/patterns";

/**
 * Explainable per-stock features for one evaluation date. Every function
 * here takes ONLY the stock's comparable bars up to and including that date
 * (and activity rows for those same dates), so nothing after the close of
 * the evaluation date can influence a feature - tests/momentum/lookahead.test.ts
 * changes future bars and checks the features do not move.
 *
 * Pre-declared constants (chosen before any outcome was examined, from
 * common technical-analysis conventions - NOT fitted to this data).
 */
export const FEATURE_RULES = {
  /** Sessions in the volume / turnover / delivery baselines. */
  activityBaselineSessions: 20,
  /** Minimum prior sessions with an activity row for relative volume to be computed. */
  minActivityBaselineRows: 18,
  /** Below this median daily turnover (Rs crore, prior 20 sessions) a stock is flagged as thinly traded. */
  thinTurnoverCr: 1,
  /** Sessions searched back for a recent breakout when checking for a retest. */
  retestLookbackSessions: 10,
  /** Today's low within this % above a recent breakout level counts as a retest. */
  retestTolerancePct: 2,
} as const;

const pct = (a: number, b: number) => (a / b - 1) * 100;

function distFromSma(closes: number[], window: number): Maybe<number> {
  const sma = simpleMovingAverage(closes, window);
  if (sma === null) return unavailable(`need ${window} comparable sessions, have ${closes.length}`);
  return ok(pct(closes[closes.length - 1], sma));
}

function stdev(xs: number[]): number {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
}

/** Requires at least 2 comparable bars (today and the previous session). */
export function computePriceAction(bars: DailyBar[]): PriceActionFeatures {
  const today = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const closes = bars.map((b) => b.close);
  const dailyChangePct = pct(today.close, prev.close);

  let volatility20: Maybe<number> = unavailable("need 21 comparable sessions before today");
  if (bars.length >= 22) {
    const changes: number[] = [];
    for (let i = bars.length - 21; i < bars.length - 1; i++) changes.push(pct(bars[i].close, bars[i - 1].close));
    volatility20 = ok(stdev(changes));
  }
  const moveZ: Maybe<number> = volatility20.available
    ? volatility20.value > 0
      ? ok(dailyChangePct / volatility20.value)
      : unavailable("zero volatility in the baseline window")
    : unavailable(volatility20.reason);

  return {
    close: today.close,
    prevClose: prev.close,
    dailyChangePct,
    openToClosePct: pct(today.close, today.open),
    gapPct: pct(today.open, prev.close),
    closeLocation: today.high > today.low ? (today.close - today.low) / (today.high - today.low) : null,
    rangePct: ((today.high - today.low) / prev.close) * 100,
    r3: computeReturnOverSessions(bars, 3),
    r5: computeReturnOverSessions(bars, 5),
    r10: computeReturnOverSessions(bars, 10),
    r20: computeReturnOverSessions(bars, 20),
    volatility20,
    moveZ,
    distSma20Pct: distFromSma(closes, 20),
    distSma50Pct: distFromSma(closes, 50),
    distSma200Pct: distFromSma(closes, 200),
    distanceFrom52wHigh: computeDistanceFrom52wHigh(bars),
  };
}

/**
 * Pattern context reusing the dashboard's validated detectors. Resistance
 * and breakout use bars through today; consolidation and the triangle are
 * evaluated on bars through the PREVIOUS session, i.e. the structure the
 * stock was in before today's move (today's large move would otherwise
 * dominate the very range it is supposed to break out of).
 */
export function computePatternContext(bars: DailyBar[], settings: AppSettings): PatternContext {
  const today = bars[bars.length - 1];
  const resistance = detectResistance(bars, settings.screening);
  const breakoutToday = resistance.available ? today.close > resistance.value.level : null;
  const failedBreakoutToday = resistance.available ? today.high > resistance.value.level && today.close <= resistance.value.level : null;

  let retest: PatternContext["retest"] = null;
  for (let k = 1; k <= FEATURE_RULES.retestLookbackSessions && bars.length - k >= 2; k++) {
    const past = bars.slice(0, bars.length - k);
    const r = detectResistance(past, settings.screening);
    if (!r.available) break;
    if (past[past.length - 1].close > r.value.level) {
      const level = r.value.level;
      if (today.low <= level * (1 + FEATURE_RULES.retestTolerancePct / 100) && today.close > level) {
        retest = { breakoutDate: past[past.length - 1].date, level };
      }
      break; // only the most recent breakout is considered
    }
  }

  const before = bars.slice(0, -1);
  return {
    resistance,
    breakoutToday,
    failedBreakoutToday,
    retest,
    consolidationBefore: detectConsolidation(before, settings.screening),
    triangleBefore: detectTriangle(before, settings.screening),
  };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Volume, turnover and delivery features from NSE's bhavcopy activity
 * columns, for the same comparable bars. A missing row is never treated as
 * zero volume: the dependent feature is unavailable instead.
 */
export function computeActivityFeatures(bars: DailyBar[], activityByDate: Map<string, ActivityRow>, activityLoaded: boolean): ActivityFeatures {
  const today = bars[bars.length - 1];
  const row = activityByDate.get(today.date);
  const warnings: string[] = [];
  if (!activityLoaded || !row) {
    const reason = !activityLoaded ? "volume data file not loaded" : `no volume/turnover row for ${today.date}`;
    return {
      available: false,
      unavailableReason: reason,
      volume: null,
      relativeVolume: unavailable(reason),
      turnoverCr: null,
      medianTurnover20Cr: unavailable(reason),
      deliveryPct: null,
      avgDeliveryPct20: unavailable(reason),
      series: null,
      tradeForTrade: false,
      liquidityWarnings: [],
    };
  }

  const n = FEATURE_RULES.activityBaselineSessions;
  const prior = bars
    .slice(Math.max(0, bars.length - 1 - n), bars.length - 1)
    .map((b) => activityByDate.get(b.date))
    .filter((r): r is ActivityRow => r !== undefined);
  const enough = prior.length >= FEATURE_RULES.minActivityBaselineRows;
  const shortReason = `need volume for ${FEATURE_RULES.minActivityBaselineRows} of the previous ${n} comparable sessions, have ${prior.length}`;

  const meanVol = enough ? prior.reduce((s, r) => s + r.volume, 0) / prior.length : 0;
  const relativeVolume: Maybe<number> = !enough
    ? unavailable(shortReason)
    : meanVol > 0
      ? ok(row.volume / meanVol)
      : unavailable("no shares traded in the baseline window");
  const medianTurnover20Cr: Maybe<number> = enough ? ok(median(prior.map((r) => r.turnoverLakhs)) / 100) : unavailable(shortReason);
  const deliveries = prior.map((r) => r.deliveryPct).filter((d): d is number => d !== null);
  const avgDeliveryPct20: Maybe<number> =
    deliveries.length >= FEATURE_RULES.minActivityBaselineRows
      ? ok(deliveries.reduce((a, b) => a + b, 0) / deliveries.length)
      : unavailable("delivery % missing for too many baseline sessions");

  const tradeForTrade = row.series === "BE" || row.series === "BZ";
  if (tradeForTrade) {
    warnings.push(`Trades in NSE's ${row.series} (trade-for-trade) series: every trade must be settled by delivery, intraday trading is not possible, and delivery % is 100% by rule.`);
  }
  if (medianTurnover20Cr.available && medianTurnover20Cr.value < FEATURE_RULES.thinTurnoverCr) {
    warnings.push(`Thinly traded: median daily turnover over the previous 20 sessions is Rs ${medianTurnover20Cr.value.toFixed(2)} crore (below Rs ${FEATURE_RULES.thinTurnoverCr} crore) - quoted prices may not be achievable in size.`);
  }

  return {
    available: true,
    unavailableReason: null,
    volume: row.volume,
    relativeVolume,
    turnoverCr: row.turnoverLakhs / 100,
    medianTurnover20Cr,
    deliveryPct: row.deliveryPct,
    avgDeliveryPct20,
    series: row.series,
    tradeForTrade,
    liquidityWarnings: warnings,
  };
}
