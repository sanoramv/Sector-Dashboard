import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import type { DailyBar } from "../../src/types/market";
import { computeActivityFeatures, computePatternContext, computePriceAction } from "../../src/lib/momentum/features";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { discover } from "../../src/lib/momentum/discovery";
import { breadthAt, indexContextAt } from "../../src/lib/momentum/market";
import { liquidityBucket, magnitudeBucket, runMomentumEvaluation } from "../../src/lib/momentum/evaluation";
import { filingsForSession } from "../../src/lib/momentum/news";
import { momentumFreshnessNotices } from "../../src/lib/momentum/freshness";
import type { AnnouncementsFile } from "../../src/types/announcements";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "./fixtures";

const dates = weekdays("2025-03-03", 90);

describe("candle structure, swing high, breakdown, zero volume, participation", () => {
  const prev: DailyBar = { date: dates[0], open: 99, high: 101, low: 98, close: 100 };

  it("splits the day's range into body and wicks", () => {
    const p = computePriceAction([prev, { date: dates[1], open: 102, high: 110, low: 100, close: 106 }]);
    expect(p.bodyShare).toBeCloseTo(0.4, 10);
    expect(p.upperWickShare).toBeCloseTo(0.4, 10);
    expect(p.lowerWickShare).toBeCloseTo(0.2, 10);
    expect(computePriceAction([prev, { date: dates[1], open: 100, high: 100, low: 100, close: 100 }]).bodyShare).toBeNull();
  });

  it("measures the close against the previous 20 sessions' highest high", () => {
    const bars = barsFrom(dates.slice(0, 21), flatCloses(21, 100));
    const swing = Math.max(...bars.slice(0, 20).map((b) => b.high));
    const p = computePriceAction(bars);
    expect(p.distFromSwingHigh20Pct.available && p.distFromSwingHigh20Pct.value).toBeCloseTo((bars[20].close / swing - 1) * 100, 10);
    expect(computePriceAction(bars.slice(1)).distFromSwingHigh20Pct.available).toBe(false);
  });

  it("detects a close below the prior 60-session low (the losers' mirror of a breakout)", () => {
    const flat = barsFrom(dates.slice(0, 70), flatCloses(70, 100));
    const low = Math.min(...flat.slice(-60).map((b) => b.low));
    expect(computePatternContext([...flat, { date: dates[70], open: 99, high: 99, low: low * 0.9, close: low * 0.95 }], DEFAULT_SETTINGS).breakdownToday).toBe(true);
    expect(computePatternContext([...flat, { date: dates[70], open: 99, high: 99, low: low * 0.9, close: low * 1.01 }], DEFAULT_SETTINGS).breakdownToday).toBe(false);
  });

  it("distinguishes zero volume (a row with no trades) from missing data", () => {
    const bars = barsFrom(dates.slice(0, 21), flatCloses(21));
    const rows = [...activityFor(dates.slice(0, 20)), { date: dates[20], volume: 0, turnoverLakhs: 0, deliveryPct: null, series: "EQ" as const }];
    const a = computeActivityFeatures(bars, new Map(rows.map((r) => [r.date, r])), true);
    expect(a.available).toBe(true);
    expect(a.zeroVolume).toBe(true);
    expect(a.relativeVolume.available && a.relativeVolume.value).toBe(0);
    expect(a.liquidityWarnings.join(" ")).toMatch(/zero volume - not missing data/);
  });

  it("measures participation in the 3 sessions before today against the 20 before those", () => {
    const bars = barsFrom(dates.slice(0, 25), flatCloses(25));
    const rows = dates.slice(0, 25).map((date, i) => ({ date, volume: i >= 21 && i <= 23 ? 50_000 : 100_000, turnoverLakhs: 100, deliveryPct: 50, series: "EQ" as const }));
    const a = computeActivityFeatures(bars, new Map(rows.map((r) => [r.date, r])), true);
    expect(a.priorParticipation.available && a.priorParticipation.value).toBeCloseTo(0.5, 10);
  });
});

