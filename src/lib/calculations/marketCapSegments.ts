import type { DailyBar } from "../../types/market";
import type { AppSettings } from "../../types/config";
import type { RawDataset } from "../../types/dataset";
import type { MarketCapSegmentDefinition } from "../../config/marketCapSegments";
import type { MarketCapSegmentMetrics } from "../../types/marketCapSegment";
import { unavailable } from "../../types/metrics";
import { assembleSectorMetrics } from "./assemble";
import { computeRegime } from "./regime";

const SELF_BENCHMARK_REASON = "not meaningful: this is the NIFTY 500 benchmark compared against itself";

/**
 * Computes full metrics for one market-cap segment panel, reusing
 * assembleSectorMetrics exactly as sectors and industries do - a market-cap
 * segment is just another index + constituent-stock basket.
 *
 * The one deliberate deviation: for the NIFTY 500 panel itself,
 * "relative performance vs NIFTY 500" is replaced with an explicit
 * unavailable value (comparing a benchmark to itself is always exactly 0,
 * not a real signal), and its regime is recomputed WITHOUT requiring that
 * condition - otherwise the broad-market panel could structurally never
 * classify as bullish, which would be a misleading artifact of the
 * calculation, not an observation about the market. See regime.ts's
 * `RegimeOptions.requireRelativePerformance` doc for the full rationale.
 */
export function computeMarketCapSegmentMetrics(
  def: MarketCapSegmentDefinition,
  dataset: RawDataset,
  validatedBenchmarkBars: DailyBar[],
  settings: AppSettings,
): MarketCapSegmentMetrics {
  const series = dataset.indexSeries[def.slug];
  const constituentRecords = dataset.constituents[def.slug]?.constituents ?? [];
  const constituentSymbols = constituentRecords.map((c) => c.symbol);

  let metrics = assembleSectorMetrics(
    {
      slug: def.slug,
      displayName: def.panelLabel,
      rawBars: series?.bars ?? [],
      constituentSymbols,
      stocks: dataset.stocks,
      isBreadthProxy: false,
    },
    validatedBenchmarkBars,
    settings,
  );

  if (def.isSelfBenchmark) {
    const notMeaningful = unavailable<number>(SELF_BENCHMARK_REASON);
    metrics = {
      ...metrics,
      relativeStrength: {
        w1: notMeaningful,
        m1: notMeaningful,
        m3: notMeaningful,
        m6: notMeaningful,
        ratioSeries: unavailable(SELF_BENCHMARK_REASON),
      },
      regime: computeRegime(
        {
          return1m: metrics.returns.m1,
          return3m: metrics.returns.m3,
          return6m: metrics.returns.m6,
          relativePerformance3m: notMeaningful,
          breadth20: metrics.breadth.above20dma.pct,
          breadth50: metrics.breadth.above50dma.pct,
          breadth200: metrics.breadth.above200dma.pct,
        },
        settings.regime,
        { requireRelativePerformance: false },
      ),
    };
  }

  const symbolsWithHistory = constituentSymbols.filter((sym) => (dataset.stocks[sym]?.bars.length ?? 0) > 0).length;

  return {
    slug: def.slug,
    panelLabel: def.panelLabel,
    isSelfBenchmark: def.isSelfBenchmark,
    overlapNote: def.overlapNote,
    metrics,
    coverage: {
      totalConstituents: constituentSymbols.length,
      symbolsWithHistory,
      missingHistoryCount: constituentSymbols.length - symbolsWithHistory,
    },
  };
}
