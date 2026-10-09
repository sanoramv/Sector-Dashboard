import type { DailyBar } from "../../types/market";
import type { ScreeningConfig } from "../../types/config";
import { ok, unavailable, type Maybe } from "../../types/metrics";

/**
 * Pattern-detection heuristics for stock screening (resistance proximity,
 * consolidation/range contraction, and a simplified triangle detector).
 *
 * These are DISCLOSED, DETERMINISTIC HEURISTICS, not a validated chart-pattern
 * recognizer and not a prediction of future price direction. Every result
 * carries the exact window/threshold used so it is independently checkable.
 * See the backtest module (src/lib/backtest) for out-of-sample evidence
 * before treating any of these as predictive of anything.
 */

// ---------------------------------------------------------------------------
// Resistance proximity: nearest prior swing high in a trailing lookback window.
// ---------------------------------------------------------------------------

export interface ResistanceResult {
  level: number;
  levelDate: string;
  /** (latest close / level - 1) x 100. Negative = below the level. */
  distancePct: number;
  /** True when the close is below the level and within `proximityPct` of it. */
  isApproaching: boolean;
}

/**
 * "Resistance" here is simply the highest intraday high in the trailing
 * `lookbackSessions` sessions BEFORE today - the simplest, most common
 * definition of a prior swing-high ceiling. This is not a clustering/
 * confluence algorithm and does not account for multiple-touch significance.
 */
export function detectResistance(
  bars: DailyBar[],
  config: Pick<ScreeningConfig, "resistanceLookbackSessions" | "resistanceProximityPct">,
): Maybe<ResistanceResult> {
  const { resistanceLookbackSessions: lookback, resistanceProximityPct: proximityPct } = config;
  if (bars.length < lookback + 1) {
    return unavailable(`need ${lookback} prior trading sessions, only ${Math.max(0, bars.length - 1)} available`);
  }
  const latest = bars[bars.length - 1];
  const window = bars.slice(bars.length - 1 - lookback, bars.length - 1);

  let resistanceBar = window[0];
  for (const b of window) {
    if (b.high > resistanceBar.high) resistanceBar = b;
  }

  const distancePct = ((latest.close / resistanceBar.high) - 1) * 100;
  const isApproaching = distancePct < 0 && distancePct >= -proximityPct;

  return ok({ level: resistanceBar.high, levelDate: resistanceBar.date, distancePct, isApproaching });
}

// ---------------------------------------------------------------------------
// Consolidation: recent trading-range contraction vs. a longer baseline.
// ---------------------------------------------------------------------------

export interface ConsolidationResult {
  recentRangePct: number;
  baselineRangePct: number;
  /** recentRangePct / baselineRangePct - lower means tighter contraction. */
  contractionRatio: number;
  isConsolidating: boolean;
}

function averageDailyRangePct(bars: DailyBar[]): number {
  const pct = bars.map((b) => ((b.high - b.low) / b.close) * 100);
  return pct.reduce((a, b) => a + b, 0) / pct.length;
}

/**
 * Compares the average daily (high-low)/close range over a short recent
 * window against a longer baseline window (the baseline includes the recent
 * window, matching the common "is volatility now unusually tight relative to
 * its own recent normal" framing). A low ratio indicates a tightening range,
 * often read as a base/consolidation - this flags contraction only, it does
 * not forecast the breakout direction.
 */
export function detectConsolidation(
  bars: DailyBar[],
  config: Pick<ScreeningConfig, "consolidationLookbackSessions" | "consolidationBaselineSessions" | "consolidationContractionRatio">,
): Maybe<ConsolidationResult> {
  const { consolidationLookbackSessions: recentN, consolidationBaselineSessions: baselineN, consolidationContractionRatio: threshold } = config;
  if (bars.length < baselineN) {
    return unavailable(`need ${baselineN} trading sessions for the baseline window, only ${bars.length} available`);
  }
  const recentWindow = bars.slice(bars.length - recentN);
  const baselineWindow = bars.slice(bars.length - baselineN);

  const recentRangePct = averageDailyRangePct(recentWindow);
  const baselineRangePct = averageDailyRangePct(baselineWindow);

  if (baselineRangePct <= 0) {
    return unavailable("baseline range is zero - cannot compute a contraction ratio");
  }

  const contractionRatio = recentRangePct / baselineRangePct;
  return ok({ recentRangePct, baselineRangePct, contractionRatio, isConsolidating: contractionRatio <= threshold });
}

// ---------------------------------------------------------------------------
// Triangle: swing-pivot trendlines over a lookback window.
// ---------------------------------------------------------------------------

