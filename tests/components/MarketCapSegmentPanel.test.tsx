// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MarketCapSegmentPanel } from "../../src/components/MarketCapSegmentPanel";
import { ok, unavailable, type SectorMetrics } from "../../src/types/metrics";
import type { MarketCapSegmentMetrics } from "../../src/types/marketCapSegment";

afterEach(() => cleanup());

function baseMetrics(overrides: Partial<SectorMetrics> = {}): SectorMetrics {
  return {
    slug: "test",
    displayName: "Test",
    currentClose: ok(1000),
    latestDate: ok("2026-10-09"),
    returns: { d1: ok(1.2), w1: ok(0.5), m1: ok(-3.1), m3: ok(-4.2), m6: ok(6.7) },
    breadth: {
      above20dma: { pct: ok(25), eligible: 95, total: 100 },
      above50dma: { pct: ok(30), eligible: 98, total: 100 },
      above200dma: { pct: ok(55), eligible: 100, total: 100 },
      isProxy: false,
    },
    distanceFrom52wHigh: ok(-12.5),
    relativeStrength: { w1: ok(0.1), m1: ok(-0.4), m3: ok(1.2), m6: ok(3.3), ratioSeries: ok([]) },
    score: { conditions: [], pointsEarned: 4, pointsPossible: 9, completenessPct: 100 },
    regime: {
      regime: "sideways",
      reasons: ["1M return is negative (-3.10%)."],
      shortVsLongConflict: false,
      confidence: "medium",
      confidenceReasons: ["All required metrics were available and in agreement."],
    },
    dataQuality: { status: "complete", missing: [] },
    priceSeries: [],
    ...overrides,
  };
}

function buildSegment(overrides: Partial<MarketCapSegmentMetrics> = {}): MarketCapSegmentMetrics {
  return {
    slug: "midcap150",
    panelLabel: "NIFTY Midcap 150 — Midcaps",
    isSelfBenchmark: false,
    overlapNote: "All constituents are also NIFTY 500 constituents (verified).",
    metrics: baseMetrics(),
    coverage: { totalConstituents: 150, symbolsWithHistory: 149, missingHistoryCount: 1 },
    ...overrides,
  };
}

describe("MarketCapSegmentPanel", () => {
  it("renders panel label, regime badge, returns and breadth for a normal segment", () => {
    render(<MarketCapSegmentPanel segment={buildSegment()} />);
    expect(screen.getByText("NIFTY Midcap 150 — Midcaps")).toBeTruthy();
    expect(screen.getByText(/Sideways/i)).toBeTruthy();
    expect(screen.getByText("-3.10%")).toBeTruthy();
    expect(screen.getByText("95/100 eligible")).toBeTruthy();
    expect(screen.getByText("98/100 eligible")).toBeTruthy();
  });

  it("shows relative-performance figures for a non-self-benchmark segment", () => {
    render(<MarketCapSegmentPanel segment={buildSegment()} />);
    expect(screen.getByText(/Relative performance vs NIFTY 500/i)).toBeTruthy();
    expect(screen.getByText("+1.20pp")).toBeTruthy(); // 3M RS
  });

  it("hides relative-performance and shows a 'Benchmark' badge for the self-benchmark segment, never a regime badge", () => {
    const segment = buildSegment({
      slug: "nifty500",
      panelLabel: "NIFTY 500 — Broad Market",
      isSelfBenchmark: true,
      overlapNote: "The broad-market benchmark itself.",
    });
    render(<MarketCapSegmentPanel segment={segment} />);
    expect(screen.getByText("Benchmark")).toBeTruthy();
    expect(screen.queryByText(/Relative performance vs NIFTY 500/i)).toBeNull();
    expect(screen.getByText(/this panel IS the NIFTY 500 benchmark/i)).toBeTruthy();
  });

  it("shows an explicit insufficient/unavailable state instead of fabricated numbers when data quality is unavailable", () => {
    const segment = buildSegment({
      metrics: baseMetrics({
        currentClose: unavailable("no valid price data"),
        latestDate: unavailable("no valid price data"),
        returns: {
          d1: unavailable("no data"),
          w1: unavailable("no data"),
          m1: unavailable("no data"),
          m3: unavailable("no data"),
          m6: unavailable("no data"),
        },
        dataQuality: { status: "unavailable", missing: ["all price-derived metrics"] },
      }),
    });
    render(<MarketCapSegmentPanel segment={segment} />);
    expect(screen.getByText(/No valid data available for this segment/i)).toBeTruthy();
    // Must not render fabricated return figures when unavailable.
    expect(screen.queryByText("-3.10%")).toBeNull();
  });

  it("surfaces the missing-history coverage count and the overlap note", () => {
    render(<MarketCapSegmentPanel segment={buildSegment()} />);
    expect(screen.getByText(/149 of 150 constituents have price history/i)).toBeTruthy();
    expect(screen.getByText(/1 missing/i)).toBeTruthy();
    expect(screen.getByText(/All constituents are also NIFTY 500 constituents/i)).toBeTruthy();
  });
});
