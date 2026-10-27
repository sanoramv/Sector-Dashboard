import type { DiscoveryGroup, MomentumCandidate, MomentumFactor, MomentumLabel } from "../../types/momentum";

/**
 * Research classification rules for the Next-Day Momentum page.
 *
 * These thresholds were fixed BEFORE any next-session outcome in this
 * dataset was examined, from widely used technical-analysis conventions
 * (close in the top 30% of the range, 1.5x average volume, 15% above the
 * 20-day average as "extended", etc.). They are not optimised; the
 * historical evaluation reports how they actually did, including when they
 * did no better than the baseline. Changing them after looking at that
 * evaluation would turn it into an in-sample fit.
 *
 * A label describes OBSERVED CONDITIONS. It is not an instruction to trade,
 * and the factor counts are not a probability.
 */
export const MOMENTUM_RULES = {
  strongCloseLocation: 0.7,
  weakCloseLocation: 0.3,
  /** A gainer closing below the middle of its range gave back much of the day's gain. */
  fadeCloseLocation: 0.5,
  /** A loser closing above this recovered well off its low. */
  reversalCloseLocation: 0.6,
  volumeConfirmRvol: 1.5,
  lightVolumeRvol: 1.0,
  extendedFromSma20Pct: 15,
  extended5dPct: 20,
  abnormalMoveZ: 3,
  sectorWideMinPeerMovePct: 1,
  gapPct: 2,
  /** Fewer comparable bars than this (e.g. a recent listing or corporate-action break) -> insufficient evidence. */
  minBarsForEvidence: 50,
} as const;

export const LABEL_TEXT: Record<MomentumLabel, string> = {
  "momentum-continuation": "Momentum continuation candidate",
  "possible-breakout": "Possible breakout setup",
  "possible-reversal": "Possible reversal",
  "extended-reversal-risk": "Extended — reversal risk",
  "weak-momentum": "Weak momentum",
  "mixed-signals": "Mixed signals",
  "insufficient-evidence": "Insufficient evidence",
};

export const LABEL_DEFINITION: Record<MomentumLabel, string> = {
  "momentum-continuation":
    "Gainer that closed in the top 30% of its range on at least 1.5x its 20-day average volume, above its own 50-day average and outperforming NIFTY 500 over the past month, without being extended.",
  "possible-breakout":
    "Gainer that closed above its prior 60-session high (resistance) in the top 30% of its range on at least 1.5x average volume, without being extended.",
  "possible-reversal":
    "Loser that recovered to close in the top 40% of its range on at least 1.5x average volume while still above its own 200-day average.",
  "extended-reversal-risk":
    "Move stretched far from its recent average: at least 15% from the 20-day average or 20% over 5 sessions, in the direction of today's move. Sharp extensions are often followed by pullbacks or pauses.",
  "weak-momentum":
    "Gainer: closed in the bottom half of its range or on below-average volume. Loser: closed in the bottom 30% of its range below its 50-day average (continuing weakness).",
  "mixed-signals": "None of the rules above matched - the evidence points both ways.",
  "insufficient-evidence":
    "Fewer than 50 comparable sessions (new listing or a recent price discontinuity), no volume baseline, or no intraday range - not enough data to classify.",
};

type Inputs = Pick<MomentumCandidate, "group" | "price" | "patterns" | "activity" | "context" | "quality">;

const v = <T>(m: { available: true; value: T } | { available: false }): T | null => (m.available ? m.value : null);
const f1 = (n: number) => n.toFixed(1);
const f2 = (n: number) => n.toFixed(2);

export function insufficientEvidenceReasons(c: Inputs): string[] {
  const reasons: string[] = [];
  if (c.quality.barsUsed < MOMENTUM_RULES.minBarsForEvidence) {
    reasons.push(`only ${c.quality.barsUsed} comparable sessions (need ${MOMENTUM_RULES.minBarsForEvidence})`);
  }
  if (!c.activity.relativeVolume.available) reasons.push(`relative volume unavailable: ${c.activity.relativeVolume.reason}`);
  if (c.price.closeLocation === null) reasons.push("no intraday range (high equals low), so the close location is undefined");
  return reasons;
}

