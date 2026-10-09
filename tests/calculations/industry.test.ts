import { describe, it, expect } from "vitest";
import { computeIndustryMetrics, groupSymbolsByIndustry, slugifyIndustry } from "../../src/lib/calculations/industry";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { StockSeries } from "../../src/types/market";
import { makeBars } from "../helpers";

describe("slugifyIndustry", () => {
  it("produces a stable, URL-safe slug", () => {
    expect(slugifyIndustry("Oil Gas & Consumable Fuels")).toBe("oil-gas-and-consumable-fuels");
    expect(slugifyIndustry("Automobile and Auto Components")).toBe("automobile-and-auto-components");
  });
});

describe("groupSymbolsByIndustry", () => {
  it("groups constituent symbols by their industry field", () => {
    const groups = groupSymbolsByIndustry([
      { symbol: "A", industry: "Tech" },
      { symbol: "B", industry: "Tech" },
      { symbol: "C", industry: "Banks" },
    ]);
    expect(groups["Tech"]).toEqual(["A", "B"]);
    expect(groups["Banks"]).toEqual(["C"]);
  });
});

function stockSeries(symbol: string, closes: number[]): StockSeries {
  return { symbol, bars: makeBars(closes) };
}

describe("computeIndustryMetrics", () => {
  it("averages returns across only the constituents that have a computable value", () => {
    const closes300 = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
    const stocks: Record<string, StockSeries> = {
      A: stockSeries("A", closes300), // full history
      B: stockSeries("B", closes300.map((c) => c * 1.1)), // full history, scaled up
      C: stockSeries("C", [100, 101, 102]), // too little history for 1M+
    };
    const benchmarkBars = makeBars(closes300);
    const result = computeIndustryMetrics("Test Industry", ["A", "B", "C"], stocks, benchmarkBars, DEFAULT_SETTINGS);

    expect(result.stockCount).toBe(3);
    // A and B have identical % returns (B is a scaled copy of A), C contributes nothing to 1M.
    expect(result.returnsSampleSize.m1).toBe(2);
    expect(result.returns.m1.available).toBe(true);
  });

  it("forces insufficient-data regime when below the minimum constituent threshold", () => {
    const closes300 = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
    const stocks: Record<string, StockSeries> = { A: stockSeries("A", closes300) };
    const benchmarkBars = makeBars(closes300);
    const result = computeIndustryMetrics("Tiny Industry", ["A"], stocks, benchmarkBars, DEFAULT_SETTINGS);

    expect(result.regime.regime).toBe("insufficient-data");
    expect(result.regime.reasons.join(" ")).toMatch(/at least 3/i);
  });

  it("never fabricates a value when no constituent has any data", () => {
    const benchmarkBars = makeBars(Array.from({ length: 300 }, (_, i) => 100 + i * 0.1));
    const result = computeIndustryMetrics("Empty Industry", ["X", "Y"], {}, benchmarkBars, DEFAULT_SETTINGS);

    expect(result.returns.m1.available).toBe(false);
    expect(result.distanceFrom52wHigh.available).toBe(false);
    expect(result.dataQuality.status).toBe("unavailable");
  });

  it("is deterministic for identical inputs", () => {
    const closes300 = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
    const stocks: Record<string, StockSeries> = {
      A: stockSeries("A", closes300),
      B: stockSeries("B", closes300.map((c) => c * 0.9)),
      C: stockSeries("C", closes300.map((c) => c * 1.2)),
    };
    const benchmarkBars = makeBars(closes300);
    const r1 = computeIndustryMetrics("Det", ["A", "B", "C"], stocks, benchmarkBars, DEFAULT_SETTINGS);
    const r2 = computeIndustryMetrics("Det", ["A", "B", "C"], stocks, benchmarkBars, DEFAULT_SETTINGS);
    expect(r1).toEqual(r2);
  });
});
