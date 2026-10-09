import { describe, it, expect } from "vitest";
import { summarizeDashboardData } from "../../src/lib/storage/snapshotHistory";
import { buildDashboardData } from "../../src/lib/dashboard";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { SCHEMA_VERSION, type RawDataset } from "../../src/types/dataset";
import { makeBars } from "../helpers";

function buildMinimalDataset(): RawDataset {
  const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
  const benchBars = makeBars(closes);
  const stockBars = makeBars(closes.map((c) => c * 1.05));

  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      latestMarketDate: benchBars[benchBars.length - 1].date,
      source: { name: "test", indexDataUrl: "", constituentDataUrl: "", equityDataUrl: "" },
      sectors: [],
      benchmark: "nifty500",
      warnings: [],
    },
    indexSeries: { nifty500: { slug: "nifty500", nseIndexName: "Nifty 500", bars: benchBars } },
    constituents: {
      nifty500: {
        slug: "nifty500",
        constituents: [{ symbol: "AAA", companyName: "AAA Ltd", industry: "Test Industry" }],
        fetchedAt: new Date().toISOString(),
      },
    },
    stocks: { AAA: { symbol: "AAA", bars: stockBars } },
  };
}

describe("summarizeDashboardData", () => {
  it("captures the market date, regime counts and top sector/stock from real computed data", () => {
    const dataset = buildMinimalDataset();
    const dashboardData = buildDashboardData(dataset, DEFAULT_SETTINGS);
    const entry = summarizeDashboardData(dashboardData);

    expect(entry.marketDate).toBe(dashboardData.latestMarketDate);
    expect(entry.bullishCount + entry.sidewaysCount + entry.bearishCount + entry.insufficientDataCount).toBeGreaterThan(0);
    expect(entry.topStocks.length).toBeGreaterThan(0);
    expect(entry.topStocks[0].symbol).toBe("AAA");
  });

  it("never throws and produces a null benchmark return rather than NaN when unavailable", () => {
    const dataset = buildMinimalDataset();
    dataset.indexSeries.nifty500.bars = []; // force no data
    const dashboardData = buildDashboardData(dataset, DEFAULT_SETTINGS);
    const entry = summarizeDashboardData(dashboardData);
    expect(entry.benchmarkReturn1m).toBeNull();
    expect(Number.isNaN(entry.benchmarkReturn1m as unknown as number)).toBe(false);
  });

  it("is deterministic for identical inputs", () => {
    const dataset = buildMinimalDataset();
    const dashboardData = buildDashboardData(dataset, DEFAULT_SETTINGS);
    expect(summarizeDashboardData(dashboardData)).toEqual(summarizeDashboardData(dashboardData));
  });
});
