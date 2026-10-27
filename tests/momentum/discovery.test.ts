import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar } from "../../src/types/market";
import { prepareUniverse, comparableBarsUpTo } from "../../src/lib/momentum/universe";
import { discover, moversOn, rankMovers } from "../../src/lib/momentum/discovery";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "./fixtures";

const dates = weekdays("2025-01-01", 80);
const last = dates[dates.length - 1];
const bench = barsFrom(dates, flatCloses(80, 1000, 0.002));

/** Flat history, then a final bar with the given close/open/high/low relative to the previous close. */
function withLastBar(prevLevel: number, f: { o: number; h: number; l: number; c: number }, n = 80): DailyBar[] {
  const bars = barsFrom(dates.slice(0, n - 1), flatCloses(n - 1, prevLevel));
  const p = bars[bars.length - 1].close;
  return [...bars, { date: dates[n - 1], open: p * f.o, high: p * f.h, low: p * f.l, close: p * f.c }];
}

const stocks = [
  { symbol: "UPA", bars: withLastBar(100, { o: 1.01, h: 1.085, l: 1.0, c: 1.08 }) },
  { symbol: "UPB", bars: withLastBar(200, { o: 1.04, h: 1.07, l: 1.0, c: 1.05 }), industry: "Healthcare" },
  { symbol: "UPC", bars: withLastBar(50, { o: 1.0, h: 1.04, l: 0.99, c: 1.03 }) },
  { symbol: "DNA", bars: withLastBar(300, { o: 0.99, h: 1.0, l: 0.93, c: 0.94 }), list: "microcap250" as const },
  { symbol: "FLAT", bars: withLastBar(80, { o: 1, h: 1.005, l: 0.995, c: 1.001 }) },
  { symbol: "GONE", bars: barsFrom(dates.slice(0, 70), flatCloses(70, 90)) }, // stopped trading 10 sessions ago
  { symbol: "BONUS", bars: withLastBar(400, { o: 0.5, h: 0.51, l: 0.49, c: 0.5 }) }, // 1:1 bonus ex-date, unadjusted
  { symbol: "NEWLY", bars: barsFrom(dates.slice(79), [120]) }, // first bar ever today
];
const ds = buildDataset(bench, stocks);
const activity = Object.fromEntries(stocks.map((s) => [s.symbol, activityFor(s.bars.map((b) => b.date))]));

describe("candidate discovery", () => {
  const u = prepareUniverse(ds, activity);
  const result = discover(u, last, DEFAULT_SETTINGS, "sideways", 20);

  it("ranks gainers by largest positive change and losers by largest negative change", () => {
    expect(result.gainers.map((c) => c.symbol)).toEqual(["UPA", "UPB", "UPC", "FLAT"]);
    expect(result.gainers.map((c) => c.rank)).toEqual([1, 2, 3, 4]);
    expect(result.gainers[0].price.dailyChangePct).toBeCloseTo(8, 6);
    expect(result.losers.map((c) => c.symbol)).toEqual(["DNA"]);
    expect(result.losers[0].price.dailyChangePct).toBeCloseTo(-6, 6);
    expect(result.gainers.every((c) => c.price.dailyChangePct > 0)).toBe(true);
  });

  it("respects the list size", () => {
    expect(discover(u, last, DEFAULT_SETTINGS, "sideways", 2).gainers.map((c) => c.symbol)).toEqual(["UPA", "UPB"]);
  });

  it("never ranks a stock with no bar on the date (stale / suspended / not listed) and counts it", () => {
    expect([...result.gainers, ...result.losers].some((c) => c.symbol === "GONE")).toBe(false);
    expect(result.noSessionCount).toBe(1);
    expect(result.universeSize).toBe(stocks.length);
  });

  it("does not rank an unadjusted corporate-action day as a top loser; lists it as excluded with the reason", () => {
    expect(result.losers.some((c) => c.symbol === "BONUS")).toBe(false);
    const ex = result.excluded.find((e) => e.symbol === "BONUS");
    expect(ex?.reason).toBe("corporate-action-break");
    expect(ex?.rawChangePct).toBeCloseTo(-50, 6);
    expect(result.excluded.find((e) => e.symbol === "NEWLY")?.reason).toBe("first-bar-in-history");
    expect(result.eligibleCount).toBe(5);
  });

  it("labels every candidate with the session date its bars are for", () => {
    for (const c of [...result.gainers, ...result.losers]) expect(c.date).toBe(last);
    expect(result.date).toBe(last);
  });

  it("assigns size segment and group from current index membership", () => {
    expect(result.losers[0].segment).toBe("micro");
    expect(result.gainers[0].segment).toBe("large");
    expect(result.losers[0].group).toBe("loser");
  });

  it("uses only bars after an earlier price discontinuity, and says so", () => {
    const split = barsFrom(dates, flatCloses(80, 100)).map((b, i) => (i >= 40 ? { ...b, open: b.open / 2, high: b.high / 2, low: b.low / 2, close: b.close / 2 } : b));
    split[40] = { ...split[40], open: split[39].close / 2 };
    split[79] = { ...split[79], close: split[78].close * 1.1, high: split[78].close * 1.11 };
    const u2 = prepareUniverse(buildDataset(bench, [{ symbol: "SPLIT", bars: split }]), { SPLIT: activityFor(dates) });
    const c = discover(u2, last, DEFAULT_SETTINGS, "sideways").gainers[0];
    expect(c.symbol).toBe("SPLIT");
    expect(c.quality.barsUsed).toBe(40);
    expect(c.quality.usableFrom).toBe(dates[40]);
    expect(c.quality.status).toBe("limited");
    expect(c.quality.notes.join(" ")).toMatch(/suspected unadjusted split/);
    expect(c.price.distSma50Pct.available).toBe(false); // never computed across the split
    expect(c.label).toBe("insufficient-evidence"); // fewer than 50 comparable sessions
  });

  it("rankMovers is deterministic and excludes zero changes from both lists", () => {
    const m = (symbol: string, changePct: number) => ({ stock: { symbol }, changePct });
    const movers = [m("B", 2), m("A", 2), m("Z", 0), m("C", -1)];
    expect(rankMovers(movers, "gainer", 5).map((x) => x.stock.symbol)).toEqual(["A", "B"]);
    expect(rankMovers(movers, "loser", 5).map((x) => x.stock.symbol)).toEqual(["C"]);
  });

  it("moversOn and comparableBarsUpTo match validateBars' truncation", () => {
    const day = moversOn(u, last);
    const upa = day.movers.find((m) => m.stock.symbol === "UPA")!;
    expect(comparableBarsUpTo(upa.stock, upa.i)).toEqual(stocks[0].bars);
  });
});
