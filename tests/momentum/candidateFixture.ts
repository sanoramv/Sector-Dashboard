import { ok, unavailable } from "../../src/types/metrics";
import type { MomentumCandidate } from "../../src/types/momentum";

/** A clean, well-supported gainer's inputs; each test overrides only what it is about. */
export type Inputs = Pick<MomentumCandidate, "group" | "price" | "patterns" | "activity" | "context" | "quality">;

/** A clean, well-supported gainer; each test changes only what it is about. */
export function base(over: { group?: "gainer" | "loser"; price?: Partial<Inputs["price"]>; patterns?: Partial<Inputs["patterns"]>; activity?: Partial<Inputs["activity"]>; context?: Partial<Inputs["context"]>; quality?: Partial<Inputs["quality"]> } = {}): Inputs {
  return {
    group: over.group ?? "gainer",
    price: {
      close: 108,
      prevClose: 100,
      dailyChangePct: 8,
      openToClosePct: 5,
      gapPct: 1,
      closeLocation: 0.85,
      rangePct: 9,
      bodyShare: 0.33,
      upperWickShare: 0.22,
      lowerWickShare: 0.11,
      r3: ok(9),
      r5: ok(10),
      r10: ok(11),
      r20: ok(12),
      volatility20: ok(2),
      moveZ: ok(2),
      distSma20Pct: ok(8),
      distSma50Pct: ok(10),
      distSma200Pct: ok(15),
      distanceFrom52wHigh: ok(-3),
      distFromSwingHigh20Pct: ok(-1),
      ...over.price,
    },
    patterns: {
      resistance: ok({ level: 110, levelDate: "2026-09-01", distancePct: -1.8, isApproaching: true }),
      breakoutToday: false,
      breakdownToday: false,
      failedBreakoutToday: false,
      retest: null,
      consolidationBefore: unavailable("n/a"),
      triangleBefore: unavailable("n/a"),
      ...over.patterns,
    },
    activity: {
      available: true,
      unavailableReason: null,
      volume: 300_000,
      relativeVolume: ok(2.5),
      turnoverCr: 30,
      medianTurnover20Cr: ok(10),
      deliveryPct: 45,
      avgDeliveryPct20: ok(40),
      series: "EQ",
      tradeForTrade: false,
      zeroVolume: false,
      priorParticipation: ok(1.1),
      liquidityWarnings: [],
      ...over.activity,
    },
    context: {
      industry: "IT",
      peerCount: 10,
      peerMedianChangePct: 0.5,
      stockVsPeersPp: 7.5,
      moveScope: "stock-specific",
      relativeStrength1m: ok(4),
      industryRelativeStrength1m: ok(1),
      benchmarkChangePct: ok(0.2),
      marketRegime: "sideways",
      nifty50: null,
      sectorIndex: null,
      stockVsSectorIndexPp: null,
      ...over.context,
    },
    quality: { status: "ok", barsUsed: 250, usableFrom: "2025-08-04", notes: [], ...over.quality },
  };
}

