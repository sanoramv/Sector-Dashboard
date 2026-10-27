import type { DailyBar } from "../../types/market";
import type { RawDataset } from "../../types/dataset";
import type { ActivityRow } from "../../types/activity";
import type { SizeSegment } from "../../types/momentum";
import { BENCHMARK, SECTOR_UNIVERSE } from "../../config/sectorUniverse";
import { MARKET_CONTEXT_INDICES } from "../../config/marketIndices";
import { splitAtPriceBreaks, validateBars, type PriceBreak } from "../calculations/validation";

/**
 * The discovery universe and its price history, prepared ONCE per dataset so
 * that any date can be evaluated cheaply - the backtest engine's approach
 * (src/lib/backtest/engine.ts): validate each stock once without truncation,
 * then split it at every price discontinuity (suspected corporate action,
 * unverified gap-down, missing sessions vs the NIFTY 500 calendar).
 *
 * Why this equals the dashboard's own per-date validation: every break
 * decision uses only the two bars around it (plus calendar dates between
 * them), so validateBars(bars up to t, { calendar }) - which keeps the bars
 * from the latest break up to t - is exactly "the segment containing t,
 * cut at t". tests/momentum/realData.test.ts checks this against
 * assembleStockScreenResult on the published data.
 */

/**
 * Nifty Total Market = NIFTY 500 + NIFTY Microcap 250 (NSE's published
 * methodology; the official ind_niftytotalmarket_list.csv was diffed against
 * these two lists on 2026-10-27: identical except index changes made after
 * the constituent lists were last fetched - see DATA_SOURCES.md).
 */
export const TOTAL_MARKET_COMPONENT_SLUGS = [BENCHMARK.slug, "microcap250"] as const;

export interface UniverseStock {
  symbol: string;
  companyName: string;
  industry: string;
  segment: SizeSegment | null;
  /** Validated (clean, sorted, deduplicated), NOT split. */
  bars: DailyBar[];
  /** For each bar: index of its segment and of the bar within it. */
  segOf: Int32Array;
  posInSeg: Int32Array;
  segments: DailyBar[][];
  /** Discontinuity that STARTS at each bar (null for none), aligned with `bars`. */
  breakAt: Array<PriceBreak | null>;
  indexByDate: Map<string, number>;
  /** Volume/turnover/delivery rows by date (empty when the activity file is unavailable). */
  activityByDate: Map<string, ActivityRow>;
}

export interface PreparedIndex {
  slug: string;
  displayName: string;
  /** Validated bars. */
  bars: DailyBar[];
  indexByDate: Map<string, number>;
  /** Constituent symbols (sector indices only; empty for NIFTY 50). */
  constituents: string[];
}

export interface PreparedUniverse {
  /** Validated NIFTY 500 bars (the benchmark and trading calendar). */
  benchmark: DailyBar[];
  /** Tracked sector indices and NIFTY 50, keyed by slug. Missing series are simply absent. */
  indices: Map<string, PreparedIndex>;
  /** Tracked sector slugs each symbol belongs to, in SECTOR_UNIVERSE order. */
  sectorsOf: Map<string, string[]>;
  /**
   * Every stock with prepared history: the ranking universe plus sector-index
   * constituents outside it (used only for sector breadth, never ranked).
   */
  contextStocks: Map<string, UniverseStock>;
  calendar: string[];
  calendarIndex: Map<string, number>;
  stocks: UniverseStock[];
  bySymbol: Map<string, UniverseStock>;
  /** Symbols of the NIFTY 500 list - the breadth universe the dashboard's market panels use. */
  breadthSymbols: string[];
  activityLoaded: boolean;
  /** When the constituent lists were fetched (the universe is CURRENT membership applied to all history). */
  constituentsFetchedAt: string | null;
}

function segmentFor(symbol: string, lists: Record<string, Set<string>>): SizeSegment | null {
  if (lists.microcap250?.has(symbol)) return "micro";
  if (lists.smallcap250?.has(symbol)) return "small";
  if (lists.midcap150?.has(symbol)) return "mid";
  if (lists[BENCHMARK.slug]?.has(symbol)) return "large";
  return null;
}

