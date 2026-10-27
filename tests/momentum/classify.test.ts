import { describe, it, expect } from "vitest";
import { ok, unavailable } from "../../src/types/metrics";
import { base } from "./candidateFixture";
import { classify, explainFactors, lowConfidenceReasons, MOMENTUM_RULES } from "../../src/lib/momentum/classify";

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

  it("counts the broad-market move only when NIFTY 50 agrees with NIFTY 500", () => {
    const idx = (change: number) => ({ slug: "nifty50", displayName: "NIFTY 50", changePct: ok(change), relativeStrength1m: ok(0), above50dma: true, breadth50: null });
    expect(explainFactors(base({ context: { benchmarkChangePct: ok(0.6), nifty50: idx(0.4) } })).continuation.map((x) => x.id)).toContain("market");
    const split = explainFactors(base({ context: { benchmarkChangePct: ok(0.6), nifty50: idx(-0.02) } }));
    expect([...split.continuation, ...split.reversal].map((x) => x.id)).not.toContain("market");
  });

  it("flags a gap that faded after the open", () => {
    const f = explainFactors(base({ price: { gapPct: 4, openToClosePct: -1 } }));
    expect(f.reversal.find((x) => x.id === "gap")?.text).toMatch(/faded/);
  });
});
