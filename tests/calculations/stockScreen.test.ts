import { describe, it, expect } from "vitest";
import { assembleStockScreenResult } from "../../src/lib/calculations/stockScreen";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { makeBars } from "../helpers";

describe("assembleStockScreenResult", () => {
  it("returns a fully unavailable result for empty price data, never throwing", () => {
    const result = assembleStockScreenResult(
      { symbol: "X", companyName: "X Ltd", industry: "Test", sectorSlugs: [], rawBars: [] },
      makeBars([100, 101, 102]),
      DEFAULT_SETTINGS,
    );
    expect(result.currentClose.available).toBe(false);
    expect(result.dataQuality.status).toBe("unavailable");
    expect(result.score.pointsPossible).toBe(0);
  });

  it("computes a complete result with real price history", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 10) * 10 + i * 0.05);
    const benchmarkCloses = Array.from({ length: 300 }, (_, i) => 100 + i * 0.03);
    const result = assembleStockScreenResult(
      { symbol: "X", companyName: "X Ltd", industry: "Test", sectorSlugs: ["auto"], rawBars: makeBars(closes) },
      makeBars(benchmarkCloses),
      DEFAULT_SETTINGS,
    );
    expect(result.currentClose.available).toBe(true);
    expect(result.returns.m1.available).toBe(true);
    expect(result.above50dma.available).toBe(true);
    expect(result.sectorSlugs).toEqual(["auto"]);
    expect(result.score.pointsPossible).toBeGreaterThan(0);
  });

  it("is deterministic for identical inputs", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + Math.cos(i / 7) * 8);
    const benchBars = makeBars(Array.from({ length: 300 }, (_, i) => 100 + i * 0.02));
    const input = { symbol: "X", companyName: "X Ltd", industry: "Test", sectorSlugs: [], rawBars: makeBars(closes) };
    expect(assembleStockScreenResult(input, benchBars, DEFAULT_SETTINGS)).toEqual(
      assembleStockScreenResult(input, benchBars, DEFAULT_SETTINGS),
    );
  });
});
