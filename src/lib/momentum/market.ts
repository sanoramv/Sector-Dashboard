import type { AppSettings } from "../../types/config";
import type { DailyBar } from "../../types/market";
import type { BreadthWindowResult, Maybe, RegimeAssessment, ReturnMetrics } from "../../types/metrics";
import { ok, unavailable } from "../../types/metrics";
import { computeReturnOverSessions, computeReturns } from "../calculations/returns";
import { computeRegime } from "../calculations/regime";
import { isAboveMovingAverage, type MaWindow } from "../calculations/breadth";
import { isStale } from "../calculations/validation";
import { comparableBarsUpTo, lastIndexOnOrBefore, type PreparedIndex, type PreparedUniverse } from "./universe";

export interface BreadthAt {
  above20dma: BreadthWindowResult;
  above50dma: BreadthWindowResult;
  above200dma: BreadthWindowResult;
}

export interface MarketContextAt {
  date: string;
  benchmarkReturns: ReturnMetrics;
  breadth: BreadthAt;
  regime: RegimeAssessment;
}

/**
 * % of `symbols` above their own 20/50/200-day SMA at the close of `date`,
 * following computeBreadth's rules exactly - each stock's comparable bars up
 * to `date` (never across a price discontinuity), stale stocks (no bar within
 * 7 calendar days) ineligible - using the prepared segments for speed.
 * tests/momentum/realData.test.ts checks it against the dashboard.
 */
export function breadthAt(u: PreparedUniverse, symbols: readonly string[], date: string): BreadthAt {
  const windows: MaWindow[] = [20, 50, 200];
  const eligible = [0, 0, 0];
  const above = [0, 0, 0];
  let total = 0;
  for (const symbol of symbols) {
    const stock = u.contextStocks.get(symbol);
    if (!stock) continue;
    total += 1;
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
  return { above20dma: window(0), above50dma: window(1), above200dma: window(2) };
}

const barsUpTo = (bars: DailyBar[], indexByDate: Map<string, number>, date: string) => {
  const i = indexByDate.get(date);
  return i === undefined ? bars.filter((b) => b.date <= date) : bars.slice(0, i + 1);
};

export function benchmarkUpTo(u: PreparedUniverse, date: string): DailyBar[] {
  return barsUpTo(u.benchmark, u.calendarIndex, date);
}

/**
 * NIFTY 500 market regime as it stood at the close of `date`, computed the
 * same way as the dashboard's NIFTY 500 panel (computeMarketCapSegmentMetrics
 * with isSelfBenchmark): computeRegime on the index's own 1M/3M/6M returns
 * and constituent breadth, without the self-referential relative-strength
 * condition.
 */
export function marketContextAt(u: PreparedUniverse, date: string, settings: AppSettings): MarketContextAt {
  const benchmarkReturns = computeReturns(benchmarkUpTo(u, date));
  const breadth = breadthAt(u, u.breadthSymbols, date);
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

export interface IndexContextAt {
  slug: string;
  displayName: string;
  /** The index's change on `date` (unavailable if it has no bar that day). */
  changePct: Maybe<number>;
  /** Index 21-session return minus NIFTY 500's, pp. */
  relativeStrength1m: Maybe<number>;
  /** Index close vs its own 50-day SMA. */
  above50dma: boolean | null;
  /** Constituents above their 50-day SMA (sector indices only). */
  breadth50: BreadthWindowResult | null;
}

/** Context for a sector index or NIFTY 50 at the close of `date`, using only bars up to `date`. */
export function indexContextAt(u: PreparedUniverse, index: PreparedIndex, date: string): IndexContextAt {
  const bars = barsUpTo(index.bars, index.indexByDate, date);
  const tradedToday = bars.length > 0 && bars[bars.length - 1].date === date;
  const d1 = tradedToday ? computeReturnOverSessions(bars, 1) : unavailable<number>(`${index.displayName} has no bar for ${date}`);
  const r21 = computeReturnOverSessions(bars, 21);
  const b21 = computeReturnOverSessions(benchmarkUpTo(u, date), 21);
  return {
    slug: index.slug,
    displayName: index.displayName,
    changePct: d1,
    relativeStrength1m: r21.available && b21.available ? ok(r21.value - b21.value) : unavailable(r21.available ? "benchmark 21-session return unavailable" : r21.reason),
    above50dma: isAboveMovingAverage(bars.map((b) => b.close), 50),
    breadth50: index.constituents.length > 0 ? breadthAt(u, index.constituents, date).above50dma : null,
  };
}
