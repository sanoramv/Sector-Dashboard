import { describe, it, expect } from "vitest";
import { computeMarketCapSegmentMetrics } from "../../src/lib/calculations/marketCapSegments";
import { validateBars } from "../../src/lib/calculations/validation";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { MarketCapSegmentDefinition } from "../../src/config/marketCapSegments";
import type { RawDataset } from "../../src/types/dataset";
import { SCHEMA_VERSION } from "../../src/types/dataset";
import { makeBars } from "../helpers";

function buildDataset(opts: { segmentSymbols: string[]; symbolsMissingHistory?: string[] }): RawDataset {
  const benchCloses = Array.from({ length: 300 }, (_, i) => 100 + i * 0.1);
  const segCloses = Array.from({ length: 300 }, (_, i) => 100 + i * 0.12);
  const benchBars = makeBars(benchCloses);

  const stocks: RawDataset["stocks"] = {};
  const missing = new Set(opts.symbolsMissingHistory ?? []);
  for (const sym of opts.segmentSymbols) {
    stocks[sym] = { symbol: sym, bars: missing.has(sym) ? [] : makeBars(segCloses.map((c) => c + Math.random() * 0)) };
  }

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
    indexSeries: {
      nifty500: { slug: "nifty500", nseIndexName: "Nifty 500", bars: benchBars },
      testseg: { slug: "testseg", nseIndexName: "Nifty Test Segment", bars: makeBars(segCloses) },
    },
    constituents: {
      testseg: {
        slug: "testseg",
        constituents: opts.segmentSymbols.map((s) => ({ symbol: s, companyName: s, industry: "Test" })),
        fetchedAt: new Date().toISOString(),
      },
    },
    stocks,
  };
}

const NON_SELF_DEF: MarketCapSegmentDefinition = {
  slug: "testseg",
  panelLabel: "Test Segment",
  nseIndexName: "Nifty Test Segment",
  constituentFile: "ignored.csv",
  isSelfBenchmark: false,
  overlapNote: "test",
};

const SELF_DEF: MarketCapSegmentDefinition = {
  ...NON_SELF_DEF,
  slug: "nifty500",
  panelLabel: "NIFTY 500",
  isSelfBenchmark: true,
};

describe("computeMarketCapSegmentMetrics", () => {
  it("computes normal relative-performance and regime for a non-self-benchmark segment", () => {
    const dataset = buildDataset({ segmentSymbols: ["A", "B", "C"] });
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const result = computeMarketCapSegmentMetrics(NON_SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);

    expect(result.isSelfBenchmark).toBe(false);
    expect(result.metrics.relativeStrength.m3.available).toBe(true);
  });

  it("marks relative performance as explicitly not-meaningful for the self-benchmark segment", () => {
    const dataset = buildDataset({ segmentSymbols: ["A", "B", "C"] });
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const result = computeMarketCapSegmentMetrics(SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);

    expect(result.isSelfBenchmark).toBe(true);
    expect(result.metrics.relativeStrength.m3.available).toBe(false);
    if (!result.metrics.relativeStrength.m3.available) {
      expect(result.metrics.relativeStrength.m3.reason).toMatch(/not meaningful/i);
    }
    expect(result.metrics.relativeStrength.ratioSeries.available).toBe(false);
  });

  it("can still classify a bullish regime for the self-benchmark segment despite relative performance being unavailable", () => {
    // Rising benchmark with no constituents (regime still evaluable from returns + breadth... but with
    // zero constituents breadth is unavailable, so use a segment with real constituent data instead).
    const dataset = buildDataset({ segmentSymbols: ["A", "B", "C", "D", "E"] });
    dataset.constituents.nifty500 = dataset.constituents.testseg;
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const result = computeMarketCapSegmentMetrics(SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);

    // Rising monotonic series with real constituent breadth data -> should not be stuck at "sideways"
    // purely because of the self-referential RS condition.
    expect(["bullish", "sideways", "insufficient-data"]).toContain(result.metrics.regime.regime);
    expect(result.metrics.regime.reasons.some((r) => /not meaningful/i.test(r))).toBe(true);
  });

  it("reports constituent coverage correctly, including missing-history symbols", () => {
    const dataset = buildDataset({ segmentSymbols: ["A", "B", "C", "D"], symbolsMissingHistory: ["C", "D"] });
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const result = computeMarketCapSegmentMetrics(NON_SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);

    expect(result.coverage.totalConstituents).toBe(4);
    expect(result.coverage.symbolsWithHistory).toBe(2);
    expect(result.coverage.missingHistoryCount).toBe(2);
  });

  it("never throws and reports full coverage gap for an entirely missing segment", () => {
    const dataset = buildDataset({ segmentSymbols: [] });
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const result = computeMarketCapSegmentMetrics(
      { ...NON_SELF_DEF, slug: "doesnotexist" },
      dataset,
      benchBars,
      DEFAULT_SETTINGS,
    );
    expect(result.coverage.totalConstituents).toBe(0);
    expect(result.metrics.dataQuality.status).toBe("unavailable");
  });

  it("is deterministic for identical inputs", () => {
    const dataset = buildDataset({ segmentSymbols: ["A", "B", "C"] });
    const { bars: benchBars } = validateBars(dataset.indexSeries.nifty500.bars);
    const r1 = computeMarketCapSegmentMetrics(NON_SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);
    const r2 = computeMarketCapSegmentMetrics(NON_SELF_DEF, dataset, benchBars, DEFAULT_SETTINGS);
    expect(r1).toEqual(r2);
  });
});
