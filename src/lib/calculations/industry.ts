import type { DailyBar, StockSeries } from "../../types/market";
import type { AppSettings } from "../../types/config";
import type { IndustryMetrics } from "../../types/industry";
import { ok, unavailable, type ReturnMetrics } from "../../types/metrics";
import { validateBars } from "./validation";
import { computeReturns } from "./returns";
import { computeDistanceFrom52wHigh } from "./distanceFromHigh";
import { computeRelativeStrength } from "./relativeStrength";
import { computeBreadth } from "./breadth";
import { computeScore } from "./scoring";
import { computeRegime } from "./regime";
import { averageAvailable } from "./aggregate";

export function slugifyIndustry(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/**
 * NSE does not publish a price index for most industry classifications, so
 * this computes an equal-weighted AVERAGE across the industry's own
 * constituent stocks' individually-computed metrics - a transparent derived
 * aggregate, not an official index value. Breadth reuses the exact same
 * real-constituent mechanism as sector breadth (computeBreadth).
 *
 * Industries with fewer than `settings.industry.minConstituentsForAggregate`
 * stocks still get computed numbers (for transparency) but are forced to
 * "insufficient-data" regime, since an aggregate over 1-2 stocks is not a
 * meaningful industry signal.
 */
export function computeIndustryMetrics(
  industryName: string,
  symbols: string[],
  stocks: Record<string, StockSeries>,
  validatedBenchmarkBars: DailyBar[],
  settings: AppSettings,
): IndustryMetrics {
  const slug = slugifyIndustry(industryName);

  const perStock = symbols
    .map((symbol) => {
      const series = stocks[symbol];
      if (!series) return null;
      const { bars } = validateBars(series.bars);
      if (bars.length === 0) return null;
      return {
        symbol,
        bars,
        returns: computeReturns(bars),
        distanceFrom52wHigh: computeDistanceFrom52wHigh(bars),
        relativeStrength: computeRelativeStrength(bars, validatedBenchmarkBars),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  const latestDate = perStock
    .map((s) => s.bars[s.bars.length - 1]?.date)
    .filter((d): d is string => Boolean(d))
    .sort()
    .at(-1);

  const d1 = averageAvailable(perStock.map((s) => s.returns.d1), "no constituent had a computable 1D return");
  const w1 = averageAvailable(perStock.map((s) => s.returns.w1), "no constituent had a computable 1W return");
  const m1 = averageAvailable(perStock.map((s) => s.returns.m1), "no constituent had a computable 1M return");
  const m3 = averageAvailable(perStock.map((s) => s.returns.m3), "no constituent had a computable 3M return");
  const m6 = averageAvailable(perStock.map((s) => s.returns.m6), "no constituent had a computable 6M return");
  const returns: ReturnMetrics = { d1: d1.value, w1: w1.value, m1: m1.value, m3: m3.value, m6: m6.value };

  const distance = averageAvailable(
    perStock.map((s) => s.distanceFrom52wHigh),
    "no constituent had a computable 52-week-high distance",
  );
  const rs3m = averageAvailable(
    perStock.map((s) => s.relativeStrength.m3),
    "no constituent had a computable 3M relative performance",
  );

  const stockSeriesList = symbols.map((sym) => stocks[sym]).filter((s): s is StockSeries => s !== undefined);
  const breadthAsOfDate = latestDate ?? validatedBenchmarkBars[validatedBenchmarkBars.length - 1]?.date ?? "";
  const breadth = computeBreadth(stockSeriesList, breadthAsOfDate, false);

  const score = computeScore(
    { returns, breadth, distanceFrom52wHigh: distance.value, relativePerformance3m: rs3m.value },
    settings.scoring,
  );

  const tooFewConstituents = symbols.length < settings.industry.minConstituentsForAggregate;

  const regime = tooFewConstituents
    ? {
        regime: "insufficient-data" as const,
        reasons: [
          `Only ${symbols.length} constituent stock(s) are classified under this industry - at least ${settings.industry.minConstituentsForAggregate} are required for a reliable aggregate.`,
        ],
        shortVsLongConflict: false,
        confidence: "low" as const,
        confidenceReasons: ["Too few constituents for a meaningful aggregate."],
      }
    : computeRegime(
        {
          return1m: returns.m1,
          return3m: returns.m3,
          return6m: returns.m6,
          relativePerformance3m: rs3m.value,
          breadth20: breadth.above20dma.pct,
          breadth50: breadth.above50dma.pct,
          breadth200: breadth.above200dma.pct,
        },
        settings.regime,
      );

  const missing: string[] = [];
  if (!returns.d1.available) missing.push("1D average return");
  if (!returns.m1.available) missing.push("1M average return");
  if (!returns.m3.available) missing.push("3M average return");
  if (!returns.m6.available) missing.push("6M average return");
  if (!breadth.above20dma.pct.available) missing.push("20-DMA breadth");
  if (!breadth.above200dma.pct.available) missing.push("200-DMA breadth");
  if (!distance.value.available) missing.push("average distance from 52-week high");
  if (!rs3m.value.available) missing.push("average 3M relative performance");
  if (tooFewConstituents) missing.push("insufficient constituent count for a reliable aggregate");

  const status = missing.length === 0 ? "complete" : missing.length >= 5 ? "unavailable" : "partial";

  return {
    name: industryName,
    slug,
    stockCount: symbols.length,
    asOfDate: latestDate ? ok(latestDate) : unavailable("no constituent had any valid price data"),
    returns,
    returnsSampleSize: { d1: d1.sampleSize, w1: w1.sampleSize, m1: m1.sampleSize, m3: m3.sampleSize, m6: m6.sampleSize },
    distanceFrom52wHigh: distance.value,
    distanceSampleSize: distance.sampleSize,
    relativePerformance3m: rs3m.value,
    relativePerformanceSampleSize: rs3m.sampleSize,
    breadth,
    score,
    regime,
    dataQuality: { status, missing },
  };
}

/** Groups a sector constituents map's industry field into {industryName -> symbols[]}. */
export function groupSymbolsByIndustry(
  constituents: Array<{ symbol: string; industry: string }>,
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const c of constituents) {
    (groups[c.industry] ??= []).push(c.symbol);
  }
  return groups;
}
