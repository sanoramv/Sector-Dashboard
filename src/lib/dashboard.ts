import { BENCHMARK, findSectorBySlug, SECTOR_UNIVERSE } from "../config/sectorUniverse";
import type { AppSettings } from "../types/config";
import type { RawDataset } from "../types/dataset";
import type { MarketOverview, Regime, SectorMetrics } from "../types/metrics";
import { validateBars } from "./calculations/validation";
import { computeReturns } from "./calculations/returns";
import { computeBreadth } from "./calculations/breadth";
import { assembleSectorMetrics } from "./calculations/assemble";

export interface DashboardData {
  generatedAt: string;
  latestMarketDate: string;
  benchmark: SectorMetrics;
  sectors: SectorMetrics[];
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
      stockCloses: dataset.stockCloses,
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
        stockCloses: dataset.stockCloses,
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
    .map((sym) => dataset.stockCloses[sym])
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const broadMarketBreadth =
    broadMarketStocks.length > 0 && validatedBenchmarkBars.length > 0
      ? computeBreadth(broadMarketStocks, validatedBenchmarkBars[validatedBenchmarkBars.length - 1].date, false)
      : null;

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
        stockCloses: dataset.stockCloses,
        isBreadthProxy: false,
      },
      validatedBenchmark,
      settings,
    );
    entries.push({ date: asOfDate, regime: metrics.regime.regime });
  }
  return entries;
}