describe("unusual-volume list, unchanged count, NIFTY 50 and sector context", () => {
  const n = 80;
  const d = dates.slice(0, n);
  const bench = barsFrom(d, flatCloses(n, 1000, 0.002));
  const lastMove = (level: number, pct: number) => {
    const b = barsFrom(d.slice(0, n - 1), flatCloses(n - 1, level));
    const p = b[n - 2].close;
    return [...b, { date: d[n - 1], open: p, high: Math.max(p, p * (1 + pct / 100)) * 1.001, low: Math.min(p, p * (1 + pct / 100)) * 0.999, close: p * (1 + pct / 100) }];
  };
  const stocks = [
    { symbol: "BIG", bars: lastMove(100, 8) },
    { symbol: "QUIET", bars: lastMove(100, 1) },
    { symbol: "FALL", bars: lastMove(100, -3) },
    { symbol: "SAME", bars: lastMove(100, 0) },
  ];
  const vol = (today: number) => [...activityFor(d.slice(0, n - 1), 100_000), { date: d[n - 1], volume: today, turnoverLakhs: 500, deliveryPct: 50, series: "EQ" as const }];
  const activity = { BIG: vol(150_000), QUIET: vol(600_000), FALL: vol(300_000), SAME: vol(900_000) };
  const sectorBars = barsFrom(d, flatCloses(n, 5000, 0.004));
  sectorBars[n - 1] = { ...sectorBars[n - 1], close: sectorBars[n - 2].close * 1.02, high: sectorBars[n - 2].close * 1.03 };
  const ds = buildDataset(bench, stocks, {
    indices: {
      it: { nseIndexName: "Nifty IT", bars: sectorBars, constituents: ["BIG", "QUIET", "OUTSIDER"] },
      nifty50: { nseIndexName: "Nifty 50", bars: barsFrom(d, flatCloses(n, 2000, 0.003)) },
    },
  });
  ds.stocks.OUTSIDER = { symbol: "OUTSIDER", bars: barsFrom(d, flatCloses(n, 50)) }; // sector constituent outside the ranking universe
  const u = prepareUniverse(ds, activity);
  const r = discover(u, d[n - 1], DEFAULT_SETTINGS, "sideways", 10);

  it("ranks unusual volume by relative volume in either direction, excluding unchanged stocks", () => {
    expect(r.volumeMovers.map((c) => [c.symbol, c.group])).toEqual([
      ["QUIET", "gainer"],
      ["FALL", "loser"],
      ["BIG", "gainer"],
    ]);
    expect(r.unchangedCount).toBe(1);
    expect(r.gainers.some((c) => c.symbol === "SAME") || r.losers.some((c) => c.symbol === "SAME")).toBe(false);
  });

  it("adds the stock's sector index (change, RS, breadth) and NIFTY 50 as of the date", () => {
    const big = r.gainers.find((c) => c.symbol === "BIG")!;
    expect(big.context.sectorIndex?.slug).toBe("it");
    expect(big.context.sectorIndex?.changePct.available && big.context.sectorIndex.changePct.value).toBeCloseTo(2, 8);
    expect(big.context.stockVsSectorIndexPp).toBeCloseTo(6, 8);
    expect(big.context.sectorIndex?.breadth50?.total).toBe(3); // includes the sector constituent outside the ranking universe
    expect(big.context.nifty50?.slug).toBe("nifty50");
    expect(r.losers.find((c) => c.symbol === "FALL")!.context.sectorIndex).toBeNull();
    expect(u.stocks.some((s) => s.symbol === "OUTSIDER")).toBe(false); // never ranked
  });

  it("index context uses only bars up to the date", () => {
    const at = indexContextAt(u, u.indices.get("it")!, d[n - 2]);
    const changed = { ...ds, indexSeries: { ...ds.indexSeries, it: { ...ds.indexSeries.it, bars: ds.indexSeries.it.bars.map((b, i) => (i === n - 1 ? { ...b, close: b.close * 5 } : b)) } } };
    expect(indexContextAt(prepareUniverse(changed, activity), prepareUniverse(changed, activity).indices.get("it")!, d[n - 2])).toEqual(at);
    expect(breadthAt(u, ["BIG", "NOT-A-STOCK"], d[n - 1]).above50dma.total).toBe(1);
  });
});

