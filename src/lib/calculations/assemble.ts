import type { DailyBar, StockCloseSeries } from "../../types/market";
import type { AppSettings } from "../../types/config";
import { ok, unavailable, type SectorMetrics } from "../../types/metrics";
import { validateBars } from "./validation";
import { computeReturns } from "./returns";
import { computeDistanceFrom52wHigh } from "./distanceFromHigh";
import { computeRelativeStrength } from "./relativeStrength";
import { computeBreadth } from "./breadth";
import { computeScore } from "./scoring";
import { computeRegime } from "./regime";

export interface SectorInput {
  slug: string;
  displayName: string;
  rawBars: DailyBar[];
  constituentSymbols: string[];
  stockCloses: Record<string, StockCloseSeries>;
  isBreadthProxy: boolean;
  excludeFromHeadlineCount?: boolean;
  overlapNote?: string;
}

/**
 * Builds the full SectorMetrics for one sector from raw inputs. `benchmarkBars`
 * must already be validated (clean, sorted, deduplicated) - validating it once
 * per dataset load and reusing it across every sector avoids redundant work
 * and guarantees every sector is compared against the exact same benchmark series.
 */
export function assembleSectorMetrics(
  input: SectorInput,
  validatedBenchmarkBars: DailyBar[],
  settings: AppSettings,
): SectorMetrics {
  const { bars, warnings: validationWarnings } = validateBars(input.rawBars);

  if (bars.length === 0) {
    return {
      slug: input.slug,
      displayName: input.displayName,
      currentClose: unavailable("no valid price data"),
      latestDate: unavailable("no valid price data"),
      returns: {
        d1: unavailable("no data"),
        w1: unavailable("no data"),
        m1: unavailable("no data"),
        m3: unavailable("no data"),
        m6: unavailable("no data"),
      },
      breadth: {
        above20dma: { pct: unavailable("no data"), eligible: 0, total: input.constituentSymbols.length },
        above50dma: { pct: unavailable("no data"), eligible: 0, total: input.constituentSymbols.length },
        above200dma: { pct: unavailable("no data"), eligible: 0, total: input.constituentSymbols.length },
        isProxy: input.isBreadthProxy,
      },
      distanceFrom52wHigh: unavailable("no data"),
      relativeStrength: {
        w1: unavailable("no data"),
        m1: unavailable("no data"),
        m3: unavailable("no data"),
        m6: unavailable("no data"),
        ratioSeries: unavailable("no data"),
      },
      score: { conditions: [], pointsEarned: 0, pointsPossible: 0, completenessPct: 0 },
      regime: {
        regime: "insufficient-data",
        reasons: ["No valid price data for this sector."],
        shortVsLongConflict: false,
        confidence: "low",
        confidenceReasons: ["No data available."],
      },
      dataQuality: { status: "unavailable", missing: ["all price-derived metrics"] },
      priceSeries: [],
      excludeFromHeadlineCount: input.excludeFromHeadlineCount,
      overlapNote: input.overlapNote,
    };
  }

  const latestBar = bars[bars.length - 1];
  const returns = computeReturns(bars);
  const distanceFrom52wHigh = computeDistanceFrom52wHigh(bars);
  const relativeStrength = computeRelativeStrength(bars, validatedBenchmarkBars);

  const stocks = input.constituentSymbols
    .map((sym) => input.stockCloses[sym])
    .filter((s): s is StockCloseSeries => s !== undefined);
  const breadth = computeBreadth(stocks, latestBar.date, input.isBreadthProxy);

  const score = computeScore(
    {
      returns,
      breadth,
      distanceFrom52wHigh,
      relativePerformance3m: relativeStrength.m3,
    },
    settings.scoring,
  );

  const regime = computeRegime(
    {
      return1m: returns.m1,
      return3m: returns.m3,
      return6m: returns.m6,
      relativePerformance3m: relativeStrength.m3,
      breadth20: breadth.above20dma.pct,
      breadth50: breadth.above50dma.pct,
      breadth200: breadth.above200dma.pct,
    },
    settings.regime,
  );

  const missing: string[] = [];
  if (!returns.d1.available) missing.push("1D return");
  if (!returns.w1.available) missing.push("1W return");
  if (!returns.m1.available) missing.push("1M return");
  if (!returns.m3.available) missing.push("3M return");
  if (!returns.m6.available) missing.push("6M return");
  if (!breadth.above20dma.pct.available) missing.push("20-DMA breadth");
  if (!breadth.above50dma.pct.available) missing.push("50-DMA breadth");
  if (!breadth.above200dma.pct.available) missing.push("200-DMA breadth");
  if (!distanceFrom52wHigh.available) missing.push("distance from 52-week high");
  if (!relativeStrength.m3.available) missing.push("3M relative performance");
  if (validationWarnings.length > 0) missing.push(...validationWarnings.map((w) => `data warning: ${w}`));

  const status = missing.length === 0 ? "complete" : missing.length >= 6 ? "unavailable" : "partial";

  return {
    slug: input.slug,
    displayName: input.displayName,
    currentClose: ok(latestBar.close),
    latestDate: ok(latestBar.date),
    returns,
    breadth,
    distanceFrom52wHigh,
    relativeStrength,
    score,
    regime,
    dataQuality: { status, missing },
    priceSeries: bars,
    excludeFromHeadlineCount: input.excludeFromHeadlineCount,
    overlapNote: input.overlapNote,
  };
}
