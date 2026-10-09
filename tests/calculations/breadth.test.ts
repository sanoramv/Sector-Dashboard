import { describe, it, expect } from "vitest";
import { isAboveMovingAverage, computeBreadth } from "../../src/lib/calculations/breadth";
import type { StockCloseSeries } from "../../src/types/market";

describe("isAboveMovingAverage", () => {
  it("returns null when there isn't enough history for the window", () => {
    expect(isAboveMovingAverage([1, 2, 3], 20)).toBeNull();
  });

  it("correctly identifies above vs below the SMA", () => {
    const closes = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 20]; // SMA(20) = 10.5, latest = 20 -> above
    expect(isAboveMovingAverage(closes, 20)).toBe(true);

    const closesBelow = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 1]; // SMA(20) = 19.05, latest = 1 -> below
    expect(isAboveMovingAverage(closesBelow, 20)).toBe(false);
  });
});

function series(symbol: string, closes: number[]): StockCloseSeries {
  return {
    symbol,
    closes: closes.map((close, i) => ({ date: `2024-01-${String(i + 1).padStart(2, "0")}`, close })),
  };
}

describe("computeBreadth", () => {
  it("computes the percentage of ELIGIBLE constituents above each MA, not of the full universe", () => {
    const stocks: StockCloseSeries[] = [
      series("A", Array.from({ length: 25 }, () => 10).map((v, i) => (i === 24 ? 20 : v))), // above 20dma
      series("B", Array.from({ length: 25 }, () => 10)), // at/below 20dma (flat, not above)
      series("C", [1, 2, 3]), // ineligible for 20dma (not enough history)
    ];
    const result = computeBreadth(stocks, "2024-01-25", false);
    expect(result.above20dma.eligible).toBe(2); // A and B eligible, C is not
    expect(result.above20dma.total).toBe(3);
    expect(result.above20dma.pct.available).toBe(true);
    if (result.above20dma.pct.available) {
      expect(result.above20dma.pct.value).toBeCloseTo(50, 5); // 1 of 2 eligible is above
    }
  });

  it("marks a window unavailable when no constituent has enough history, never inventing 0%", () => {
    const stocks: StockCloseSeries[] = [series("A", [1, 2, 3])];
    const result = computeBreadth(stocks, "2024-01-03", false);
    expect(result.above200dma.pct.available).toBe(false);
    expect(result.above200dma.eligible).toBe(0);
  });

  it("handles an empty constituent list without throwing", () => {
    const result = computeBreadth([], "2024-01-01", false);
    expect(result.above20dma.pct.available).toBe(false);
    expect(result.above20dma.total).toBe(0);
  });

  it("passes through the isProxy flag unchanged", () => {
    expect(computeBreadth([], "2024-01-01", true).isProxy).toBe(true);
    expect(computeBreadth([], "2024-01-01", false).isProxy).toBe(false);
  });

  it("only counts closes up to and including asOfDate (no look-ahead)", () => {
    const stocks: StockCloseSeries[] = [
      series("A", Array.from({ length: 30 }, (_, i) => (i < 25 ? 10 : 1000))), // huge jump AFTER the asOf date
    ];
    const result = computeBreadth(stocks, "2024-01-25", false); // cutoff before the jump
    expect(result.above20dma.eligible).toBe(1);
    if (result.above20dma.pct.available) {
      // latest close as of 2024-01-25 is still 10 (flat SMA), not the future 1000 spike
      expect(result.above20dma.pct.value).toBe(0);
    }
  });
});
