import { describe, it, expect } from "vitest";
import { computeReturnOverSessions, computeReturns } from "../../src/lib/calculations/returns";
import { makeBars } from "../helpers";

describe("computeReturnOverSessions", () => {
  it("computes the correct percentage return over N sessions", () => {
    const bars = makeBars([100, 102, 104, 103, 110]); // index 0..4
    // 1-session return: (110/103 - 1) * 100
    const r1 = computeReturnOverSessions(bars, 1);
    expect(r1.available).toBe(true);
    if (r1.available) expect(r1.value).toBeCloseTo(((110 / 103) - 1) * 100, 10);

    // 4-session return: (110/100 - 1) * 100 = 10
    const r4 = computeReturnOverSessions(bars, 4);
    expect(r4.available).toBe(true);
    if (r4.available) expect(r4.value).toBeCloseTo(10, 10);
  });

  it("marks the return unavailable when there isn't enough history", () => {
    const bars = makeBars([100, 102]);
    const r = computeReturnOverSessions(bars, 5);
    expect(r.available).toBe(false);
  });

  it("marks the return unavailable for an empty series rather than throwing", () => {
    const r = computeReturnOverSessions([], 1);
    expect(r.available).toBe(false);
  });

  it("handles a zero-session-back edge case as the latest bar vs itself (0% return)", () => {
    const bars = makeBars([100, 105]);
    const r = computeReturnOverSessions(bars, 0);
    expect(r.available).toBe(true);
    if (r.available) expect(r.value).toBe(0);
  });
});

describe("computeReturns", () => {
  it("marks every timeframe unavailable individually based on available history, never defaulting to 0", () => {
    // Only 10 sessions of history: 1D and 1W should resolve, 1M/3M/6M should not.
    const closes = Array.from({ length: 10 }, (_, i) => 100 + i);
    const bars = makeBars(closes);
    const returns = computeReturns(bars);
    expect(returns.d1.available).toBe(true);
    expect(returns.w1.available).toBe(true);
    expect(returns.m1.available).toBe(false);
    expect(returns.m3.available).toBe(false);
    expect(returns.m6.available).toBe(false);
  });

  it("is deterministic for identical inputs", () => {
    const bars = makeBars([100, 101, 99, 105, 110, 108, 112]);
    expect(computeReturns(bars)).toEqual(computeReturns(bars));
  });
});
