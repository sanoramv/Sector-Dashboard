import type { StockSeries } from "../../types/market";
import type { BreadthMetrics, BreadthWindowResult } from "../../types/metrics";
import { ok, unavailable } from "../../types/metrics";

export type MaWindow = 20 | 50 | 200;

/**
 * Whether the latest close is above the simple moving average of the
 * trailing `window` closes (the window ending at, and including, the latest
 * close). Returns null when there isn't enough history to compute the MA -
 * callers must treat null as "not eligible", never as false.
 */
export function isAboveMovingAverage(closes: number[], window: MaWindow): boolean | null {
  if (closes.length < window) return null;
  const slice = closes.slice(closes.length - window);
  const sma = slice.reduce((sum, c) => sum + c, 0) / window;
  const latest = closes[closes.length - 1];
  return latest > sma;
}

function computeWindow(
  stocks: StockSeries[],
  asOfDate: string,
  window: MaWindow,
): BreadthWindowResult {
  let eligible = 0;
  let above = 0;

  for (const stock of stocks) {
    const closesUpToDate = stock.bars
      .filter((b) => b.date <= asOfDate)
      .map((b) => b.close);
    const result = isAboveMovingAverage(closesUpToDate, window);
    if (result === null) continue;
    eligible += 1;
    if (result) above += 1;
  }

  const total = stocks.length;
  if (eligible === 0) {
    return { pct: unavailable(`no constituent had ${window} days of price history`), eligible, total };
  }
  return { pct: ok((above / eligible) * 100), eligible, total };
}

/**
 * Breadth (%) = (constituents above their N-day MA / eligible constituents) x 100.
 * This measures the CONSTITUENT stocks' own moving averages - never the
 * sector index's own MA, which would be a different and far weaker signal.
 * `isProxy` must be set by the caller when `stocks` is not the official
 * index constituent list (e.g. a broader sector-stock universe substitute).
 */
export function computeBreadth(
  stocks: StockSeries[],
  asOfDate: string,
  isProxy: boolean,
): BreadthMetrics {
  return {
    above20dma: computeWindow(stocks, asOfDate, 20),
    above50dma: computeWindow(stocks, asOfDate, 50),
    above200dma: computeWindow(stocks, asOfDate, 200),
    isProxy,
  };
}