export type TriangleType = "ascending" | "descending" | "symmetrical" | "none";

export interface TriangleResult {
  type: TriangleType;
  /** Fitted trendline slope through swing highs/lows, in % of latest price per session. */
  highSlopePctPerSession: number;
  lowSlopePctPerSession: number;
  swingHighCount: number;
  swingLowCount: number;
  detected: boolean;
}

interface Pivot {
  index: number;
  date: string;
  value: number;
}

/** A local swing high: strictly the highest `high` within +/- spacing bars of itself. */
function findSwingHighs(bars: DailyBar[], spacing: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = spacing; i < bars.length - spacing; i++) {
    const candidate = bars[i].high;
    let isMax = true;
    for (let j = i - spacing; j <= i + spacing; j++) {
      if (j === i) continue;
      if (bars[j].high > candidate) {
        isMax = false;
        break;
      }
    }
    if (isMax) pivots.push({ index: i, date: bars[i].date, value: candidate });
  }
  return pivots;
}

/** A local swing low: strictly the lowest `low` within +/- spacing bars of itself. */
function findSwingLows(bars: DailyBar[], spacing: number): Pivot[] {
  const pivots: Pivot[] = [];
  for (let i = spacing; i < bars.length - spacing; i++) {
    const candidate = bars[i].low;
    let isMin = true;
    for (let j = i - spacing; j <= i + spacing; j++) {
      if (j === i) continue;
      if (bars[j].low < candidate) {
        isMin = false;
        break;
      }
    }
    if (isMin) pivots.push({ index: i, date: bars[i].date, value: candidate });
  }
  return pivots;
}

/** Ordinary least-squares slope of y against x. */
function regressionSlope(points: Array<{ x: number; y: number }>): number {
  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * Finds swing-high and swing-low pivots in the trailing lookback window,
 * fits a straight trendline through each set via linear regression, and
 * classifies the pair of slopes as a simplified ascending/descending/
 * symmetrical triangle (converging highs/lows) or "none".
 *
 * This is a simplified heuristic, not a validated chart-pattern recognizer:
 * it only checks trendline slope direction and "flatness", not touch count,
 * volume confirmation, or the quality of the fit (R^2). Treat `detected` as
 * "the recent price structure resembles this simple definition", not as a
 * forecast of a breakout or its direction.
 */
export function detectTriangle(
  bars: DailyBar[],
  config: Pick<ScreeningConfig, "triangleLookbackSessions" | "trianglePivotSpacing" | "triangleMinPivots" | "triangleFlatSlopePctPerSession">,
): Maybe<TriangleResult> {
  const { triangleLookbackSessions: lookback, trianglePivotSpacing: spacing, triangleMinPivots: minPivots, triangleFlatSlopePctPerSession: flatThreshold } = config;

  if (bars.length < lookback) {
    return unavailable(`need ${lookback} trading sessions, only ${bars.length} available`);
  }
  const window = bars.slice(bars.length - lookback);
  const highs = findSwingHighs(window, spacing);
  const lows = findSwingLows(window, spacing);

  if (highs.length < minPivots || lows.length < minPivots) {
    return unavailable(
      `need at least ${minPivots} swing highs and swing lows in the trailing ${lookback} sessions (spacing ${spacing}); found ${highs.length} highs, ${lows.length} lows`,
    );
  }

  const latestPrice = window[window.length - 1].close;
  const highSlopeAbs = regressionSlope(highs.map((p) => ({ x: p.index, y: p.value })));
  const lowSlopeAbs = regressionSlope(lows.map((p) => ({ x: p.index, y: p.value })));
  const highSlopePctPerSession = (highSlopeAbs / latestPrice) * 100;
  const lowSlopePctPerSession = (lowSlopeAbs / latestPrice) * 100;

  const highsFalling = highSlopePctPerSession < -flatThreshold;
  const highsFlat = Math.abs(highSlopePctPerSession) <= flatThreshold;
  const lowsRising = lowSlopePctPerSession > flatThreshold;
  const lowsFlat = Math.abs(lowSlopePctPerSession) <= flatThreshold;

  let type: TriangleType = "none";
  if (highsFalling && lowsRising) type = "symmetrical";
  else if (highsFlat && lowsRising) type = "ascending";
  else if (highsFalling && lowsFlat) type = "descending";

  return ok({
    type,
    highSlopePctPerSession,
    lowSlopePctPerSession,
    swingHighCount: highs.length,
    swingLowCount: lows.length,
    detected: type !== "none",
  });
}
