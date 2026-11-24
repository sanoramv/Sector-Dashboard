/** Synthetic checks of the breakout-characteristics study helpers (no real data). */
import { describe, expect, it } from "vitest";
import { BINS, Boot, bh, bucketOf, CHANGE_BUCKETS } from "../../scripts/research/breakout-characteristics.mts";

describe("breakout characteristics study helpers", () => {
  it("Benjamini-Hochberg: step-up, ignores nulls", () => {
    expect(bh([0.001, 0.02, 0.03, 0.2], 0.1)).toEqual([true, true, true, false]);
    expect(bh([0.04, 0.04, 0.9, null], 0.1)).toEqual([true, true, false, false]);
    expect(bh([0.5, 0.6], 0.1)).toEqual([false, false]);
  });

  it("moving-block bootstrap: deterministic, in range, keeps consecutive sessions together", () => {
    const a = new Boot(37, 5, 1, 10);
    const b = new Boot(37, 5, 1, 10);
    expect(a.draws.map((d) => [...d])).toEqual(b.draws.map((d) => [...d]));
    for (const d of a.draws) {
      expect(d.length).toBe(37);
      for (const x of d) expect(x >= 0 && x < 37).toBe(true);
      for (let k = 1; k < 10; k++) expect(d[k] - d[k - 1]).toBe(1); // first block is consecutive
    }
  });

  it("pre-declared bins: lower edges, first bin open below", () => {
    expect(bucketOf(0.5, CHANGE_BUCKETS)).toBe(0);
    expect(bucketOf(2, CHANGE_BUCKETS)).toBe(1);
    expect(bucketOf(10, CHANGE_BUCKETS)).toBe(4);
    expect(BINS.rvol.labels[bucketOf(1.5, BINS.rvol.cuts)]).toBe("1.5-2");
    expect(BINS.closeLoc.labels[bucketOf(0.95, BINS.closeLoc.cuts)]).toBe(">=0.9");
    for (const b of Object.values(BINS)) expect(b.cuts.length).toBe(b.labels.length);
  });
});
