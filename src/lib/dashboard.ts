import { BENCHMARK, findSectorBySlug, SECTOR_UNIVERSE } from "../config/sectorUniverse";
import { MARKET_CAP_SEGMENTS } from "../config/marketCapSegments";
import type { AppSettings } from "../types/config";
import type { RawDataset } from "../types/dataset";
import type { MarketOverview, Regime, SectorMetrics } from "../types/metrics";
import type { IndustryMetrics } from "../types/industry";
import type { StockScreenResult } from "../types/stockScreen";
import type { MarketCapSegmentMetrics } from "../types/marketCapSegment";
import { validateBars } from "./calculations/validation";
import { computeReturns } from "./calculations/returns";
import { computeBreadth } from "./calculations/breadth";
import { assembleSectorMetrics } from "./calculations/assemble";
import { computeIndustryMetrics, groupSymbolsByIndustry } from "./calculations/industry";
import { assembleStockScreenResult } from "./calculations/stockScreen";
import { computeMarketCapSegmentMetrics } from "./calculations/marketCapSegments";

export interface DashboardData {
  generatedAt: string;
  latestMarketDate: string;
  benchmark: SectorMetrics;
  sectors: SectorMetrics[];
  industries: IndustryMetrics[];
  stockScreen: StockScreenResult[];
  marketCapSegments: MarketCapSegmentMetrics[];
  overview: MarketOverview;
}

/**
 * Pure orchestration: turns the raw fetched dataset into everything the UI
 * renders. Deterministic for identical inputs - no network calls, no clock
 * reads (`generatedAt`/`latestMarketDate` come from the dataset's own manifest).
 */
export function buildDashboardData(dataset: RawDataset, settings: AppSettings): DashboardData {
  const benchmarkSeries = dataset.indexSeries[BENCHMARK.slug];
  const { bars: validatedBenchmarkBars } = validateBars(benchmarkSeries?.bars ?? []);

  const benchmarkConstituents = dataset.constituents[BENCHMARK.slug]?.constituents.map((c) => c.symbol) ?? [];
  const benchmark = assembleSectorMetrics(
    {
      slug: BENCHMARK.slug,
      displayName: BENCHMARK.displayName,
      rawBars: benchmarkSeries?.bars ?? [],
      constituentSymbols: benchmarkConstituents,
      stocks: dataset.stocks,
      isBreadthProxy: false,
    },
    validatedBenchmarkBars,
    settings,
  );

  const sectors = SECTOR_UNIVERSE.map((def) => {
    const series = dataset.indexSeries[def.slug];
    const constituents = dataset.constituents[def.slug]?.constituents.map((c) => c.symbol) ?? [];
    return assembleSectorMetrics(
      {
        slug: def.slug,
        displayName: def.displayName,
        rawBars: series?.bars ?? [],
        constituentSymbols: constituents,
        stocks: dataset.stocks,
        isBreadthProxy: false,
        excludeFromHeadlineCount: def.excludeFromHeadlineCount,
        overlapNote: def.overlapNote,
      },
      validatedBenchmarkBars,
      settings,
    );
  });

  const headlineSectors = sectors.filter((s) => !s.excludeFromHeadlineCount);
  const bullishCount = headlineSectors.filter((s) => s.regime.regime === "bullish").length;
  const sidewaysCount = headlineSectors.filter((s) => s.regime.regime === "sideways").length;
  const bearishCount = headlineSectors.filter((s) => s.regime.regime === "bearish").length;
  const insufficientDataCount = headlineSectors.filter((s) => s.regime.regime === "insufficient-data").length;

  const broadMarketStocks = benchmarkConstituents
    .map((sym) => dataset.stocks[sym])
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const broadMarketBreadth =
    broadMarketStocks.length > 0 && validatedBenchmarkBars.length > 0
      ? computeBreadth(broadMarketStocks, validatedBenchmarkBars[validatedBenchmarkBars.length - 1].date, false)
      : null;

  // Industry analysis uses NIFTY 500's constituent list as the universe - it's
  // the broadest tagged universe available, and its "Industry" field is NSE's
  // own published macro-industry classification (verified: 20 industries
  // across ~500 stocks), not an invented grouping.
  const benchmarkConstituentRecords = dataset.constituents[BENCHMARK.slug]?.constituents ?? [];
  const industryGroups = groupSymbolsByIndustry(benchmarkConstituentRecords);
  const industries = Object.entries(industryGroups)
    .map(([name, symbols]) => computeIndustryMetrics(name, symbols, dataset.stocks, validatedBenchmarkBars, settings))
    .sort((a, b) => b.stockCount - a.stockCount);

  // Stock screening universe = NIFTY 500 constituents (broadest tagged
  // universe). Each stock also records which TRACKED sector indices it
  // belongs to, so the screener can be filtered to "leading sectors".
  const sectorMembership = new Map<string, string[]>();
  for (const def of SECTOR_UNIVERSE) {
    const symbols = dataset.constituents[def.slug]?.constituents.map((c) => c.symbol) ?? [];
    for (const sym of symbols) {
      (sectorMembership.get(sym) ?? sectorMembership.set(sym, []).get(sym)!).push(def.slug);
    }
  }
  const stockScreen = benchmarkConstituentRecords.map((c) =>
    assembleStockScreenResult(
      {
        symbol: c.symbol,
        companyName: c.companyName,
        industry: c.industry,
        sectorSlugs: sectorMembership.get(c.symbol) ?? [],
        rawBars: dataset.stocks[c.symbol]?.bars ?? [],
      },
      validatedBenchmarkBars,
      settings,
    ),
  );

  const marketCapSegments = MARKET_CAP_SEGMENTS.map((def) =>
    computeMarketCapSegmentMetrics(def, dataset, validatedBenchmarkBars, settings),
  );

  const overview: MarketOverview = {
    benchmarkDisplayName: BENCHMARK.displayName,
    benchmarkReturns: computeReturns(validatedBenchmarkBars),
    bullishCount,
    sidewaysCount,
    bearishCount,
    insufficientDataCount,
    broadMarketBreadth,
  };

  return {
    generatedAt: dataset.manifest.generatedAt,
    latestMarketDate: dataset.manifest.latestMarketDate,
    benchmark,
    sectors,
    industries,
    stockScreen,
    marketCapSegments,
    overview,
  };
}

