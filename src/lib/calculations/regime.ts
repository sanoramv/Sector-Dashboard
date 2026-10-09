import type { Maybe, RegimeAssessment } from "../../types/metrics";
import type { RegimeConfig } from "../../types/config";

export interface RegimeInput {
  return1m: Maybe<number>;
  return3m: Maybe<number>;
  return6m: Maybe<number>;
  relativePerformance3m: Maybe<number>;
  breadth20: Maybe<number>;
  breadth50: Maybe<number>;
  breadth200: Maybe<number>;
}

/**
 * Rules-based bullish/bearish/sideways classification, per the product spec:
 *
 * Bullish: 1M & 3M returns positive, 3M relative performance positive, and at
 * least 2 of the 3 available breadth measures are above threshold (any 2-of-3
 * subset of {20,50,200} necessarily includes the 20- or 50-DMA measure, since
 * only one measure - 200DMA - could ever be excluded from a pair).
 * Bearish is the mirror image. Everything else observed is "sideways/mixed".
 *
 * Never silently classifies missing required data as sideways: if 1M, 3M or
 * 3M relative performance is unavailable, or fewer breadth measures are
 * available than `config.minBreadthMeasuresRequired`, the result is
 * "insufficient-data" instead.
 */
export function computeRegime(input: RegimeInput, config: RegimeConfig): RegimeAssessment {
  const missingRequired: string[] = [];
  if (!input.return1m.available) missingRequired.push("1M return");
  if (!input.return3m.available) missingRequired.push("3M return");
  if (!input.relativePerformance3m.available) missingRequired.push("3M relative performance vs NIFTY 500");

  const breadthEntries = [
    { label: "20-DMA breadth", metric: input.breadth20 },
    { label: "50-DMA breadth", metric: input.breadth50 },
    { label: "200-DMA breadth", metric: input.breadth200 },
  ];
  const availableBreadth = breadthEntries.filter((b) => b.metric.available) as Array<{
    label: string;
    metric: { available: true; value: number };
  }>;

  if (missingRequired.length > 0 || availableBreadth.length < config.minBreadthMeasuresRequired) {
    const reasons = [...missingRequired.map((m) => `${m} is unavailable.`)];
    if (availableBreadth.length < config.minBreadthMeasuresRequired) {
      reasons.push(
        `Only ${availableBreadth.length} of 3 breadth measures are available; at least ${config.minBreadthMeasuresRequired} are required to classify.`,
      );
    }
    return {
      regime: "insufficient-data",
      reasons,
      shortVsLongConflict: false,
      confidence: "low",
      confidenceReasons: ["Required inputs are missing, so no confidence assessment applies."],
    };
  }

  const m1 = (input.return1m as { available: true; value: number }).value;
  const m3 = (input.return3m as { available: true; value: number }).value;
  const rs3m = (input.relativePerformance3m as { available: true; value: number }).value;

  const aboveCount = availableBreadth.filter((b) => b.metric.value > config.breadthThresholdPct).length;
  const belowCount = availableBreadth.filter((b) => b.metric.value < config.breadthThresholdPct).length;

  const isBullish = m1 > 0 && m3 > 0 && rs3m > 0 && aboveCount >= 2;
  const isBearish = m1 < 0 && m3 < 0 && rs3m < 0 && belowCount >= 2;

  const reasons: string[] = [
    `1M return is ${m1 > 0 ? "positive" : m1 < 0 ? "negative" : "flat"} (${m1.toFixed(2)}%).`,
    `3M return is ${m3 > 0 ? "positive" : m3 < 0 ? "negative" : "flat"} (${m3.toFixed(2)}%).`,
    `3M relative performance vs NIFTY 500 is ${rs3m > 0 ? "positive" : rs3m < 0 ? "negative" : "flat"} (${rs3m.toFixed(2)} pp).`,
    `${aboveCount} of ${availableBreadth.length} available breadth measures are above ${config.breadthThresholdPct}%, ${belowCount} are below.`,
  ];

  const regime = isBullish ? "bullish" : isBearish ? "bearish" : "sideways";

  const shortVsLongConflict =
    input.return6m.available && ((m1 > 0 && input.return6m.value < 0) || (m1 < 0 && input.return6m.value > 0));
  if (shortVsLongConflict) {
    reasons.push(
      `1M trend (${m1 > 0 ? "up" : "down"}) disagrees with the 6M trend (${(input.return6m as { available: true; value: number }).value > 0 ? "up" : "down"}).`,
    );
  } else if (!input.return6m.available) {
    reasons.push("6M return is unavailable, so short-vs-long agreement could not be checked.");
  }

  // Confidence: a heuristic based on data completeness and signal agreement,
  // not a statistically calibrated probability.
  const confidenceReasons: string[] = [];
  let score = 0;
  const maxScore = 3;

  if (input.return6m.available) {
    score += 1;
  } else {
    confidenceReasons.push("6M return was unavailable.");
  }

  if (!shortVsLongConflict) {
    score += 1;
  } else {
    confidenceReasons.push("Short-term (1M) and long-term (6M) trends disagree.");
  }

  if (availableBreadth.length === 3) {
    score += 1;
  } else {
    confidenceReasons.push(`Only ${availableBreadth.length} of 3 breadth measures were available.`);
  }

  const confidence: RegimeAssessment["confidence"] = score === maxScore ? "high" : score >= 2 ? "medium" : "low";
  if (confidenceReasons.length === 0) {
    confidenceReasons.push("All required metrics were available and in agreement.");
  }

  return { regime, reasons, shortVsLongConflict: Boolean(shortVsLongConflict), confidence, confidenceReasons };
}
