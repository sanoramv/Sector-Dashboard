import type { DailyBar } from "../../types/market";
import type { AppSettings } from "../../types/config";
import type { PriceIntegrity, StockScreenResult } from "../../types/stockScreen";
import { ok, unavailable, type Maybe } from "../../types/metrics";
import { describeBreak, isStale, validateBars } from "./validation";
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
  const calendar = validatedBenchmarkBars.map((b) => b.date);
  const marketDate = calendar[calendar.length - 1];
  const { bars, warnings: validationWarnings, breaks } = validateBars(input.rawBars, { calendar });
  const usedBreak = breaks.length > 0 ? breaks[breaks.length - 1] : null;

  const noMetrics = (
    reason: string,
    priceIntegrity: PriceIntegrity,
    lastBar: DailyBar | undefined,
    missing: string[],
  ): StockScreenResult => ({
    symbol: input.symbol,
    companyName: input.companyName,
    industry: input.industry,
    sectorSlugs: input.sectorSlugs,
    currentClose: lastBar ? ok(lastBar.close) : unavailable(reason),
    latestDate: lastBar ? ok(lastBar.date) : unavailable(reason),
    returns: {
      d1: unavailable(reason),
      w1: unavailable(reason),
      m1: unavailable(reason),
      m3: unavailable(reason),
      m6: unavailable(reason),
    },
    distanceFrom52wHigh: unavailable(reason),
    relativePerformance3m: unavailable(reason),
    above50dma: unavailable(reason),
    above200dma: unavailable(reason),
    resistance: unavailable(reason),
    consolidation: unavailable(reason),
    triangle: unavailable(reason),
    score: { conditions: [], pointsEarned: 0, pointsPossible: 0, completenessPct: 0 },
    dataQuality: { status: "unavailable", missing },
    priceIntegrity,
    priceSeries: lastBar ? bars : [],
  });

  if (bars.length === 0) {
    return noMetrics("no data", { state: "no-data", usableFrom: null, breaks: [], note: "No valid price data." }, undefined, [
      "all price-derived metrics",
    ]);
  }

  // A stale stock gets NO current metrics and no score, so an old price can
  // never be ranked, filtered or pattern-matched as if it were current. Its
  // last close and date are still shown, explicitly labelled.
  const lastBar = bars[bars.length - 1];
  if (marketDate !== undefined && isStale(lastBar.date, marketDate)) {
    const note = `Stale price data - latest bar is ${lastBar.date} but the market date is ${marketDate}. No metric is computed until current prices arrive.`;
    return noMetrics(`stale price data (last bar ${lastBar.date})`, { state: "stale", usableFrom: null, breaks, note }, lastBar, [
      `data warning: ${note}`,
    ]);
  }

  const priceIntegrity: PriceIntegrity = usedBreak
    ? {
        state: "post-discontinuity-only",
        usableFrom: usedBreak.date,
        breaks,
        note: `Metrics use only prices from ${usedBreak.date} onward (${describeBreak(usedBreak)}). Anything needing a longer window is unavailable rather than computed across the discontinuity.`,
      }
    : { state: "clean", usableFrom: bars[0].date, breaks: [], note: null };

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
    priceIntegrity,
    priceSeries: bars,
  };
}
