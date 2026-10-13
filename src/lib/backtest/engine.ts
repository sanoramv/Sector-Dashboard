import type { DailyBar } from "../../types/market";
import { splitAtPriceBreaks, validateBars } from "../calculations/validation";
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
  /** Sessions after the signal date at whose close the position is exited (entry is the next session's open). Values below 1 are treated as 1. */
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
  "Assumes entry at the NEXT session's opening price (the signal is only known after the signal date's close) and exit at the closing price N sessions after the signal date. Real fills would differ by spread, impact and auction dynamics beyond the flat cost assumed below.";

const OVERLAP_WARNING =
  "Signals are evaluated on every session, so consecutive signals for the same stock have overlapping holding windows, and stocks in the same sector move together. The sample size n therefore counts heavily correlated observations - the number of independent observations is far smaller.";

const PRICE_BREAK_WARNING =
  "NSE prices are not adjusted for corporate actions. No holding window crosses a detected price discontinuity (falls of 15%+ at both open and close, rises of 67%+, or missing sessions) - which also drops some genuine large moves. Bonuses smaller than about 6:5 and most rights issues are not detected and can still distort individual returns.";

function costWarning(costBps: number): string {
  return `Net returns subtract a flat assumed round-trip cost of ${costBps} basis points for transaction costs and slippage - actual costs vary by stock liquidity, order size and broker.`;
}

const MIN_RELIABLE_SAMPLE = 30;

/**
 * Runs one rule's backtest over a universe of stocks, with NO LOOK-AHEAD BY
 * CONSTRUCTION: at every evaluation date t, the signal function only sees
 * data up to and including t. The trade is entered at the open of t+1 and
 * exited at the close of t+holdingSessions - nothing after t is visible to
 * the signal.
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
  const calendar = validatedBenchmark.map((b) => b.date);
  const signalReturns: number[] = [];
  const baselineReturns: number[] = [];
  let universeSize = 0;

  for (const entry of universe) {
    const { bars: allBars } = validateBars(entry.bars, { splitAtBreaks: false });
    if (allBars.length === 0) continue;
    universeSize += 1;

    // Each segment between price discontinuities (suspected corporate actions,
    // unverified gap-downs, missing sessions) is backtested on its own: prices
    // on either side are not comparable, so no signal history or holding
    // window may span one. Each split decision uses only the two bars around
    // it (plus the calendar between them), so it adds no look-ahead.
    for (const bars of splitAtPriceBreaks(allBars, calendar).segments) {
      // Pointer-based incremental alignment: both `bars` and `validatedBenchmark`
      // are sorted ascending, so the benchmark cutoff index only moves forward
      // as t increases - O(n + m) per segment instead of O(n * m).
      let benchPtr = 0;

      // Entry needs bar t+1 (next session's open); exit is bar t+holdingSessions.
      const lastT = bars.length - 1 - Math.max(1, config.holdingSessions);
      for (let t = 0; t <= lastT; t++) {
        const asOfDate = bars[t].date;
        while (benchPtr < validatedBenchmark.length && validatedBenchmark[benchPtr].date <= asOfDate) {
          benchPtr += 1;
        }
        const benchmarkUpToT = validatedBenchmark.slice(0, benchPtr);

        const entryOpen = bars[t + 1].open;
        const exitClose = bars[t + Math.max(1, config.holdingSessions)].close;
        const grossPct = ((exitClose / entryOpen) - 1) * 100;
        const netPct = grossPct - config.costBps / 100;

        baselineReturns.push(netPct);

        const barsUpToT = bars.slice(0, t + 1);
        const signal = signalFn(barsUpToT, benchmarkUpToT);
        if (signal === true) {
          signalReturns.push(netPct);
        }
      }
    }
  }

  const signalStats = computeSampleStats(signalReturns);
  const warnings = [SURVIVORSHIP_WARNING, EXECUTION_WARNING, OVERLAP_WARNING, PRICE_BREAK_WARNING, costWarning(config.costBps)];
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