describe("evaluation segments and classification metrics", () => {
  it("buckets liquidity and move size", () => {
    expect([null, 0.5, 5, 50, 500].map(liquidityBucket)).toEqual(["unknown", "under 1 cr", "1-10 cr", "10-100 cr", "100 cr+"]);
    expect([2, -4, 7, -12].map(magnitudeBucket)).toEqual(["under 3%", "3-5%", "5-10%", "10%+"]);
  });

  it("computes precision, recall and lift against the group base rate", () => {
    let x = 11;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const d = dates.slice(0, 90);
    const stocks = Array.from({ length: 24 }, (_, k) => {
      let c = 100 + k;
      return { symbol: `S${k}`, bars: barsFrom(d, d.map(() => (c *= 1 + (rnd() - 0.5) * 0.08))) };
    });
    const r = runMomentumEvaluation(prepareUniverse(buildDataset(barsFrom(d, flatCloses(90, 1000, 0.002)), stocks), Object.fromEntries(stocks.map((s) => [s.symbol, activityFor(d)]))), DEFAULT_SETTINGS, {
      topN: 5,
      costBps: 20,
    });
    expect(r.classification).toHaveLength(4);
    for (const m of r.classification) {
      const mine = r.observations.filter((o) => o.group === m.group);
      const dir = m.group === "gainer" ? 1 : -1;
      const hit = (o: (typeof mine)[number]) => (m.target === "continued" ? o.outcome.closeToClosePct * dir > 0 : o.outcome.closeToClosePct * dir < 0);
      const predicted = mine.filter((o) => o.category === m.category);
      expect(m.predicted).toBe(predicted.length);
      expect(m.baseRate).toBeCloseTo((mine.filter(hit).length / mine.length) * 100, 10);
      if (predicted.length > 0) {
        expect(m.precision).toBeCloseTo((predicted.filter(hit).length / predicted.length) * 100, 10);
        expect(m.liftPp).toBeCloseTo((m.precision as number) - m.baseRate, 10);
      }
    }
    expect(r.firstAppearanceOnly.every((f) => (f.stats?.repeatShare ?? 0) === 0)).toBe(true);
    expect(r.byLiquidity.length).toBeGreaterThan(0);
    expect(r.walkForwardCategory).toHaveLength(2);
  });
});

describe("news relevance, follow-ups and duplicates", () => {
  const item = (id: string, publishedAt: string, category: "results" | "orders-contracts" = "results") => ({
    id,
    symbol: "ROUTE",
    company: "ROUTE MOBILE LIMITED",
    subject: category === "results" ? "Outcome of Board Meeting" : "Bagging/Receiving of orders/contracts",
    description: "",
    url: `https://nsearchives.nseindia.com/corporate/ROUTE_${id}.pdf`,
    publishedAt,
    category,
    matchedBy: "filing-link-symbol" as const,
  });
  const file: AnnouncementsFile = {
    schemaVersion: 1,
    source: { name: "t", feedUrl: "t" },
    retentionDays: 30,
    checks: [{ checkedAt: "2026-10-28T06:00:00Z", outcome: "ok", oldestInFeed: "2026-10-20T00:00:00+05:30" }],
    items: [item("old", "2026-10-21T18:00:00+05:30"), item("new", "2026-10-27T13:00:00+05:30"), item("order", "2026-10-27T14:00:00+05:30", "orders-contracts")],
  };

  it("explains why a category can matter and flags an earlier same-type filing as a possible follow-up", () => {
    const r = filingsForSession(file, "ROUTE", "2026-10-27", "2026-10-26", "2026-10-28", new Date("2026-10-28T12:00:00+05:30"));
    const results = r.filings.find((f) => f.id === "new")!;
    expect(results.relevance).toMatch(/differed from expectations/);
    expect(results.followUpOf?.publishedAt).toBe("2026-10-21T18:00:00+05:30");
    expect(r.filings.find((f) => f.id === "order")!.followUpOf).toBeNull();
  });
});

describe("supplement freshness notices", () => {
  const d = weekdays("2026-08-03", 60);
  const ds = buildDataset(barsFrom(d, flatCloses(60, 1000)), []);
  const loaded = { activity: "ok" as const, announcements: "ok" as const };
  it("warns when volume data lags prices and when the latest filings read failed", () => {
    const m = {
      ...ds.manifest,
      supplements: {
        activity: { latestDate: d[57], sessions: 50 },
        announcements: { lastSuccessfulReadAt: "2026-10-26T14:00:00Z", lastAttemptAt: "2026-10-27T14:00:00Z", lastAttemptOutcome: "failed" as const, lastAttemptDetail: "timeout: no response", retainedItems: 3, retentionDays: 30 },
      },
    };
    const text = momentumFreshnessNotices(m, d[59], d[59], "live", loaded).map((n) => n.text).join(" ");
    expect(text).toMatch(new RegExp(`Volume data ends ${d[57]}`));
    expect(text).toMatch(/latest filings-feed read failed \(timeout: no response\); last successful read 2026-10-26T14:00:00Z/);
  });
});
