/**
 * Deterministic synthetic market for the Next-Day Momentum tests: weekday
 * sessions, a NIFTY 500 benchmark, and stocks whose bars and activity rows
 * are built explicitly so every expected value can be worked out by hand.
 */
import type { DailyBar } from "../../src/types/market";
import type { RawDataset } from "../../src/types/dataset";
import type { ActivityRow, ActivitySeries } from "../../src/types/activity";
import { SCHEMA_VERSION } from "../../src/types/dataset";

export function weekdays(start: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Bars on `dates` with closes following `closes`; high/low 1% around max/min(open, close); open = previous close. */
export function barsFrom(dates: string[], closes: number[]): DailyBar[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return { date: dates[i], open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close };
  });
}

/** A gently oscillating series around `level` (no big moves, no breaks). */
export function flatCloses(n: number, level = 100, amp = 0.01): number[] {
  return Array.from({ length: n }, (_, i) => level * (1 + amp * Math.sin(i / 2)));
}

export function activityFor(dates: string[], volume = 100_000, opts: { turnoverLakhs?: number; deliveryPct?: number | null; series?: ActivitySeries } = {}): ActivityRow[] {
  return dates.map((date) => ({
    date,
    volume,
    turnoverLakhs: opts.turnoverLakhs ?? 500,
    deliveryPct: opts.deliveryPct === undefined ? 50 : opts.deliveryPct,
    series: opts.series ?? "EQ",
  }));
}

export interface FixtureStock {
  symbol: string;
  bars: DailyBar[];
  industry?: string;
  list?: "nifty500" | "microcap250";
  segment?: "midcap150" | "smallcap250";
}

export function buildDataset(
  benchmark: DailyBar[],
  stocks: FixtureStock[],
  extra: { indices?: Record<string, { nseIndexName: string; bars: DailyBar[]; constituents?: string[] }> } = {},
): RawDataset {
  const listOf = (slug: string) =>
    stocks
      .filter((s) => (s.list ?? "nifty500") === slug || s.segment === slug)
      .map((s) => ({ symbol: s.symbol, companyName: `${s.symbol} Ltd.`, industry: s.industry ?? "Capital Goods" }));
  const fetchedAt = "2026-10-09T20:10:35.187Z";
  return {
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: "2026-10-27T18:00:00Z",
      latestMarketDate: benchmark[benchmark.length - 1].date,
      source: { name: "test", indexDataUrl: "", constituentDataUrl: "", equityDataUrl: "" },
      sectors: [],
      benchmark: "nifty500",
      warnings: [],
      refresh: {
        outcome: "complete",
        evaluatedAt: "2026-10-27T18:00:00Z",
        lastCompleteRefreshAt: "2026-10-27T18:00:00Z",
        latestDueDate: benchmark[benchmark.length - 1].date,
        tradingDaysBehind: 0,
        reasons: [],
      },
    },
    indexSeries: {
      nifty500: { slug: "nifty500", nseIndexName: "Nifty 500", bars: benchmark },
      ...Object.fromEntries(Object.entries(extra.indices ?? {}).map(([slug, x]) => [slug, { slug, nseIndexName: x.nseIndexName, bars: x.bars }])),
    },
    constituents: {
      ...Object.fromEntries(["nifty500", "microcap250", "midcap150", "smallcap250"].map((slug) => [slug, { slug, constituents: listOf(slug), fetchedAt }])),
      ...Object.fromEntries(
        Object.entries(extra.indices ?? {})
          .filter(([, x]) => x.constituents)
          .map(([slug, x]) => [slug, { slug, constituents: (x.constituents ?? []).map((symbol) => ({ symbol, companyName: `${symbol} Ltd.`, industry: "Information Technology" })), fetchedAt }]),
      ),
    },
    stocks: Object.fromEntries(stocks.map((s) => [s.symbol, { symbol: s.symbol, bars: s.bars }])),
  };
}
