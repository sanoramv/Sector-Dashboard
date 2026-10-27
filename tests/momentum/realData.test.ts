import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { RawDataset } from "../../src/types/dataset";
import type { StockActivityFile } from "../../src/types/activity";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { buildDashboardData } from "../../src/lib/dashboard";
import { decodeAllActivity } from "../../src/lib/activity";
import { prepareUniverse, comparableBarsUpTo } from "../../src/lib/momentum/universe";
import { indexContextAt, marketContextAt } from "../../src/lib/momentum/market";
import { discover } from "../../src/lib/momentum/discovery";

/**
 * Consistency checks on the committed public/data: the momentum page must
 * agree exactly with the rest of the dashboard on the latest session, and
 * the activity file must line up with the price bars. Holds for any dataset
 * date, so it keeps guarding after every scheduled update.
 */
const read = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../public/data", f), "utf-8"));
const ds: RawDataset = { manifest: read("manifest.json"), indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") };
const activity = decodeAllActivity(read("stock-activity.json") as StockActivityFile);
const u = prepareUniverse(ds, activity);
const dash = buildDashboardData(ds, DEFAULT_SETTINGS);
const latest = u.calendar[u.calendar.length - 1];

describe("Next-Day Momentum agrees with the dashboard (real committed data)", () => {
  it("covers the NIFTY 500 + Microcap 250 universe on the dashboard's latest market date", () => {
    expect(latest).toBe(ds.manifest.latestMarketDate);
    expect(u.stocks.length).toBe(new Set([...ds.constituents.nifty500.constituents, ...ds.constituents.microcap250.constituents].map((c) => c.symbol)).size);
  });

  it("uses exactly the screener's comparable bars, 52-week distance and resistance for every NIFTY 500 stock", () => {
    let compared = 0;
    for (const s of dash.stockScreen) {
      const stock = u.bySymbol.get(s.symbol)!;
      const i = stock.indexByDate.get(latest);
      if (i === undefined || s.priceIntegrity.state === "stale" || s.priceIntegrity.state === "no-data") continue;
      expect(comparableBarsUpTo(stock, i)).toEqual(s.priceSeries);
      compared += 1;
    }
    expect(compared).toBeGreaterThan(450);
  });

  it("computes the same NIFTY 500 regime and breadth as the dashboard's NIFTY 500 panel", () => {
    const panel = dash.marketCapSegments.find((m) => m.isSelfBenchmark)!.metrics;
    const mine = marketContextAt(u, latest, DEFAULT_SETTINGS);
    expect(mine.regime.regime).toBe(panel.regime.regime);
    for (const k of ["above20dma", "above50dma", "above200dma"] as const) {
      expect(mine.breadth[k].eligible).toBe(panel.breadth[k].eligible);
      const a = mine.breadth[k].pct;
      const b = panel.breadth[k].pct;
      expect(a.available).toBe(b.available);
      if (a.available && b.available) expect(a.value).toBeCloseTo(b.value, 10);
    }
  });

  it("sector-index 50-DMA breadth matches the dashboard's sector table for every tracked sector", () => {
    for (const sector of dash.sectors) {
      const index = u.indices.get(sector.slug);
      if (!index || !sector.latestDate.available) continue;
      const mine = indexContextAt(u, index, sector.latestDate.value).breadth50!;
      expect(mine.eligible).toBe(sector.breadth.above50dma.eligible);
      expect(mine.total).toBe(sector.breadth.above50dma.total);
      const a = mine.pct;
      const b = sector.breadth.above50dma.pct;
      expect(a.available).toBe(b.available);
      if (a.available && b.available) expect(a.value).toBeCloseTo(b.value, 10);
    }
  });

  it("has NIFTY 50 for the latest session, from the same official index file", () => {
    const n50 = u.indices.get("nifty50");
    expect(n50?.bars.at(-1)?.date).toBe(latest);
    expect(indexContextAt(u, n50!, latest).changePct.available).toBe(true);
  });

  it("features of each latest-session candidate match the screener's for the same stock", () => {
    const r = discover(u, latest, DEFAULT_SETTINGS, "sideways");
    expect(r.gainers.length).toBeGreaterThan(0);
    const bySymbol = new Map(dash.stockScreen.map((s) => [s.symbol, s]));
    for (const c of [...r.gainers, ...r.losers]) {
      expect(c.date).toBe(latest);
      const s = bySymbol.get(c.symbol);
      if (!s) continue; // microcaps are not in the NIFTY 500 screener
      expect(c.price.distanceFrom52wHigh).toEqual(s.distanceFrom52wHigh);
      expect(c.patterns.resistance).toEqual(s.resistance);
      if (s.returns.d1.available) expect(c.price.dailyChangePct).toBeCloseTo(s.returns.d1.value, 10);
    }
  });
});

describe("stock-activity.json lines up with stocks.json", () => {
  it("every activity row has a price bar on the same date, with non-negative volume and valid delivery %", () => {
    let rows = 0;
    for (const [symbol, list] of Object.entries(activity)) {
      const dates = new Set(ds.stocks[symbol]?.bars.map((b) => b.date));
      for (const r of list) {
        expect(dates.has(r.date)).toBe(true);
        expect(r.volume).toBeGreaterThanOrEqual(0);
        expect(r.turnoverLakhs).toBeGreaterThanOrEqual(0);
        if (r.deliveryPct !== null) expect(r.deliveryPct).toBeGreaterThanOrEqual(0);
        if (r.deliveryPct !== null) expect(r.deliveryPct).toBeLessThanOrEqual(100);
        rows += 1;
      }
    }
    expect(rows).toBeGreaterThan(100_000);
  });

  it("has volume for the latest session for most of the universe", () => {
    const withToday = u.stocks.filter((s) => s.indexByDate.has(latest) && s.activityByDate.has(latest)).length;
    const traded = u.stocks.filter((s) => s.indexByDate.has(latest)).length;
    expect(withToday).toBe(traded);
  });
});
