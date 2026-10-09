import type { DailyBar } from "../../types/market";
import { validateBars } from "../calculations/validation";
import { computeSampleStats, type SampleStats } from "./stats";

export interface BacktestUniverseEntry {
  symbol: string;
  bars: DailyBar[];
}

/**
 * A signal function decides, using ONLY price history up to and including
 * the bar at index `t` (benchmark history is pre-truncated to the same date
 * by the engine), whether a rule fires at that point in time. Returning
 * `null` means "not evaluable yet" (e.g. not enough history) - excluded from
 * both the signal and baseline samples for that date, never coerced to false.
 */
export type BacktestSignalFn = (barsUpToT: DailyBar[], benchmarkBarsUpToT: DailyBar[]) => boolean | null;

export interface BacktestConfig {
  /** Trading sessions held after the signal date before measuring the forward return. */
  holdingSessions: number;
  /** Assumed round-trip transaction cost + slippage, in basis points, subtracted from the gross return. */
  costBps: number;
}

export interface BacktestResult {
  ruleName: string;
  holdingSessions: number;
  costBps: number;
  universeSize: number;
  /** Forward-return stats conditional on the signal having fired. Null if the signal never fired with a measurable forward return. */
  signalStats: SampleStats | null;
  /** Unconditional forward-return stats over the same universe/dates/holding period, for comparison - not a null model, just "what if you held anything". */
  baselineStats: SampleStats | null;
  warnings: string[];
}

const SURVIVORSHIP_WARNING =
  "Uses today's constituent list applied across the entire backtest window (survivorship bias) - stocks that were delisted, merged, or dropped from the index during this period are not included, which tends to inflate backtested results relative to a true point-in-time universe.";

const EXECUTION_WARNING =
  "Assumes entry at the signal date's own closing price and exit at the closing price exactly N sessions later - a simplifying assumption, not a realistic fill (real execution would be at least the next session's open, with its own slippage).";

function costWarning(costBps: number): string {
  return `Net returns subtract a flat assumed round-trip cost of ${costBps} basis points for transaction costs and slippage - actual costs vary by stock liquidity, order size and broker.`;
}

const MIN_RELIABLE_SAMPLE = 30;

/**
 * Runs one rule's backtest over a universe of stocks, with NO LOOK-AHEAD BY
 * CONSTRUCTION: at every evaluation date t, the signal function and the
 * forward-return calculation both only see data up to and including t for
 * the entry, and t+holdingSessions for the exit - nothing from between or
 * beyond is visible to the signal.
 *
 * This reports evidence (sample size, win rate, average/median/stdev of
 * forward returns, gross vs. net of assumed costs, and a baseline for
 * comparison) - it does NOT compute a significance test. With overlapping
 * windows across time and correlated moves across stocks in the same
 * sector/industry, a naive t-test's p-value would be misleading; this is
 * disclosed explicitly rather than presenting a false-precision statistic.
 */
export function runBacktest(
  ruleName: string,
  universe: BacktestUniverseEntry[],
  benchmarkBars: DailyBar[],
  signalFn: BacktestSignalFn,
  config: BacktestConfig,
): BacktestResult {
  const { bars: validatedBenchmark } = validateBars(benchmarkBars);
  const signalReturns: number[] = [];
  const baselineReturns: number[] = [];
  let universeSize = 0;

  for (const entry of universe) {
    const { bars } = validateBars(entry.bars);
    if (bars.length === 0) continue;
    universeSize += 1;

    // Pointer-based incremental alignment: both `bars` and `validatedBenchmark`
    // are sorted ascending, so the benchmark cutoff index only moves forward
    // as t increases - O(n + m) per symbol instead of O(n * m).
    let benchPtr = 0;

    for (let t = 0; t < bars.length - config.holdingSessions; t++) {
      const asOfDate = bars[t].date;
      while (benchPtr < validatedBenchmark.length && validatedBenchmark[benchPtr].date <= asOfDate) {
        benchPtr += 1;
      }
      const benchmarkUpToT = validatedBenchmark.slice(0, benchPtr);

      const entryClose = bars[t].close;
      const exitClose = bars[t + config.holdingSessions].close;
      const grossPct = ((exitClose / entryClose) - 1) * 100;
      const netPct = grossPct - config.costBps / 100;

      baselineReturns.push(netPct);

      const barsUpToT = bars.slice(0, t + 1);
      const signal = signalFn(barsUpToT, benchmarkUpToT);
      if (signal === true) {
        signalReturns.push(netPct);
      }
    }
  }

  const signalStats = computeSampleStats(signalReturns);
  const warnings = [SURVIVORSHIP_WARNING, EXECUTION_WARNING, costWarning(config.costBps)];
  if (!signalStats || signalStats.n < MIN_RELIABLE_SAMPLE) {
    warnings.push(
      `Only ${signalStats?.n ?? 0} historical signal occurrence(s) in the available data - far too few for any reliable conclusion (a common rule of thumb is at least ${MIN_RELIABLE_SAMPLE}+, and even that is modest). Treat this as a preliminary/exploratory result, not evidence of effectiveness.`,
    );
  }

  return {
    ruleName,
    holdingSessions: config.holdingSessions,
    costBps: config.costBps,
    universeSize,
    signalStats,
    baselineStats: computeSampleStats(baselineReturns),
    warnings,
  };
}
