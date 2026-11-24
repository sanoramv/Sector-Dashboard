/** Live evaluation helpers (synthetic summaries only; no data files are read). */
import { describe, expect, it } from "vitest";
import { GROUP_FILTER, checkpointOf, horizonStats, officialSessions, overview, sessionBootstrap, type EvaluationSummary, type SummaryPrediction } from "../../src/lib/evaluation/liveEvaluation";

const pred = (symbol: string, over: Partial<SummaryPrediction> = {}): SummaryPrediction => ({ id: `d|${symbol}|mv1`, symbol, name: symbol, industry: "X", segment: "large", sector: null, group: "gainer", lists: [["gainer", 10]], setup: "possible-breakout", evidence: "continuation", netScore: 4, changePct: 5, out: {}, ...over });
const stored = { status: "stored", end: "2031-01-08", processedAt: "2031-01-09T00:00:00Z" };
const pending = { status: "pending", reason: "fewer than 5 trading sessions" };
function summary(): EvaluationSummary {
  const s = (date: string, preds: SummaryPrediction[], over: Partial<EvaluationSummary["sessions"][number]> = {}) => ({ date, eligible: true, excluded: null, regime: "bullish", benchmarkChangePct: 0.1, receipt: "live", horizons: { h1: stored, h2: pending, h5: pending, h10: pending }, predictions: preds, ...over });
  return {
    kind: "momentum-ledger.evaluation-summary",
    ruleVersion: "mv1-8ecef864",
    policy: { decidedAt: "2031-01-01", outcomesFrom: "2031-01-06", excludedSessions: [{ sessionDate: "2031-01-05", reason: "anomaly" }] },
    note: "",
    sessions: [
      s("2031-01-05", [pred("OLD", { out: { h1: { s: "complete", c: "reversal", R: -5, X: -5, T: -5 } } })], { eligible: false, excluded: "anomaly" }),
      s("2031-01-06", [
        pred("AAA", { out: { h1: { s: "complete", c: "confirmed", R: 2, X: 1.5, T: 1, mfe: 3, mae: -1 } } }),
        pred("BBB", { evidence: "mixed", out: { h1: { s: "complete", c: "failed", R: -1, X: -1.2, T: -0.5, mfe: 1, mae: -2 } } }),
        pred("CCC", { out: { h1: { s: "unavailable", why: "no-bar" } } }),
        pred("DDD", { setup: "mixed-signals", out: { h1: { s: "complete", c: "sideways", R: 0.1, X: 0, T: 0 } } }),
        pred("LOS", { group: "loser", lists: [["loser", 3]], setup: "weak-momentum", out: { h1: { s: "complete", c: "partial", R: -1, X: -1, T: -1 } } }),
        pred("VOL", { lists: [["volume", 5]], out: { h1: { s: "complete", c: "confirmed", R: 4, X: 4, T: 4 } } }),
      ]),
    ],
  };
}

describe("live evaluation", () => {
  it("groups match the research definitions (top-50 gainer list; breakout; continuation split; losers separate)", () => {
    const ps = summary().sessions[1].predictions;
    const of = (g: keyof typeof GROUP_FILTER) => ps.filter(GROUP_FILTER[g]).map((p) => p.symbol);
    expect(of("B")).toEqual(["AAA", "BBB", "CCC", "DDD"]);
    expect(of("C")).toEqual(["AAA", "BBB", "CCC"]);
    expect(of("E")).toEqual(["AAA", "CCC"]);
    expect(of("F")).toEqual(["BBB"]);
    expect(of("L")).toEqual(["LOS"]);
  });

  it("excluded sessions never count; unavailable and pending are reported beside the shares", () => {
    const s = summary();
    expect(officialSessions(s).map((x) => x.date)).toEqual(["2031-01-06"]);
    const c1 = horizonStats(s, "C", 1, 50);
    expect(c1).toMatchObject({ predictions: 3, complete: 2, unavailable: { "no-bar": 1 }, pending: 0, sessionsWithOutcomes: 1, classes: { confirmed: 1, failed: 1 } });
    expect(c1.adverse.value).toBe(50);
    expect(c1.confirmed.value).toBe(50);
    expect(c1.adverse.ci).toBeNull(); // fewer than 5 sessions: no interval
    expect(c1.meanNet.value).toBeCloseTo((1 - 0.2 + (-0.5 - 0.2)) / 2, 10);
    expect(horizonStats(s, "C", 5, 50)).toMatchObject({ complete: 0, pending: 3 });
    expect(overview(s)).toMatchObject({ captured: 7, sessions: 2, official: 1, perH: { h1: { mature: 6, pending: 0 }, h5: { mature: 0, pending: 6 } } });
  });

  it("session bootstrap: deterministic, clusters by session, interval only from 5 sessions", () => {
    const rows = Array.from({ length: 6 }, (_, k) => Array.from({ length: 4 }, () => ({ session: `s${k}`, v: k % 2 ? 100 : 0 }))).flat();
    const a = sessionBootstrap(rows, 200);
    expect(a).toEqual(sessionBootstrap(rows, 200));
    expect(a.value).toBe(50);
    expect(a.ci![0]).toBeLessThan(50);
    expect(a.ci![1]).toBeGreaterThan(50);
    expect(sessionBootstrap(rows.filter((r) => r.session < "s4"), 200).ci).toBeNull();
    expect(sessionBootstrap([], 10)).toEqual({ value: null, ci: null });
  });

  it("checkpoints describe what the sample can support", () => {
    expect(checkpointOf(3)).toMatchObject({ reached: null, next: 5 });
    expect(checkpointOf(20).message).toContain("First look");
    expect(checkpointOf(260)).toMatchObject({ reached: 250, next: null });
  });
});