export function prepareUniverse(dataset: RawDataset, activity: Record<string, ActivityRow[]> | null): PreparedUniverse {
  const { bars: benchmark } = validateBars(dataset.indexSeries[BENCHMARK.slug]?.bars ?? []);
  const calendar = benchmark.map((b) => b.date);
  const calendarIndex = new Map(calendar.map((d, i) => [d, i]));

  const lists: Record<string, Set<string>> = {};
  for (const slug of [BENCHMARK.slug, "midcap150", "smallcap250", "microcap250"]) {
    lists[slug] = new Set(dataset.constituents[slug]?.constituents.map((c) => c.symbol) ?? []);
  }

  const prepare = (c: { symbol: string; companyName: string; industry: string }): UniverseStock => {
    const { bars } = validateBars(dataset.stocks[c.symbol]?.bars ?? [], { splitAtBreaks: false });
    const { segments, breaks } = splitAtPriceBreaks(bars, calendar);
    const segOf = new Int32Array(bars.length);
    const posInSeg = new Int32Array(bars.length);
    let k = 0;
    segments.forEach((seg, s) => {
      seg.forEach((_b, p) => {
        segOf[k] = s;
        posInSeg[k] = p;
        k += 1;
      });
    });
    const breakByDate = new Map(breaks.map((b) => [b.date, b]));
    const activityRows = activity?.[c.symbol] ?? [];
    return {
      symbol: c.symbol,
      companyName: c.companyName,
      industry: c.industry,
      segment: segmentFor(c.symbol, lists),
      bars,
      segOf,
      posInSeg,
      segments,
      breakAt: bars.map((b) => breakByDate.get(b.date) ?? null),
      indexByDate: new Map(bars.map((b, i) => [b.date, i])),
      activityByDate: new Map(activityRows.map((r) => [r.date, r])),
    };
  };

  const stocks: UniverseStock[] = [];
  const contextStocks = new Map<string, UniverseStock>();
  for (const slug of TOTAL_MARKET_COMPONENT_SLUGS) {
    for (const c of dataset.constituents[slug]?.constituents ?? []) {
      if (contextStocks.has(c.symbol)) continue;
      const stock = prepare(c);
      stocks.push(stock);
      contextStocks.set(c.symbol, stock);
    }
  }

  const indices = new Map<string, PreparedIndex>();
  const sectorsOf = new Map<string, string[]>();
  for (const def of [...SECTOR_UNIVERSE, ...MARKET_CONTEXT_INDICES]) {
    const raw = dataset.indexSeries[def.slug]?.bars;
    if (!raw || raw.length === 0) continue;
    const { bars } = validateBars(raw);
    const constituents = dataset.constituents[def.slug]?.constituents ?? [];
    for (const c of constituents) {
      if (!contextStocks.has(c.symbol)) contextStocks.set(c.symbol, prepare(c));
      const list = sectorsOf.get(c.symbol) ?? [];
      list.push(def.slug);
      sectorsOf.set(c.symbol, list);
    }
    indices.set(def.slug, { slug: def.slug, displayName: def.displayName, bars, indexByDate: new Map(bars.map((b, i) => [b.date, i])), constituents: constituents.map((c) => c.symbol) });
  }

  const fetchedAt = dataset.constituents[BENCHMARK.slug]?.fetchedAt ?? null;
  return {
    benchmark,
    indices,
    sectorsOf,
    contextStocks,
    calendar,
    calendarIndex,
    stocks,
    bySymbol: new Map(stocks.map((s) => [s.symbol, s])),
    breadthSymbols: [...lists[BENCHMARK.slug]],
    activityLoaded: activity !== null,
    constituentsFetchedAt: fetchedAt,
  };
}

/** Comparable bars up to and including bar `i`: its segment, cut at `i` (what validateBars would return for history up to that date). */
export function comparableBarsUpTo(stock: UniverseStock, i: number): DailyBar[] {
  const seg = stock.segments[stock.segOf[i]];
  return seg.slice(0, stock.posInSeg[i] + 1);
}

/** Index of the last bar dated on or before `date`, or -1. */
export function lastIndexOnOrBefore(stock: UniverseStock, date: string): number {
  const exact = stock.indexByDate.get(date);
  if (exact !== undefined) return exact;
  let lo = 0;
  let hi = stock.bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (stock.bars[mid].date <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
