import type { AppSettings } from "../../types/config";
import type { BreadthWindowResult, RegimeAssessment, ReturnMetrics } from "../../types/metrics";
import { ok, unavailable } from "../../types/metrics";
import { computeReturns } from "../calculations/returns";
import { computeRegime } from "../calculations/regime";
import { isAboveMovingAverage, type MaWindow } from "../calculations/breadth";
import { isStale } from "../calculations/validation";
import { comparableBarsUpTo, lastIndexOnOrBefore, type PreparedUniverse } from "./universe";

export interface MarketContextAt {
  date: string;
  benchmarkReturns: ReturnMetrics;
  breadth: { above20dma: BreadthWindowResult; above50dma: BreadthWindowResult; above200dma: BreadthWindowResult };
  regime: RegimeAssessment;
}

/**
 * NIFTY 500 market regime as it stood at the close of `date`, computed the
 * same way as the dashboard's NIFTY 500 panel (computeMarketCapSegmentMetrics
 * with isSelfBenchmark): computeRegime on the index's own 1M/3M/6M returns
 * and constituent breadth, without the self-referential relative-strength
 * condition. Breadth follows computeBreadth's rules exactly - each
 * constituent's comparable bars up to `date`, stale stocks (no bar within
 * 7 calendar days) ineligible - using the prepared segments for speed.
 */
export function marketContextAt(u: PreparedUniverse, date: string, settings: AppSettings): MarketContextAt {
  const benchIdx = u.calendarIndex.get(date);
  const benchBars = benchIdx === undefined ? u.benchmark.filter((b) => b.date <= date) : u.benchmark.slice(0, benchIdx + 1);
  const benchmarkReturns = computeReturns(benchBars);

  const windows: MaWindow[] = [20, 50, 200];
  const eligible = [0, 0, 0];
  const above = [0, 0, 0];
  const total = u.breadthSymbols.length;
  for (const symbol of u.breadthSymbols) {
    const stock = u.bySymbol.get(symbol);
    if (!stock) continue;
    const i = lastIndexOnOrBefore(stock, date);
    if (i < 0 || isStale(stock.bars[i].date, date)) continue;
    const seg = comparableBarsUpTo(stock, i);
    const closes = seg.slice(Math.max(0, seg.length - 200)).map((b) => b.close);
    windows.forEach((w, k) => {
      const r = isAboveMovingAverage(closes, w);
      if (r === null) return;
      eligible[k] += 1;
      if (r) above[k] += 1;
    });
  }
  const window = (k: number): BreadthWindowResult => ({
    pct: eligible[k] === 0 ? unavailable(`no constituent had ${windows[k]} days of current price history`) : ok((above[k] / eligible[k]) * 100),
    eligible: eligible[k],
    total,
  });
  const breadth = { above20dma: window(0), above50dma: window(1), above200dma: window(2) };

  const regime = computeRegime(
    {
      return1m: benchmarkReturns.m1,
      return3m: benchmarkReturns.m3,
      return6m: benchmarkReturns.m6,
      relativePerformance3m: unavailable("not meaningful: NIFTY 500 compared against itself"),
      breadth20: breadth.above20dma.pct,
      breadth50: breadth.above50dma.pct,
      breadth200: breadth.above200dma.pct,
    },
    settings.regime,
    { requireRelativePerformance: false },
  );
  return { date, benchmarkReturns, breadth, regime };
}
