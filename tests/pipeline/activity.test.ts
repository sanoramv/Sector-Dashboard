import { describe, it, expect } from "vitest";
import { decodeAllActivity, decodeSymbolActivity, encodeActivity, parseActivityColumns } from "../../src/lib/activity";
import type { ActivityRow } from "../../src/types/activity";
import { ingestStockOutcome } from "../../scripts/lib/ingest.mts";
import { emptyState, symbolSetHash } from "../../scripts/lib/refresh-state.mts";
import type { ArchiveOutcome } from "../../scripts/lib/http.mts";
import type { StockSeries } from "../../src/types/market";
import { STOCK_HEADER, stockCsv } from "./fixtures";

const row = (date: string, volume: number, series: ActivityRow["series"] = "EQ"): ActivityRow => ({ date, volume, turnoverLakhs: volume / 1000, deliveryPct: 50, series });

describe("stock-activity.json encoding", () => {
  it("round-trips, sorts by date, and lets a later row for the same date win", () => {
    const file = encodeActivity({ A: [row("2026-10-23", 5), row("2026-10-22", 4), row("2026-10-23", 6, "BE")], B: [row("2026-10-21", 1)] });
    expect(file.dates).toEqual(["2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(decodeAllActivity(file)).toEqual({ A: [row("2026-10-22", 4), row("2026-10-23", 6, "BE")], B: [row("2026-10-21", 1)] });
    expect(decodeSymbolActivity(file, "MISSING")).toEqual([]);
  });

  it("throws on a malformed entry instead of guessing", () => {
    const file = encodeActivity({ A: [row("2026-10-22", 4)] });
    file.symbols.A.v.push(1);
    expect(() => decodeSymbolActivity(file, "A")).toThrow(/column lengths/);
  });

  it("parses NSE's activity columns; '-' delivery is null; invalid volume is rejected, never zero", () => {
    expect(parseActivityColumns("2026-10-23", "EQ", " 458735", " 28237.09", " 25.92")).toEqual({ date: "2026-10-23", volume: 458735, turnoverLakhs: 28237.09, deliveryPct: 25.92, series: "EQ" });
    expect(parseActivityColumns("2026-10-23", "BE", "10", "1.5", " -")?.deliveryPct).toBeNull();
    expect(parseActivityColumns("2026-10-23", "EQ", "", "1", "1")).toBeNull();
    expect(parseActivityColumns("2026-10-23", "EQ", "abc", "1", "1")).toBeNull();
    expect(parseActivityColumns("2026-10-23", "XX", "1", "1", "1")).toBeNull();
  });
});

describe("activity ingestion from the bhavcopy", () => {
  const ok = (text: string): ArchiveOutcome => ({ kind: "ok", text, status: 200, attempts: 1, elapsedMs: 5 });
  const ctx = (activity: Record<string, ActivityRow[]>, expected = 3) => ({
    requiredSymbols: new Set(["RELIANCE", "HFCL", "SCHNEIDER"]),
    trackedSeries: new Set(["EQ", "RR", "BE", "BZ"]),
    symbolSetHash: "h",
    expectedSymbols: expected,
    minCoverage: 0.8,
    checkedAt: "t",
    activity,
    activitySkipped: { count: 0 },
  });

  it("records activity from the same rows as the bars, including BE (trade-for-trade) rows", () => {
    const stocks: Record<string, StockSeries> = {};
    const activity: Record<string, ActivityRow[]> = {};
    const csv = stockCsv("2026-10-23", [{ symbol: "RELIANCE" }, { symbol: "HFCL", series: "BE" }, { symbol: "SCHNEIDER" }]);
    ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok(csv), ctx(activity));
    expect(Object.keys(activity).sort()).toEqual(["HFCL", "RELIANCE", "SCHNEIDER"]);
    expect(activity.HFCL[0]).toEqual({ date: "2026-10-23", volume: 1000, turnoverLakhs: 10, deliveryPct: 50, series: "BE" });
    expect(stocks.HFCL.bars[0].date).toBe(activity.HFCL[0].date);
  });

  it("adds no activity from a file rejected as incomplete", () => {
    const activity: Record<string, ActivityRow[]> = {};
    const entry = ingestStockOutcome({}, emptyState(), "2026-10-23", ok(stockCsv("2026-10-23", [{ symbol: "RELIANCE" }])), ctx(activity, 100));
    expect(entry.status).toBe("incomplete");
    expect(activity).toEqual({});
  });

  it("keeps the bar but records no activity when the activity columns are unparseable", () => {
    const stocks: Record<string, StockSeries> = {};
    const activity: Record<string, ActivityRow[]> = {};
    const c = ctx(activity);
    const lines = stockCsv("2026-10-23", [{ symbol: "RELIANCE" }, { symbol: "HFCL" }, { symbol: "SCHNEIDER" }]).split("\n");
    lines[1] = lines[1].replace(", 1000, 10.00,", ", , 10.00,");
    ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok([STOCK_HEADER, ...lines.slice(1)].join("\n")), c);
    expect(stocks.RELIANCE.bars).toHaveLength(1);
    expect(activity.RELIANCE).toBeUndefined();
    expect(c.activitySkipped.count).toBe(1);
  });

  it("the refresh-state hash changes when extracted fields change, and is unchanged without a fields tag", () => {
    const before = symbolSetHash(["A", "B"], ["EQ"]);
    expect(symbolSetHash(["A", "B"], ["EQ"], "")).toBe(before);
    expect(symbolSetHash(["A", "B"], ["EQ"], "ohlc+activity-v1")).not.toBe(before);
  });
});