export function classify(c: Inputs): MomentumLabel {
  if (insufficientEvidenceReasons(c).length > 0) return "insufficient-evidence";
  const R = MOMENTUM_RULES;
  const cl = c.price.closeLocation as number;
  const rvol = v(c.activity.relativeVolume) as number;
  const d20 = v(c.price.distSma20Pct);
  const r5 = v(c.price.r5);
  const above50 = v(c.price.distSma50Pct);
  const above200 = v(c.price.distSma200Pct);
  const rs = v(c.context.relativeStrength1m);

  if (c.group === "gainer") {
    const extended = (d20 !== null && d20 >= R.extendedFromSma20Pct) || (r5 !== null && r5 >= R.extended5dPct);
    if (extended) return "extended-reversal-risk";
    if (cl < R.fadeCloseLocation || rvol < R.lightVolumeRvol) return "weak-momentum";
    const strongDay = cl >= R.strongCloseLocation && rvol >= R.volumeConfirmRvol;
    if (strongDay && c.patterns.breakoutToday === true) return "possible-breakout";
    if (strongDay && above50 !== null && above50 > 0 && rs !== null && rs > 0) return "momentum-continuation";
    return "mixed-signals";
  }

  const extendedDown = (d20 !== null && d20 <= -R.extendedFromSma20Pct) || (r5 !== null && r5 <= -R.extended5dPct);
  if (extendedDown) return "extended-reversal-risk";
  if (cl >= R.reversalCloseLocation && rvol >= R.volumeConfirmRvol && above200 !== null && above200 > 0) return "possible-reversal";
  if (cl <= R.weakCloseLocation && above50 !== null && above50 < 0) return "weak-momentum";
  return "mixed-signals";
}

/**
 * Evidence on both sides, written out with the numbers behind it.
 * "Continuation" means continuation of TODAY's direction: up for a gainer,
 * down for a loser. Each list is independent of the label; a count of
 * factors is not a probability.
 */
