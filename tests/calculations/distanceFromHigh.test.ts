import { describe, it, expect } from "vitest";
import { computeDistanceFrom52wHigh } from "../../src/lib/calculations/distanceFromHigh";
import { makeBars } from "../helpers";

describe("computeDistanceFrom52wHigh", () => {
  it("is unavailable when history spans less than ~1 year", () => {
    const bars = makeBars(Array.from({ length: 100 }, () => 100));
    const result = computeDistanceFrom52wHigh(bars);
    expect(result.available).toBe(false);
  });

  it("is unavailable for an empty series", () => {
    expect(computeDistanceFrom52wHigh([]).available).toBe(false);
  });

  it("computes a correct negative distance when below the 52-week high", () => {
    // 400 daily bars (> 365 days), peak of 200 roughly in the middle, ending at 150.
    const closes = Array.from({ length: 400 }, (_, i) => {
      if (i === 200) return 200; // the high
      return 100 + (i % 10);
    });
    closes[399] = 150; // latest close
    const bars = makeBars(closes);
    const result = computeDistanceFrom52wHigh(bars);
    expect(result.available).toBe(true);
    if (result.available) {
      // high field is close * 1.001, so 52w high ~= 200.2
      const expectedHigh = 200 * 1.001;
      expect(result.value).toBeCloseTo(((150 / expectedHigh) - 1) * 100, 5);
      expect(result.value).toBeLessThan(0);
    }
  });

  it("computes ~0% when the latest close is at the 52-week high", () => {
    const closes = Array.from({ length: 400 }, () => 100);
    closes[399] = 100;
    const bars = makeBars(closes);
    const result = computeDistanceFrom52wHigh(bars);
    expect(result.available).toBe(true);
    if (result.available) expect(result.value).toBeCloseTo(0, 0);
  });
});
