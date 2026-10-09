import { describe, it, expect } from "vitest";
import { computeRelativeStrength } from "../../src/lib/calculations/relativeStrength";
import { makeBars } from "../helpers";

describe("computeRelativeStrength", () => {
  it("computes relative performance as sector return minus benchmark return", () => {
    const sector = makeBars(Array.from({ length: 30 }, (_, i) => 100 + i)); // +29 over 29 sessions
    const benchmark = makeBars(Array.from({ length: 30 }, (_, i) => 100 + i * 0.5));
    const rs = computeRelativeStrength(sector, benchmark);
    expect(rs.w1.available).toBe(true);
    if (rs.w1.available && rs.m1.available) {
      // sector should outperform since it rises faster
      expect(rs.w1.value).toBeGreaterThan(0);
    }
  });

  it("builds the RS ratio series only over dates present in both series (inner join)", () => {
    const sector = makeBars([10, 11, 12], "2024-01-01");
    const benchmark = makeBars([100, 110], "2024-01-02"); // only overlaps on 01-02 and 01-03
    const rs = computeRelativeStrength(sector, benchmark);
    expect(rs.ratioSeries.available).toBe(true);
    if (rs.ratioSeries.available) {
      expect(rs.ratioSeries.value).toHaveLength(2);
      expect(rs.ratioSeries.value[0].date).toBe("2024-01-02");
    }
  });

  it("marks relative performance unavailable when the benchmark lacks sufficient history", () => {
    const sector = makeBars(Array.from({ length: 30 }, (_, i) => 100 + i));
    const benchmark = makeBars([100, 101]);
    const rs = computeRelativeStrength(sector, benchmark);
    expect(rs.m1.available).toBe(false);
  });

  it("marks the ratio series unavailable when there is no date overlap at all", () => {
    const sector = makeBars([10, 11], "2024-01-01");
    const benchmark = makeBars([100, 101], "2025-06-01");
    const rs = computeRelativeStrength(sector, benchmark);
    expect(rs.ratioSeries.available).toBe(false);
  });
});
