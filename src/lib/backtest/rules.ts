import type { AppSettings } from "../../types/config";
import type { BacktestSignalFn } from "./engine";
import { computeDistanceFrom52wHigh } from "../calculations/distanceFromHigh";
import { computeReturnOverSessions, SESSION_LOOKBACK } from "../calculations/returns";
import { computeRelativeStrength } from "../calculations/relativeStrength";
import { isAboveMovingAverage } from "../calculations/breadth";
import { detectResistance, detectConsolidation, detectTriangle } from "../calculations/patterns";
import { computeStockScore } from "../calculations/stockScoring";

export interface BacktestRuleDef {
  id: string;
  label: string;
  description: string;
  makeSignal: (settings: AppSettings) => BacktestSignalFn;
}

/**
 * Every screening rule this app exposes to users, wrapped as a backtestable
 * signal function. Each one only reads `barsUpToT`/`benchmarkUpToT`, which
 * the engine guarantees are truncated to the evaluation date - see
 * engine.test.ts's explicit no-look-ahead checks.
 */
export const BACKTEST_RULES: BacktestRuleDef[] = [
  {
    id: "near-52w-high",
    label: "Near 52-week high",
    description: "Fires when the stock's distance from its trailing 52-week high is within the configured threshold.",
    makeSignal: (settings) => (bars) => {
      const d = computeDistanceFrom52wHigh(bars);
      if (!d.available) return null;
      return d.value >= -settings.scoring.near52wHighThresholdPct;
    },
  },
  {
    id: "above-200dma",
    label: "Above own 200-day moving average",
    description: "Fires when the stock's close is above its own trailing 200-day simple moving average.",
    makeSignal: () => (bars) => isAboveMovingAverage(bars.map((b) => b.close), 200),
  },
  {
    id: "above-50dma",
    label: "Above own 50-day moving average",
    description: "Fires when the stock's close is above its own trailing 50-day simple moving average.",
    makeSignal: () => (bars) => isAboveMovingAverage(bars.map((b) => b.close), 50),
  },
  {
    id: "return-3m-positive",
    label: "3M return positive",
    description: "Fires when the trailing 3-month (63-session) return is positive.",
    makeSignal: () => (bars) => {
      const r = computeReturnOverSessions(bars, SESSION_LOOKBACK.m3);
      if (!r.available) return null;
      return r.value > 0;
    },
  },
  {
    id: "relative-performance-3m-positive",
    label: "3M relative performance vs NIFTY 500 positive",
    description: "Fires when the stock's 3-month return exceeds the NIFTY 500's 3-month return over the same window.",
    makeSignal: () => (bars, benchmarkBars) => {
      const rs = computeRelativeStrength(bars, benchmarkBars);
      if (!rs.m3.available) return null;
      return rs.m3.value > 0;
    },
  },
  {
    id: "approaching-resistance",
    label: "Approaching resistance (heuristic)",
    description: "Fires when the close is below the nearest prior swing-high level by no more than the configured proximity.",
    makeSignal: (settings) => (bars) => {
      const r = detectResistance(bars, settings.screening);
      if (!r.available) return null;
      return r.value.isApproaching;
    },
  },
  {
    id: "consolidating",
    label: "Consolidating / range contraction (heuristic)",
    description: "Fires when the recent average daily trading range has contracted below the configured fraction of its own baseline.",
    makeSignal: (settings) => (bars) => {
      const c = detectConsolidation(bars, settings.screening);
      if (!c.available) return null;
      return c.value.isConsolidating;
    },
  },
  {
    id: "triangle-detected",
    label: "Triangle price structure (heuristic)",
    description: "Fires when the swing-pivot trendline fit classifies the recent structure as ascending, descending or symmetrical.",
    makeSignal: (settings) => (bars) => {
      const t = detectTriangle(bars, settings.screening);
      if (!t.available) return null;
      return t.value.detected;
    },
  },
  {
    id: "stock-score-6plus",
    label: "Composite stock score >= 6 of 10",
    description: "Fires when this app's own configurable stock-screening score (returns, moving averages, relative strength, patterns) reaches at least 6 of 10 available points.",
    makeSignal: (settings) => (bars, benchmarkBars) => {
      const returns = {
        d1: computeReturnOverSessions(bars, SESSION_LOOKBACK.d1),
        w1: computeReturnOverSessions(bars, SESSION_LOOKBACK.w1),
        m1: computeReturnOverSessions(bars, SESSION_LOOKBACK.m1),
        m3: computeReturnOverSessions(bars, SESSION_LOOKBACK.m3),
        m6: computeReturnOverSessions(bars, SESSION_LOOKBACK.m6),
      };
      const distanceFrom52wHigh = computeDistanceFrom52wHigh(bars);
      const rs = computeRelativeStrength(bars, benchmarkBars);
      const closes = bars.map((b) => b.close);
      const above50 = isAboveMovingAverage(closes, 50);
      const above200 = isAboveMovingAverage(closes, 200);
      const resistance = detectResistance(bars, settings.screening);
      const consolidation = detectConsolidation(bars, settings.screening);
      const triangle = detectTriangle(bars, settings.screening);

      const score = computeStockScore(
        {
          returns,
          distanceFrom52wHigh,
          relativePerformance3m: rs.m3,
          above50dma: above50 === null ? { available: false, reason: "n/a" } : { available: true, value: above50 },
          above200dma: above200 === null ? { available: false, reason: "n/a" } : { available: true, value: above200 },
          resistance,
          consolidation,
          triangle,
        },
        settings.scoring,
      );
      if (score.pointsPossible === 0) return null;
      return score.pointsEarned >= 6;
    },
  },
];
