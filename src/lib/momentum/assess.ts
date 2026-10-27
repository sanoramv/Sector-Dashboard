import type { ComponentScore, EvidenceAssessment, EvidenceCategory, MomentumCandidate } from "../../types/momentum";
import { MOMENTUM_RULES, insufficientEvidenceReasons } from "./classify";

/**
 * Evidence assessment: an explainable, rule-based score per dimension, then
 * one of four categories. Every point is relative to TODAY's direction -
 * positive supports the move continuing (up for a gainer, down for a loser),
 * negative supports a pause or reversal. For a loser, "continuation" is
 * downside continuation and "exhaustion-reversal" is rebound risk; a loser is
 * never assumed to keep falling, nor to be a bargain.
 *
 * Thresholds reuse MOMENTUM_RULES (fixed before any outcome was examined) plus
 * the constants below, chosen the same way. The total is an evidence tally,
 * not a probability; the historical evaluation reports how each category
 * actually did.
 */
export const ASSESSMENT_RULES = {
  /** An adverse wick (upper for gainers, lower for losers) this large a share of the range shows rejection. */
  adverseWickShare: 0.4,
  /** A multi-session move this large over 10 sessions, in today's direction... */
  multiSessionRunPct: 15,
  /** ...after participation was already fading (3-session volume below this x the earlier 20-session mean) suggests exhaustion. */
  fadingParticipation: 0.8,
  /** Continuation needs a total of at least this many points with confirmed structure and volume. */
  continuationMinTotal: 3,
} as const;

type Inputs = Pick<MomentumCandidate, "group" | "price" | "patterns" | "activity" | "context" | "quality">;

const v = <T>(m: { available: true; value: T } | { available: false }): T | null => (m.available ? m.value : null);
const f1 = (n: number) => n.toFixed(1);
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

function component(dimension: ComponentScore["dimension"], min: number, max: number, parts: Array<[number, string]>, available: boolean): ComponentScore {
  if (!available) return { dimension, score: null, min, max, reasons: [] };
  const score = clamp(
    parts.reduce((a, [p]) => a + p, 0),
    min,
    max,
  );
  return { dimension, score, min, max, reasons: parts.map(([p, r]) => `${p > 0 ? "+" : ""}${p} ${r}`) };
}