export function explainFactors(c: Inputs): { continuation: MomentumFactor[]; reversal: MomentumFactor[] } {
  const R = MOMENTUM_RULES;
  const up = c.group === "gainer";
  const cont: MomentumFactor[] = [];
  const rev: MomentumFactor[] = [];
  const add = (side: MomentumFactor[], id: string, text: string) => side.push({ id, text });

  const cl = c.price.closeLocation;
  if (cl !== null) {
    const pctOfRange = `${Math.round(cl * 100)}% of the day's range`;
    if (up ? cl >= R.strongCloseLocation : cl <= R.weakCloseLocation) add(cont, "close-location", `Closed near the day's ${up ? "high" : "low"} (at ${pctOfRange}).`);
    if (up ? cl < R.fadeCloseLocation : cl >= R.reversalCloseLocation) add(rev, "close-location", `Closed ${up ? "in the lower half" : "well off the low"} of the day's range (at ${pctOfRange}) - ${up ? "sellers absorbed part of the gain" : "buyers absorbed part of the fall"}.`);
  }

  const rvol = v(c.activity.relativeVolume);
  if (rvol !== null) {
    if (rvol >= R.volumeConfirmRvol) add(cont, "volume", `Volume ${f1(rvol)}x the 20-day average - the move had broad participation (high volume shows activity, not whether buyers or sellers initiated it).`);
    if (rvol < R.lightVolumeRvol) add(rev, "volume", `Volume only ${f1(rvol)}x the 20-day average - the move was not confirmed by participation.`);
  }

  const d50 = v(c.price.distSma50Pct);
  const d200 = v(c.price.distSma200Pct);
  if (d50 !== null && d200 !== null) {
    if (up ? d50 > 0 && d200 > 0 : d50 < 0 && d200 < 0) add(cont, "trend", `${up ? "Above" : "Below"} both its 50-day (${f1(d50)}%) and 200-day (${f1(d200)}%) averages - today's move is with the prevailing trend.`);
    if (up ? d200 < 0 : d200 > 0) add(rev, "trend", `${up ? "Below" : "Above"} its 200-day average (${f1(d200)}%) - today's move is against the longer-term trend.`);
  }

  const rs = v(c.context.relativeStrength1m);
  if (rs !== null) {
    if (up ? rs > 0 : rs < 0) add(cont, "relative-strength", `${up ? "Outperformed" : "Underperformed"} NIFTY 500 by ${f1(Math.abs(rs))}pp over the past month.`);
    else if (rs !== 0) add(rev, "relative-strength", `${up ? "Underperformed" : "Outperformed"} NIFTY 500 by ${f1(Math.abs(rs))}pp over the past month - today's move goes against its recent relative trend.`);
  }

  if (c.context.moveScope === "sector-wide" && c.context.peerMedianChangePct !== null) {
    add(cont, "sector", `Industry peers moved the same way (median ${f2(c.context.peerMedianChangePct)}% across ${c.context.peerCount} peers) - part of a broader ${c.context.industry} move.`);
  }

  const bench = v(c.context.benchmarkChangePct);
  if (bench !== null && Math.abs(bench) >= 0.5) {
    if (up === bench > 0) add(cont, "market", `NIFTY 500 moved the same direction (${f2(bench)}%).`);
    else add(rev, "market", `NIFTY 500 moved the opposite way (${f2(bench)}%) - the stock moved against the market.`);
  }
  const regime = c.context.marketRegime;
  if (regime === (up ? "bullish" : "bearish")) add(cont, "regime", `Market regime is ${regime}.`);
  if (regime === (up ? "bearish" : "bullish")) add(rev, "regime", `Market regime is ${regime}, opposite to the move.`);

  const d20 = v(c.price.distSma20Pct);
  const r5 = v(c.price.r5);
  if (d20 !== null && (up ? d20 >= R.extendedFromSma20Pct : d20 <= -R.extendedFromSma20Pct)) add(rev, "extended-sma20", `${f1(Math.abs(d20))}% ${up ? "above" : "below"} its 20-day average - stretched.`);
  if (r5 !== null && (up ? r5 >= R.extended5dPct : r5 <= -R.extended5dPct)) add(rev, "extended-5d", `${up ? "Up" : "Down"} ${f1(Math.abs(r5))}% over 5 sessions - stretched.`);
  const z = v(c.price.moveZ);
  if (z !== null && Math.abs(z) >= R.abnormalMoveZ) add(rev, "abnormal-move", `Today's move is ${f1(Math.abs(z))} standard deviations of its recent daily changes - unusually large for this stock.`);

  if (up && c.patterns.breakoutToday && c.patterns.resistance.available) {
    add(cont, "breakout", `Closed above its prior ${c.patterns.resistance.value.levelDate} swing high of ${f2(c.patterns.resistance.value.level)}.`);
  }
  if (up && c.patterns.failedBreakoutToday && c.patterns.resistance.available) {
    add(rev, "failed-breakout", `Traded above the prior high of ${f2(c.patterns.resistance.value.level)} but closed back below it (failed breakout).`);
  }
  if (c.patterns.retest) add(up ? cont : rev, "retest", `Pulled back to the ${f2(c.patterns.retest.level)} level it broke out above on ${c.patterns.retest.breakoutDate} and closed above it (retest held).`);
  const dist52 = v(c.price.distanceFrom52wHigh);
  if (up && dist52 !== null && dist52 >= -5) add(cont, "near-52w-high", `Within ${f1(Math.abs(dist52))}% of its 52-week high.`);
  if (up && c.patterns.triangleBefore.available && c.patterns.triangleBefore.value.detected) {
    add(cont, "triangle", `A confirmed ${c.patterns.triangleBefore.value.type} triangle had formed before today's move.`);
  }
  if (up && c.patterns.consolidationBefore.available && c.patterns.consolidationBefore.value.isConsolidating) {
    add(cont, "consolidation", `Moved out of a tight range (recent range ${f2(c.patterns.consolidationBefore.value.contractionRatio)}x its 60-session norm).`);
  }

  const gap = c.price.gapPct;
  if (Math.abs(gap) >= R.gapPct && Math.sign(gap) === (up ? 1 : -1)) {
    const oc = c.price.openToClosePct;
    if (up ? oc > 0 : oc < 0) add(cont, "gap", `Gapped ${up ? "up" : "down"} ${f1(Math.abs(gap))}% and extended the move after the open.`);
    else add(rev, "gap", `Gapped ${up ? "up" : "down"} ${f1(Math.abs(gap))}% but the price moved back toward the previous close after the open (gap partly faded).`);
  }

  return { continuation: cont, reversal: rev };
}

export function lowConfidenceReasons(c: Inputs, group: DiscoveryGroup): string[] {
  const reasons = [...insufficientEvidenceReasons(c)];
  reasons.push(...c.activity.liquidityWarnings);
  reasons.push(...c.quality.notes);
  if (c.context.marketRegime === "insufficient-data") reasons.push("Market regime could not be classified on this date.");
  if (c.context.moveScope === "unknown") reasons.push(`Too few industry peers in the universe to judge whether the move was stock-specific or sector-wide.`);
  if (group === "loser" && c.price.dailyChangePct <= -15) {
    reasons.push("A fall this large can include an unadjusted corporate action that did not meet the detection thresholds; check exchange filings.");
  }
  return reasons;
}
