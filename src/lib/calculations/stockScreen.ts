import type { DailyBar } from "../../types/market";
import type { AppSettings } from "../../types/config";
import type { StockScreenResult } from "../../types/stockScreen";
import { ok, unavailable, type Maybe } from "../../types/metrics";
import { validateBars } from "./validation";
import { computeReturns } from "./returns";
import { computeDistanceFrom52wHigh } from "./distanceFromHigh";
import { computeRelativeStrength } from "./relativeStrength";
import { isAboveMovingAverage } from "./breadth";
import { detectResistance, detectConsolidation, detectTriangle } from "./patterns";
import { computeStockScore } from "./stockScoring";

function maybeFromNullableBool(v: boolean | null): Maybe<boolean> {
  return v === null ? unavailable("not enough price history for this moving-average window") : ok(v);
}

export interface StockScreenInput {
  symbol: string;
  companyName: string;
  industry: string;
  sectorSlugs: string[];
  rawBars: DailyBar[];
}

/**
 * Builds the full screening result for one stock. `validatedBenchmarkBars`
 * must already be validated (clean, sorted, deduplicated) - the caller
 * validates the benchmark once per dataset load and reuses it across every
 * stock, exactly like assembleSectorMetrics does for sectors.
 */
export function assembleStockScreenResult(
  input: StockScreenInput,
  validatedBenchmarkBars: DailyBar[],
  settings: AppSettings,
): StockScreenResult {
  const { bars, warnings: validationWarnings } = validateBars(input.rawBars);

  if (bars.length === 0) {
    return {
      symbol: input.symbol,
      companyName: input.companyName,
      industry: input.industry,
      sectorSlugs: input.sectorSlugs,
      currentClose: unavailable("no valid price data"),
      latestDate: unavailable("no valid price data"),
      returns: {
        d1: unavailable("no data"),
        w1: unavailable("no data"),
        m1: unavailable("no data"),
        m3: unavailable("no data"),
        m6: unavailable("no data"),
      },
      distanceFrom52wHigh: unavailable("no data"),
      relativePerformance3m: unavailable("no data"),
      above50dma: unavailable("no data"),
      above200dma: unavailable("no data"),
      resistance: unavailable("no data"),
      consolidation: unavailable("no data"),
      triangle: unavailable("no data"),
      score: { conditions: [], pointsEarned: 0, pointsPossible: 0, completenessPct: 0 },
      dataQuality: { status: "unavailable", missing: ["all price-derived metrics"] },
      priceSeries: [],
    };
  }

  const latestBar = bars[bars.length - 1];
  const returns = computeReturns(bars);
  const distanceFrom52wHigh = computeDistanceFrom52wHigh(bars);
  const relativeStrength = computeRelativeStrength(bars, validatedBenchmarkBars);

  const closes = bars.map((b) => b.close);
  const above50dma = maybeFromNullableBool(isAboveMovingAverage(closes, 50));
  const above200dma = maybeFromNullableBool(isAboveMovingAverage(closes, 200));

  const resistance = detectResistance(bars, settings.screening);
  const consolidation = detectConsolidation(bars, settings.screening);
  const triangle = detectTriangle(bars, settings.screening);

  const score = computeStockScore(
    {
      returns,
      distanceFrom52wHigh,
      relativePerformance3m: relativeStrength.m3,
      above50dma,
      above200dma,
      resistance,
      consolidation,
      triangle,
    },
    settings.scoring,
  );

  const missing: string[] = [];
  if (!returns.m1.available) missing.push("1M return");
  if (!returns.m3.available) missing.push("3M return");
  if (!distanceFrom52wHigh.available) missing.push("distance from 52-week high");
  if (!relativeStrength.m3.available) missing.push("3M relative performance");
  if (!above50dma.available) missing.push("above-50-DMA flag");
  if (!above200dma.available) missing.push("above-200-DMA flag");
  if (!resistance.available) missing.push("resistance proximity");
  if (!consolidation.available) missing.push("consolidation detection");
  if (!triangle.available) missing.push("triangle pattern detection");
  if (validationWarnings.length > 0) missing.push(...validationWarnings.map((w) => `data warning: ${w}`));

  const status = missing.length === 0 ? "complete" : missing.length >= 7 ? "unavailable" : "partial";

  return {
    symbol: input.symbol,
    companyName: input.companyName,
    industry: input.industry,
    sectorSlugs: input.sectorSlugs,
    currentClose: ok(latestBar.close),
    latestDate: ok(latestBar.date),
    returns,
    distanceFrom52wHigh,
    relativePerformance3m: relativeStrength.m3,
    above50dma,
    above200dma,
    resistance,
    consolidation,
    triangle,
    score,
    dataQuality: { status, missing },
    priceSeries: bars,
  };
}
