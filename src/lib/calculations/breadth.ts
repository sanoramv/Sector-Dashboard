import type { StockSeries } from "../../types/market";
import type { BreadthMetrics, BreadthWindowResult } from "../../types/metrics";
import { ok, unavailable } from "../../types/metrics";
import { isStale, validateBars } from "./validation";

export type MaWindow = 20 | 50 | 200;

/**
 * Whether the latest close is above the simple moving average of the
 * trailing `window` closes (the window ending at, and including, the latest
 * close). Returns null when there isn't enough history to compute the MA -
 * callers must treat null as "not eligible", never as false.
 */
export function isAboveMovingAverage(closes: number[], window: MaWindow): boolean | null {
  const sma = simpleMovingAverage(closes, window);
  if (sma === null) return null;
  const latest = closes[closes.length - 1];
  return latest > sma;
}

/** Simple moving average of the trailing `window` closes (ending at, and including, the latest); null when there are fewer closes than `window`. */
export function simpleMovingAverage(closes: number[], window: number): number | null {
  if (closes.length < window || window <= 0) return null;
  let sum = 0;
  for (let i = closes.length - window; i < closes.length; i++) sum += closes[i];
  return sum / window;
}

/**
 * Closes (up to and including asOfDate) for each stock that is usable for
 * breadth. Validation runs on the truncated history, so price-break
 * detection only ever sees data available at asOfDate. A moving average is
 * never taken across a price discontinuity (unadjusted corporate action,
 * unverified gap-down, or missing sessions when `calendar` is given). Stocks with no bar
 * within STALE_AFTER_CALENDAR_DAYS of asOfDate are dropped (ineligible)
 * rather than counted on an old closing price.
 */
function eligibleCloses(stocks: StockSeries[], asOfDate: string, calendar?: readonly string[]): number[][] {
  const out: number[][] = [];
  for (const stock of stocks) {
    const { bars } = validateBars(stock.bars.filter((b) => b.date <= asOfDate), { calendar });
    if (bars.length === 0 || isStale(bars[bars.length - 1].date, asOfDate)) continue;
    out.push(bars.map((b) => b.close));
  }
  return out;
}

function computeWindow(closesPerStock: number[][], total: number, window: MaWindow): BreadthWindowResult {
  let eligible = 0;
  let above = 0;

  for (const closes of closesPerStock) {
    const result = isAboveMovingAverage(closes, window);
    if (result === null) continue;
    eligible += 1;
    if (result) above += 1;
  }

  if (eligible === 0) {
    return { pct: unavailable(`no constituent had ${window} days of current price history`), eligible, total };
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
  calendar?: readonly string[],
): BreadthMetrics {
  const closesPerStock = eligibleCloses(stocks, asOfDate, calendar);
  return {
    above20dma: computeWindow(closesPerStock, stocks.length, 20),
    above50dma: computeWindow(closesPerStock, stocks.length, 50),
    above200dma: computeWindow(closesPerStock, stocks.length, 200),
    isProxy,
  };
}