export function assessEvidence(c: Inputs): EvidenceAssessment {
  const R = MOMENTUM_RULES;
  const A = ASSESSMENT_RULES;
  const up = c.group === "gainer";
  const dir = up ? 1 : -1;
  const missing: string[] = [];

  // Price structure: where it closed, rejection wicks, and whether a key level was closed through.
  const ps: Array<[number, string]> = [];
  const cl = c.price.closeLocation;
  if (cl !== null) {
    const towardMove = up ? cl : 1 - cl;
    if (towardMove >= R.strongCloseLocation) ps.push([1, `closed at ${Math.round(cl * 100)}% of the range, near the day's ${up ? "high" : "low"}`]);
    else if (towardMove < R.fadeCloseLocation) ps.push([-1, `closed at ${Math.round(cl * 100)}% of the range, giving back much of the move`]);
    const wick = up ? c.price.upperWickShare : c.price.lowerWickShare;
    if (wick !== null && wick >= A.adverseWickShare) ps.push([-1, `${up ? "upper" : "lower"} wick is ${Math.round(wick * 100)}% of the range (intraday rejection)`]);
  } else missing.push("intraday range");
  if (up && c.patterns.breakoutToday === true) ps.push([1, "closed above the prior 60-session high (breakout confirmed by the close)"]);
  if (up && c.patterns.failedBreakoutToday === true) ps.push([-1, "traded above the prior 60-session high but closed back below it"]);
  if (!up && c.patterns.breakdownToday === true) ps.push([1, "closed below the prior 60-session low (breakdown confirmed by the close)"]);
  const priceStructure = component("price-structure", -2, 2, ps, cl !== null);

  // Volume: participation behind the move.
  const rvol = v(c.activity.relativeVolume);
  const vol: Array<[number, string]> = [];
  if (rvol !== null) {
    if (rvol >= R.volumeConfirmRvol) vol.push([1, `volume ${f1(rvol)}x its 20-session average (meaningful participation)`]);
    else if (rvol < R.lightVolumeRvol) vol.push([-1, `volume only ${f1(rvol)}x its 20-session average (move on light volume)`]);
  } else missing.push("relative volume");
  const volume = component("volume", -1, 1, vol, rvol !== null);

  // Relative strength and sector: is the stock leading, and is its sector behind it?
  const rsParts: Array<[number, string]> = [];
  const rs = v(c.context.relativeStrength1m);
  if (rs !== null && rs !== 0) rsParts.push([Math.sign(rs) === dir ? 1 : -1, `1-month return ${rs > 0 ? "+" : ""}${f1(rs)}pp vs NIFTY 500`]);
  else if (rs === null) missing.push("1-month relative strength");
  const sector = c.context.sectorIndex;
  const sectorRs = sector ? v(sector.relativeStrength1m) : null;
  if (sector && sectorRs !== null && sectorRs !== 0) rsParts.push([Math.sign(sectorRs) === dir ? 1 : -1, `${sector.displayName} 1-month ${sectorRs > 0 ? "+" : ""}${f1(sectorRs)}pp vs NIFTY 500`]);
  else if (c.context.moveScope === "sector-wide") rsParts.push([1, `industry peers moved the same way today (median ${f1(c.context.peerMedianChangePct ?? 0)}%)`]);
  const relativeStrength = component("relative-strength", -2, 2, rsParts, rs !== null);

  // Market: broad direction today and the regime.
  const mk: Array<[number, string]> = [];
  const n500 = v(c.context.benchmarkChangePct);
  const n50 = c.context.nifty50 ? v(c.context.nifty50.changePct) : null;
  if (n500 !== null && Math.abs(n500) >= 0.5 && (n50 === null || Math.sign(n50) === Math.sign(n500))) {
    mk.push([Math.sign(n500) === dir ? 1 : -1, `NIFTY 500 ${n500 > 0 ? "+" : ""}${n500.toFixed(2)}%${n50 !== null ? `, NIFTY 50 ${n50 > 0 ? "+" : ""}${n50.toFixed(2)}%` : ""} today`]);
  }
  const regime = c.context.marketRegime;
  if (regime === "bullish" || regime === "bearish") mk.push([(regime === "bullish") === up ? 1 : -1, `market regime ${regime}`]);
  if (regime === "insufficient-data") missing.push("market regime");
  const market = component("market", -2, 2, mk, true);

  // Extension: signs the move is stretched or tiring. Can only subtract.
  const ex: Array<[number, string]> = [];
  const d20 = v(c.price.distSma20Pct);
  const r5 = v(c.price.r5);
  const r10 = v(c.price.r10);
  if ((d20 !== null && d20 * dir >= R.extendedFromSma20Pct) || (r5 !== null && r5 * dir >= R.extended5dPct)) {
    ex.push([-2, `stretched: ${d20 !== null ? `${f1(d20)}% from the 20-day average` : ""}${d20 !== null && r5 !== null ? ", " : ""}${r5 !== null ? `${f1(r5)}% over 5 sessions` : ""}`]);
  }
  const z = v(c.price.moveZ);
  if (z !== null && Math.abs(z) >= R.abnormalMoveZ) ex.push([-1, `today's move is ${f1(Math.abs(z))} standard deviations of its recent daily changes`]);
  const prior = v(c.activity.priorParticipation);
  if (r10 !== null && r10 * dir >= A.multiSessionRunPct && prior !== null && prior < A.fadingParticipation) {
    ex.push([-1, `${f1(Math.abs(r10))}% over 10 sessions while volume in the 3 sessions before today was only ${prior.toFixed(2)}x its earlier average (fading participation)`]);
  }
  const extension = component("extension", -3, 0, ex, true);

  const components = [priceStructure, volume, relativeStrength, market, extension];
  const total = components.reduce((a, x) => a + (x.score ?? 0), 0);

  let category: EvidenceCategory;
  let rationale: string;
  const gates = insufficientEvidenceReasons(c);
  if (gates.length > 0) {
    category = "insufficient";
    rationale = `Insufficient evidence: ${gates.join("; ")}.`;
  } else if ((extension.score as number) <= -2 || (priceStructure.score as number) <= -2 || ((extension.score as number) <= -1 && total <= 0)) {
    category = "exhaustion-reversal";
    rationale = `${up ? "Exhaustion/reversal" : "Rebound/reversal"} risk: ${(extension.score as number) <= -2 ? "the move is stretched" : (priceStructure.score as number) <= -2 ? "the price structure shows rejection" : "warning signs outweigh the supporting evidence"}.`;
  } else if (total >= A.continuationMinTotal && (priceStructure.score as number) >= 1 && (volume.score as number) >= 1) {
    category = "continuation";
    rationale = `${up ? "Continuation" : "Downside-continuation"} characteristics: a close confirming the move on meaningful volume, with ${total} net points of supporting evidence.`;
  } else {
    category = "mixed";
    rationale = "Mixed evidence: supporting and opposing indicators conflict, or the move is not confirmed by both the close and volume.";
  }
  return { category, components, total, missingEvidence: missing, rationale };
}

export const CATEGORY_TEXT: Record<"gainer" | "loser", Record<EvidenceCategory, string>> = {
  gainer: {
    continuation: "Continuation characteristics",
    mixed: "Mixed evidence",
    "exhaustion-reversal": "Exhaustion/reversal risk",
    insufficient: "Insufficient evidence",
  },
  loser: {
    continuation: "Downside-continuation characteristics",
    mixed: "Mixed evidence",
    "exhaustion-reversal": "Rebound/reversal risk",
    insufficient: "Insufficient evidence",
  },
};
