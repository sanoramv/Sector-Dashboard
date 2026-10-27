import { describe, it, expect } from "vitest";
import { ok, unavailable } from "../../src/types/metrics";
import { assessEvidence, CATEGORY_TEXT } from "../../src/lib/momentum/assess";
import { explainCandidate, evidenceLists } from "../../src/lib/momentum/explain";
import type { OutcomeStats } from "../../src/lib/momentum/evaluation";
import { base } from "./candidateFixture";

const score = (a: ReturnType<typeof assessEvidence>, dim: string) => a.components.find((c) => c.dimension === dim)!.score;

describe("evidence assessment (component scores -> category)", () => {
  it("strong close on volume with relative strength and no extension -> continuation characteristics", () => {
    const a = assessEvidence(base({ patterns: { breakoutToday: true } }));
    expect(a.category).toBe("continuation");
    expect(score(a, "price-structure")).toBe(2);
    expect(score(a, "volume")).toBe(1);
    expect(score(a, "relative-strength")).toBe(1);
    expect(score(a, "extension")).toBe(0);
    expect(a.total).toBe(4);
    expect(a.rationale).toMatch(/^Continuation characteristics/);
  });

  it("a confirmed close but light volume is not continuation (participation is required)", () => {
    expect(assessEvidence(base({ patterns: { breakoutToday: true }, activity: { relativeVolume: ok(1.2) } })).category).toBe("mixed");
  });

  it("a stretched move is exhaustion/reversal risk even when everything else is strong", () => {
    const a = assessEvidence(base({ patterns: { breakoutToday: true }, price: { distSma20Pct: ok(18) } }));
    expect(a.category).toBe("exhaustion-reversal");
    expect(score(a, "extension")).toBe(-2);
  });

  it("an upper-wick rejection with a weak close scores against the price structure", () => {
    const a = assessEvidence(base({ price: { closeLocation: 0.35, upperWickShare: 0.6 }, patterns: { failedBreakoutToday: true } }));
    expect(score(a, "price-structure")).toBe(-2); // clamped from -3
    expect(a.category).toBe("exhaustion-reversal");
    expect(evidenceLists({ assessment: a }).opposing.join(" ")).toMatch(/upper wick is 60%/);
  });

  it("flags a long run on fading participation as exhaustion evidence", () => {
    const a = assessEvidence(base({ price: { r10: ok(18) }, activity: { priorParticipation: ok(0.6) } }));
    expect(a.components.find((c) => c.dimension === "extension")!.reasons.join(" ")).toMatch(/fading participation/);
  });

  it("scores losers relative to their own direction: downside continuation vs rebound risk", () => {
    const down = assessEvidence(
      base({
        group: "loser",
        price: { dailyChangePct: -6, closeLocation: 0.1, lowerWickShare: 0.05, distSma20Pct: ok(-6), distSma50Pct: ok(-8), r5: ok(-7) },
        patterns: { breakdownToday: true },
        context: { relativeStrength1m: ok(-5), benchmarkChangePct: ok(-0.8), marketRegime: "bearish" },
      }),
    );
    expect(down.category).toBe("continuation");
    expect(CATEGORY_TEXT.loser[down.category]).toBe("Downside-continuation characteristics");
    const rebound = assessEvidence(base({ group: "loser", price: { dailyChangePct: -9, closeLocation: 0.2, distSma20Pct: ok(-17) } }));
    expect(rebound.category).toBe("exhaustion-reversal");
    expect(CATEGORY_TEXT.loser[rebound.category]).toBe("Rebound/reversal risk");
  });

  it("is insufficient, and lists the missing evidence, when volume history is missing", () => {
    const a = assessEvidence(base({ activity: { relativeVolume: unavailable("no data") }, context: { marketRegime: "insufficient-data" } }));
    expect(a.category).toBe("insufficient");
    expect(score(a, "volume")).toBeNull();
    expect(a.missingEvidence).toEqual(expect.arrayContaining(["relative volume", "market regime"]));
  });

  it("uses NIFTY 50 and the sector index when available", () => {
    const idx = (displayName: string, change: number, rs: number) => ({ slug: displayName, displayName, changePct: ok(change), relativeStrength1m: ok(rs), above50dma: true, breadth50: null });
    const a = assessEvidence(base({ context: { benchmarkChangePct: ok(1.1), nifty50: idx("NIFTY 50", 0.9, 0), sectorIndex: idx("NIFTY IT", 2, 3), marketRegime: "bullish" } }));
    expect(score(a, "market")).toBe(2);
    expect(score(a, "relative-strength")).toBe(2);
    expect(a.components.find((c) => c.dimension === "market")!.reasons[0]).toMatch(/NIFTY 50 \+0\.90%/);
    // NIFTY 50 disagreeing with NIFTY 500 -> no market-direction point either way
    const split = assessEvidence(base({ context: { benchmarkChangePct: ok(1.1), nifty50: idx("NIFTY 50", -0.4, 0) } }));
    expect(score(split, "market")).toBe(0);
  });
});

describe("explanations come only from calculated evidence", () => {
  const stats = (pctPositive: number, n = 500, sufficient = true): OutcomeStats =>
    ({ n, dates: 200, pctPositive, sufficient, insufficientReason: sufficient ? null : `only ${n} observations (need 30)` }) as OutcomeStats;

  it("names the category, supporting evidence, counterpoints and the historical record", () => {
    const c = { group: "gainer" as const, assessment: assessEvidence(base({ patterns: { breakoutToday: true }, price: { moveZ: ok(3.5) } })) };
    const text = explainCandidate(c, stats(47), stats(46), true);
    expect(text).toMatch(/^Continuation characteristics: closed at 85% of the range/);
    expect(text).toMatch(/Counterpoint: today's move is 3\.5 standard deviations/);
    expect(text).toMatch(/of 500 earlier gainers in this category \(200 dates\), 47% closed higher the next session, versus 46% of all top gainers - a historical frequency, not a forecast/);
  });

  it("leads with the warning signs for exhaustion and lists both sides for mixed evidence", () => {
    const ex = { group: "gainer" as const, assessment: assessEvidence(base({ price: { distSma20Pct: ok(18), r5: ok(12) } })) };
    expect(explainCandidate(ex, null, null, false)).toMatch(/^Exhaustion\/reversal risk: stretched: 18\.0% from the 20-day average.*Counterpoint: closed at 85% of the range/);
    const mixed = { group: "gainer" as const, assessment: assessEvidence(base({ activity: { relativeVolume: ok(1.2) }, price: { moveZ: ok(3.1) } })) };
    expect(mixed.assessment.category).toBe("mixed");
    expect(explainCandidate(mixed, null, null, false)).toMatch(/^Mixed evidence\. Supporting: .*Against: today's move is 3\.1 standard deviations/);
  });

  it("says when history was not computed or the sample is insufficient", () => {
    const c = { group: "loser" as const, assessment: assessEvidence(base({ group: "loser", price: { dailyChangePct: -5, closeLocation: 0.5 } })) };
    expect(explainCandidate(c, null, null, false)).toMatch(/not yet computed/);
    expect(explainCandidate(c, stats(50, 9, false), stats(47), true)).toMatch(/insufficient sample \(only 9 observations/);
    expect(explainCandidate(c, null, stats(47), true)).toMatch(/no earlier losers in this category/);
  });
});
