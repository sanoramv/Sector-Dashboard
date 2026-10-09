import { BENCHMARK } from "../../config/sectorUniverse";
import type { RawDataset } from "../../types/dataset";
import type { AppSettings } from "../../types/config";
import { runBacktest, type BacktestResult } from "./engine";
import { BACKTEST_RULES } from "./rules";

export interface BacktestRunConfig {
  holdingSessions: number;
  costBps: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestRunConfig = {
  holdingSessions: 10,
  costBps: 20,
};

/**
 * Runs every rule in BACKTEST_RULES over the NIFTY 500 constituent universe
 * (same universe as the stock screener). This is CPU-heavy (seconds, not
 * milliseconds, for ~500 stocks x ~280 trading days x 9 rules) - callers
 * should trigger it explicitly (a button), not on every render, and show a
 * loading state while it runs.
 */
export function runAllBacktests(dataset: RawDataset, settings: AppSettings, config: BacktestRunConfig): BacktestResult[] {
  const benchmarkConstituents = dataset.constituents[BENCHMARK.slug]?.constituents ?? [];
  const universe = benchmarkConstituents
    .map((c) => ({ symbol: c.symbol, bars: dataset.stocks[c.symbol]?.bars ?? [] }))
    .filter((u) => u.bars.length > 0);
  const benchmarkBars = dataset.indexSeries[BENCHMARK.slug]?.bars ?? [];

  return BACKTEST_RULES.map((rule) => {
    const signalFn = rule.makeSignal(settings);
    return runBacktest(rule.label, universe, benchmarkBars, signalFn, config);
  });
}
