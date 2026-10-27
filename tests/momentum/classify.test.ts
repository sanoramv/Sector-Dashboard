import { describe, it, expect } from "vitest";
import { ok, unavailable } from "../../src/types/metrics";
import type { MomentumCandidate } from "../../src/types/momentum";
import { classify, explainFactors, lowConfidenceReasons, MOMENTUM_RULES } from "../../src/lib/momentum/classify";

type Inputs = Pick<MomentumCandidate, "group" | "price" | "patterns" | "activity" | "context" | "quality">;

/** A clean, well-supported gainer; each test changes only what it is about. */
function base(over: { group?: "gainer" | "loser"; price?: Partial<Inputs["price"]>; patterns?: Partial<Inputs["patterns"]>; activity?: Partial<Inputs["activity"]>; context?: Partial<Inputs["context"]>; quality?: Partial<Inputs["quality"]> } = {}): Inputs {
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
      ...over.price,
    },
    patterns: {
      resistance: ok({ level: 110, levelDate: "2026-09-01", distancePct: -1.8, isApproaching: true }),
      breakoutToday: false,
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
      ...over.context,
    },
    quality: { status: "ok", barsUsed: 250, usableFrom: "2025-08-04", notes: [], ...over.quality },
  };
}

describe("research labels (pre-declared rules)", () => {
  it("gainer: strong close + volume + above 50-DMA + positive 1M RS -> momentum continuation", () => {
    expect(classify(base())).toBe("momentum-continuation");
  });

  it("gainer: the same day but closing above resistance -> possible breakout", () => {
    expect(classify(base({ patterns: { breakoutToday: true } }))).toBe("possible-breakout");
  });

  it("gainer: 15%+ above the 20-DMA or 20%+ in 5 sessions -> extended, regardless of other strength", () => {
    expect(classify(base({ price: { distSma20Pct: ok(15) } }))).toBe("extended-reversal-risk");
    expect(classify(base({ price: { r5: ok(20.5) }, patterns: { breakoutToday: true } }))).toBe("extended-reversal-risk");
  });

  it("gainer: faded close or light volume -> weak momentum", () => {
    expect(classify(base({ price: { closeLocation: 0.4 } }))).toBe("weak-momentum");
    expect(classify(base({ activity: { relativeVolume: ok(0.8) } }))).toBe("weak-momentum");
  });

  it("gainer: strong day but below its 50-DMA -> mixed signals", () => {
    expect(classify(base({ price: { distSma50Pct: ok(-2) } }))).toBe("mixed-signals");
  });

  it("loser: recovered off the low on volume above the 200-DMA -> possible reversal", () => {
    expect(classify(base({ group: "loser", price: { dailyChangePct: -6, closeLocation: 0.7, distSma20Pct: ok(-5), r5: ok(-7) } }))).toBe("possible-reversal");
  });

  it("loser: closed near the low below the 50-DMA -> weak momentum; stretched down -> extended", () => {
    expect(classify(base({ group: "loser", price: { dailyChangePct: -6, closeLocation: 0.1, distSma20Pct: ok(-6), distSma50Pct: ok(-8), r5: ok(-8) } }))).toBe("weak-momentum");
    expect(classify(base({ group: "loser", price: { dailyChangePct: -9, closeLocation: 0.1, distSma20Pct: ok(-16) } }))).toBe("extended-reversal-risk");
  });

  it("missing volume baseline, short history or no intraday range -> insufficient evidence, with reasons", () => {
    const noVol = base({ activity: { relativeVolume: unavailable("need volume for 18 of the previous 20 comparable sessions, have 3") } });
    expect(classify(noVol)).toBe("insufficient-evidence");
    expect(lowConfidenceReasons(noVol, "gainer").join(" ")).toMatch(/relative volume unavailable/);
    expect(classify(base({ quality: { barsUsed: MOMENTUM_RULES.minBarsForEvidence - 1 } }))).toBe("insufficient-evidence");
    expect(classify(base({ price: { closeLocation: null } }))).toBe("insufficient-evidence");
  });
});

describe("evidence factors", () => {
  it("lists continuation and reversal evidence with the numbers behind it, independent of the label", () => {
    const f = explainFactors(base({ price: { moveZ: ok(4.2), distSma200Pct: ok(-3) } }));
    const cont = f.continuation.map((x) => x.id);
    const rev = f.reversal.map((x) => x.id);
    expect(cont).toEqual(expect.arrayContaining(["close-location", "volume", "relative-strength", "near-52w-high"]));
    expect(rev).toEqual(expect.arrayContaining(["abnormal-move", "trend"]));
    expect(f.reversal.find((x) => x.id === "abnormal-move")?.text).toMatch(/4\.2 standard deviations/);
  });

  it("never describes high volume as buying", () => {
    const text = explainFactors(base()).continuation.find((x) => x.id === "volume")!.text;
    expect(text).toMatch(/not whether buyers or sellers/);
  });

  it("mirrors the direction for losers (continuation = further weakness)", () => {
    const f = explainFactors(base({ group: "loser", price: { dailyChangePct: -6, closeLocation: 0.1, distSma50Pct: ok(-4), distSma200Pct: ok(-9) }, context: { relativeStrength1m: ok(-5) } }));
    expect(f.continuation.map((x) => x.id)).toEqual(expect.arrayContaining(["close-location", "trend", "relative-strength"]));
    expect(f.continuation.find((x) => x.id === "close-location")?.text).toMatch(/low/);
  });

  it("flags a gap that faded after the open", () => {
    const f = explainFactors(base({ price: { gapPct: 4, openToClosePct: -1 } }));
    expect(f.reversal.find((x) => x.id === "gap")?.text).toMatch(/faded/);
  });
});
