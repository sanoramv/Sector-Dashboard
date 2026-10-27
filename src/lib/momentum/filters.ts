import type { MomentumCandidate, MomentumLabel, SizeSegment } from "../../types/momentum";

export interface MomentumFilters {
  minAbsChangePct: number;
  /** 0 = any. */
  minRelativeVolume: number;
  industry: string | "all";
  segment: SizeSegment | "all";
  /** Hide thinly traded and trade-for-trade stocks. */
  liquidOnly: boolean;
  /** Maximum distance BELOW the prior resistance level, %; null = any. Stocks already above it pass. */
  maxBelowResistancePct: number | null;
  pattern: "any" | "breakout-today" | "near-52w-high" | "consolidation-before" | "triangle-before" | "retest";
  label: MomentumLabel | "all";
}

export const DEFAULT_FILTERS: MomentumFilters = {
  minAbsChangePct: 0,
  minRelativeVolume: 0,
  industry: "all",
  segment: "all",
  liquidOnly: false,
  maxBelowResistancePct: null,
  pattern: "any",
  label: "all",
};

export function matchesFilters(c: MomentumCandidate, f: MomentumFilters): boolean {
  if (Math.abs(c.price.dailyChangePct) < f.minAbsChangePct) return false;
  if (f.minRelativeVolume > 0 && !(c.activity.relativeVolume.available && c.activity.relativeVolume.value >= f.minRelativeVolume)) return false;
  if (f.industry !== "all" && c.industry !== f.industry) return false;
  if (f.segment !== "all" && c.segment !== f.segment) return false;
  if (f.liquidOnly && (c.activity.liquidityWarnings.length > 0 || !c.activity.medianTurnover20Cr.available)) return false;
  if (f.maxBelowResistancePct !== null) {
    const r = c.patterns.resistance;
    if (!r.available || r.value.distancePct < -f.maxBelowResistancePct) return false;
  }
  switch (f.pattern) {
    case "breakout-today":
      if (c.patterns.breakoutToday !== true) return false;
      break;
    case "near-52w-high":
      if (!(c.price.distanceFrom52wHigh.available && c.price.distanceFrom52wHigh.value >= -5)) return false;
      break;
    case "consolidation-before":
      if (!(c.patterns.consolidationBefore.available && c.patterns.consolidationBefore.value.isConsolidating)) return false;
      break;
    case "triangle-before":
      if (!(c.patterns.triangleBefore.available && c.patterns.triangleBefore.value.detected)) return false;
      break;
    case "retest":
      if (!c.patterns.retest) return false;
      break;
  }
  if (f.label !== "all" && c.label !== f.label) return false;
  return true;
}

export type SortKey = "change" | "rvol" | "closeLocation" | "turnover" | "dist52w" | "resistance" | "vsPeers" | "continuation" | "reversal" | "symbol";

export function sortValue(c: MomentumCandidate, key: SortKey): number | string | null {
  switch (key) {
    case "change":
      return c.price.dailyChangePct;
    case "rvol":
      return c.activity.relativeVolume.available ? c.activity.relativeVolume.value : null;
    case "closeLocation":
      return c.price.closeLocation;
    case "turnover":
      return c.activity.turnoverCr;
    case "dist52w":
      return c.price.distanceFrom52wHigh.available ? c.price.distanceFrom52wHigh.value : null;
    case "resistance":
      return c.patterns.resistance.available ? c.patterns.resistance.value.distancePct : null;
    case "vsPeers":
      return c.context.stockVsPeersPp;
    case "continuation":
      return c.continuationFactors.length;
    case "reversal":
      return c.reversalFactors.length;
    case "symbol":
      return c.symbol;
  }
}

/** Sorts a copy; unavailable values always go last, whatever the direction. */
export function sortCandidates(list: MomentumCandidate[], key: SortKey, dir: "asc" | "desc"): MomentumCandidate[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.rank - b.rank;
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "string" || typeof vb === "string" ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
    return cmp * sign || a.rank - b.rank;
  });
}
