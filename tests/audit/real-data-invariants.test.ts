import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDashboardData } from "../../src/lib/dashboard";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { isStale, splitAtPriceBreaks, validateBars } from "../../src/lib/calculations/validation";
import { groupSymbolsByIndustry } from "../../src/lib/calculations/industry";
import type { RawDataset } from "../../src/types/dataset";

/**
 * Data-contract tests on the actual committed public/data (whatever date it is):
 * stale or discontinuous stock prices must never feed a ranking, breadth count,
 * industry average or pattern as if they were current and comparable. These hold
 * for any dataset, so they keep guarding after every scheduled data update.
 */
function loadDataset(): RawDataset {
  const read = (f: string) => JSON.parse(readFileSync(path.resolve(__dirname, "../../public/data", f), "utf-8"));
  return { manifest: read("manifest.json"), indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") };
}

describe("stale and discontinuous prices cannot leak into results (real committed data)", () => {
  const ds = loadDataset();
  const dash = buildDashboardData(ds, DEFAULT_SETTINGS);
  const benchBars = validateBars(ds.indexSeries.nifty500.bars).bars;
  const calendar = benchBars.map((b) => b.date);
  const marketDate = calendar[calendar.length - 1];
  const lastDate = (sym: string) => ds.stocks[sym]?.bars.at(-1)?.date;
  const staleSymbols = new Set(
    Object.keys(ds.stocks).filter((s) => {
      const d = lastDate(s);
      return d !== undefined && isStale(d, marketDate);
    }),
  );

  it("every stale stock in the screener has no metrics and no score, so it cannot be ranked or pattern-matched", () => {
    for (const s of dash.stockScreen.filter((x) => staleSymbols.has(x.symbol))) {
      expect(s.priceIntegrity.state).toBe("stale");
      expect(s.score.pointsPossible).toBe(0);
      expect(s.returns.m1.available || s.returns.m3.available || s.distanceFrom52wHigh.available).toBe(false);
      expect(s.resistance.available || s.consolidation.available || s.triangle.available).toBe(false);
    }
  });

  it("every stock marked 'clean' really has no detected discontinuity in its history", () => {
    for (const s of dash.stockScreen.filter((x) => x.priceIntegrity.state === "clean")) {
      expect(splitAtPriceBreaks(ds.stocks[s.symbol].bars, calendar).breaks).toEqual([]);
    }
  });

  it("every 'post-discontinuity-only' stock's metrics start exactly at its latest discontinuity", () => {
    for (const s of dash.stockScreen.filter((x) => x.priceIntegrity.state === "post-discontinuity-only")) {
      const breaks = splitAtPriceBreaks(ds.stocks[s.symbol].bars, calendar).breaks;
      expect(s.priceSeries[0].date).toBe(breaks[breaks.length - 1].date);
    }
  });

  it("breadth never counts more stocks than have current prices", () => {
    for (const sector of [dash.benchmark, ...dash.sectors]) {
      const symbols = ds.constituents[sector.slug]?.constituents.map((c) => c.symbol) ?? [];
      const current = symbols.filter((sym) => lastDate(sym) !== undefined && !staleSymbols.has(sym)).length;
      expect(sector.breadth.above20dma.eligible).toBeLessThanOrEqual(current);
    }
  });

  it("industry averages never include a stale stock", () => {
    const groups = groupSymbolsByIndustry(ds.constituents.nifty500.constituents);
    for (const ind of dash.industries) {
      const current = (groups[ind.name] ?? []).filter((sym) => lastDate(sym) !== undefined && !staleSymbols.has(sym)).length;
      expect(ind.returnsSampleSize.d1).toBeLessThanOrEqual(current);
    }
  });

  it("no score counts a tentative triangle", () => {
    for (const s of dash.stockScreen) {
      if (s.triangle.available && s.triangle.value.confidence === "tentative") {
        expect(s.score.conditions.find((c) => c.id === "triangle-pattern")?.passed).toBe(false);
      }
    }
  });
});