export interface RegimeHistoryEntry {
  date: string;
  regime: Regime;
}

/**
 * Recomputes the full regime classification as of each of the last
 * `sessions` trading days, by re-running the same calculation engine against
 * progressively truncated price history. This is real recomputation from the
 * same source data, not a separately stored/fabricated history - which is
 * why it costs re-running assembleSectorMetrics a handful of times rather
 * than being a stored field.
 */
export function computeRegimeHistory(
  sectorSlug: string,
  dataset: RawDataset,
  settings: AppSettings,
  sessions = 5,
): RegimeHistoryEntry[] {
  const def = findSectorBySlug(sectorSlug);
  if (!def) return [];

  const series = dataset.indexSeries[sectorSlug];
  const benchmarkSeries = dataset.indexSeries[BENCHMARK.slug];
  if (!series || !benchmarkSeries) return [];

  const constituents = dataset.constituents[sectorSlug]?.constituents.map((c) => c.symbol) ?? [];
  const bars = series.bars;
  const startIdx = Math.max(0, bars.length - sessions);

  const entries: RegimeHistoryEntry[] = [];
  for (let i = startIdx; i < bars.length; i++) {
    const truncatedBars = bars.slice(0, i + 1);
    const asOfDate = truncatedBars[truncatedBars.length - 1].date;
    const truncatedBenchmarkBars = benchmarkSeries.bars.filter((b) => b.date <= asOfDate);
    const { bars: validatedBenchmark } = validateBars(truncatedBenchmarkBars);

    const metrics = assembleSectorMetrics(
      {
        slug: sectorSlug,
        displayName: def.displayName,
        rawBars: truncatedBars,
        constituentSymbols: constituents,
        stocks: dataset.stocks,
        isBreadthProxy: false,
      },
      validatedBenchmark,
      settings,
    );
    entries.push({ date: asOfDate, regime: metrics.regime.regime });
  }
  return entries;
}
