import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SectorConstituents } from "../../src/types/market";

/**
 * Verifies the actual committed public/data/constituents.json against the
 * universe-overlap claims this app makes in the UI (MarketCapSegmentsSection,
 * marketCapSegments.ts overlapNote). This is a data-contract test: if a
 * future constituent refresh ever changes these relationships (e.g. NSE
 * reconstitutes an index such that Microcap 250 starts overlapping NIFTY
 * 500), this test fails loudly instead of the app silently asserting a
 * stale claim in the UI.
 */
function loadConstituents(): Record<string, SectorConstituents> {
  const p = path.resolve(__dirname, "../../public/data/constituents.json");
  return JSON.parse(readFileSync(p, "utf-8"));
}

describe("market-cap segment universe relationships (real committed data)", () => {
  const data = loadConstituents();

  it("has all four market-cap segments present in the committed dataset", () => {
    expect(data.nifty500).toBeDefined();
    expect(data.midcap150).toBeDefined();
    expect(data.smallcap250).toBeDefined();
    expect(data.microcap250).toBeDefined();
  });

  it("NIFTY Microcap 250 constituents are entirely OUTSIDE the NIFTY 500 universe", () => {
    const nifty500Symbols = new Set(data.nifty500.constituents.map((c) => c.symbol));
    const microcapSymbols = data.microcap250.constituents.map((c) => c.symbol);
    const overlap = microcapSymbols.filter((s) => nifty500Symbols.has(s));

    expect(microcapSymbols.length).toBeGreaterThan(0);
    expect(overlap).toEqual([]);
  });

  it("NIFTY Midcap 150 constituents are entirely WITHIN the NIFTY 500 universe (a strict subset)", () => {
    const nifty500Symbols = new Set(data.nifty500.constituents.map((c) => c.symbol));
    const midcapSymbols = data.midcap150.constituents.map((c) => c.symbol);
    const notInNifty500 = midcapSymbols.filter((s) => !nifty500Symbols.has(s));

    expect(midcapSymbols.length).toBeGreaterThan(0);
    expect(notInNifty500).toEqual([]);
  });

  it("NIFTY Smallcap 250 constituents are entirely WITHIN the NIFTY 500 universe (a strict subset)", () => {
    const nifty500Symbols = new Set(data.nifty500.constituents.map((c) => c.symbol));
    const smallcapSymbols = data.smallcap250.constituents.map((c) => c.symbol);
    const notInNifty500 = smallcapSymbols.filter((s) => !nifty500Symbols.has(s));

    expect(smallcapSymbols.length).toBeGreaterThan(0);
    expect(notInNifty500).toEqual([]);
  });

  it("Midcap 150, Smallcap 250 and Microcap 250 do not overlap each other (NSE's rank-based segments partition, not overlap)", () => {
    const mid = new Set(data.midcap150.constituents.map((c) => c.symbol));
    const small = new Set(data.smallcap250.constituents.map((c) => c.symbol));
    const micro = new Set(data.microcap250.constituents.map((c) => c.symbol));

    expect([...mid].filter((s) => small.has(s))).toEqual([]);
    expect([...small].filter((s) => micro.has(s))).toEqual([]);
    expect([...mid].filter((s) => micro.has(s))).toEqual([]);
  });

  it("every constituent record carries a non-empty symbol and industry classification", () => {
    for (const slug of ["nifty500", "midcap150", "smallcap250", "microcap250"]) {
      for (const c of data[slug].constituents) {
        expect(c.symbol.length).toBeGreaterThan(0);
        expect(c.industry.length).toBeGreaterThan(0);
      }
    }
  });
});
