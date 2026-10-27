import { describe, it, expect } from "vitest";
import { emptyState, evaluateRefresh, indexSetHash, planFetch, targetDates } from "../../scripts/lib/refresh-state.mts";
import { finalizeBars, ingestIndexOutcome, ingestStockOutcome } from "../../scripts/lib/ingest.mts";
import { ALL_INDEX_DEFS, INDEX_SET_HASH } from "../../scripts/lib/index-defs.mts";
import { summarizeSupplements } from "../../scripts/lib/supplements.mts";
import { appendChanges, diffConstituents } from "../../scripts/lib/constituent-changes.mts";
import { emptyAnnouncementsFile, matchItems, mergeAnnouncements, parseFeed } from "../../scripts/lib/announcements.mts";
import { encodeActivity } from "../../src/lib/activity";
import type { ArchiveOutcome } from "../../scripts/lib/http.mts";
import type { IndexSeries, SectorConstituents, StockSeries } from "../../src/types/market";
import type { ActivityRow } from "../../src/types/activity";
import { indexCsv, stockCsv } from "./fixtures";

const ok = (text: string): ArchiveOutcome => ({ kind: "ok", text, status: 200, attempts: 1, elapsedMs: 5 });

describe("adding a tracked index (NIFTY 50) re-extracts history in bounded batches", () => {
  const now = new Date("2026-10-28T14:00:00Z");
  const targets = targetDates(now, 60);

  it("tracks NIFTY 50 among the extracted index series", () => {
    expect(ALL_INDEX_DEFS.map((d) => d.nseIndexName)).toContain("Nifty 50");
    expect(INDEX_SET_HASH).toBe(indexSetHash(ALL_INDEX_DEFS.map((d) => d.nseIndexName)));
  });

  it("re-fetches older OK index dates extracted for a different index set, at most maxBackfill per run", () => {
    const state = emptyState();
    for (const d of targets) state.archives.index[d] = { status: "ok", checkedAt: "t" }; // pre-NIFTY-50 entries carry no hash
    const plan = planFetch("index", targets, state, { maxBackfill: 10, currentSymbolSetHash: "new" });
    expect(plan.backfill).toHaveLength(10);
    expect(plan.deferred).toBe(targets.length - 5 - 10);
    expect(planFetch("index", targets, state, { maxBackfill: 10 }).backfill).toHaveLength(0); // no hash given -> unchanged behaviour
  });

  it("records the index set on OK entries, keeps NIFTY 50, and is idempotent", () => {
    const series: Record<string, IndexSeries> = {};
    const state = emptyState();
    const csv = indexCsv("2026-10-23").replace("Nifty Auto,", "Nifty 50,23-10-2026,22708.8,22829.75,22636.85,22749.75,-3.45,-.02,1,1,1,1,1\nNifty Auto,");
    const ctx = { defs: [{ slug: "nifty500", nseIndexName: "Nifty 500" }, { slug: "nifty50", nseIndexName: "Nifty 50" }], benchmarkIndexName: "Nifty 500", checkedAt: "t", indexSetHash: "set1" };
    ingestIndexOutcome(series, state, "2026-10-23", ok(csv), ctx);
    expect(state.archives.index["2026-10-23"].symbolSetHash).toBe("set1");
    expect(series.nifty50.bars).toEqual([{ date: "2026-10-23", open: 22708.8, high: 22829.75, low: 22636.85, close: 22749.75 }]);
    const once = JSON.stringify(finalizeBars(series.nifty50.bars, "2026-01-01"));
    ingestIndexOutcome(series, state, "2026-10-23", ok(csv), ctx); // the same file again
    expect(JSON.stringify(finalizeBars(series.nifty50.bars, "2026-01-01"))).toBe(once);
  });

  it("reports index re-extraction as backfill remaining (partial), never as failed", () => {
    const state = emptyState();
    for (const d of targets) {
      state.archives.index[d] = { status: "ok", checkedAt: "t", symbolSetHash: d < targets[10] ? "old" : "cur" };
      state.archives.stocks[d] = { status: "ok", checkedAt: "t", symbolSetHash: "h" };
    }
    const r = evaluateRefresh(state, targets, targets[0], "h", now, "cur");
    expect(r.outcome).toBe("partial");
    expect(r.backfillRemaining).toBe(targets.filter((d) => d < targets[10]).length);
    expect(evaluateRefresh(state, targets, targets[0], "h", now).outcome).toBe("complete"); // without an index hash: as before
  });
});

describe("idempotent incremental updates", () => {
  it("ingesting the same bhavcopy twice yields the same bars and activity", () => {
    const stocks: Record<string, StockSeries> = {};
    const activity: Record<string, ActivityRow[]> = {};
    const csv = stockCsv("2026-10-23", [{ symbol: "RELIANCE" }, { symbol: "HFCL", series: "BE" }]);
    const ctx = { requiredSymbols: new Set(["RELIANCE", "HFCL"]), trackedSeries: new Set(["EQ", "BE"]), symbolSetHash: "h", expectedSymbols: 2, minCoverage: 0.8, checkedAt: "t", activity };
    ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok(csv), ctx);
    const first = { bars: finalizeBars(stocks.RELIANCE.bars, "2026-01-01"), act: JSON.stringify(encodeActivity(activity)) };
    ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok(csv), ctx);
    expect(finalizeBars(stocks.RELIANCE.bars, "2026-01-01")).toEqual(first.bars);
    expect(JSON.stringify(encodeActivity(activity))).toBe(first.act);
  });

  it("re-reading the same announcements feed adds no duplicates", () => {
    const feed = `<rss version="2.0"><channel><item><title>ROUTE MOBILE LIMITED</title><link>https://nsearchives.nseindia.com/corporate/ROUTE_1.pdf</link><description>x |SUBJECT: Outcome of Board Meeting</description><pubDate>27-Oct-2026 23:53:39</pubDate></item></channel></rss>`;
    const matched = matchItems(parseFeed(feed), [{ symbol: "ROUTE", companyName: "Route Mobile Ltd." }]).matched;
    const now = new Date("2026-10-28T00:00:00Z");
    const once = mergeAnnouncements(emptyAnnouncementsFile(), matched, { checkedAt: "2026-10-28T00:00:00Z", outcome: "ok" }, now);
    const twice = mergeAnnouncements(once, matched, { checkedAt: "2026-10-28T00:05:00Z", outcome: "ok" }, now);
    expect(twice.items).toEqual(once.items);
    expect(twice.checks).toHaveLength(2);
  });
});

describe("per-source status in the manifest", () => {
  it("summarises volume and filings freshness, and reports missing files as unavailable (null)", () => {
    const activity = encodeActivity({ A: [{ date: "2026-10-27", volume: 1, turnoverLakhs: 1, deliveryPct: 1, series: "EQ" }] });
    const ann = {
      ...emptyAnnouncementsFile(),
      checks: [
        { checkedAt: "2026-10-28T02:30:00Z", outcome: "failed" as const, detail: "timeout: no response" },
        { checkedAt: "2026-10-27T14:30:00Z", outcome: "ok" as const },
      ],
    };
    expect(summarizeSupplements(activity, ann)).toEqual({
      activity: { latestDate: "2026-10-27", sessions: 1 },
      announcements: {
        lastSuccessfulReadAt: "2026-10-27T14:30:00Z",
        lastAttemptAt: "2026-10-28T02:30:00Z",
        lastAttemptOutcome: "failed",
        lastAttemptDetail: "timeout: no response",
        retainedItems: 0,
        retentionDays: 30,
      },
    });
    expect(summarizeSupplements(null, null)).toEqual({ activity: null, announcements: null });
  });
});

describe("constituent membership change log", () => {
  const list = (symbols: string[], fetchedAt: string): SectorConstituents => ({
    slug: "nifty500",
    fetchedAt,
    constituents: symbols.map((symbol) => ({ symbol, companyName: symbol, industry: "x" })),
  });

  it("records additions and removals between fetches with both fetch times (no invented effective date)", () => {
    const changes = diffConstituents({ nifty500: list(["A", "B", "ICICIPRULI"], "2026-10-09T20:10:35Z") }, { nifty500: list(["A", "B", "ICICILIFE"], "2026-10-28T10:00:00Z") }, "2026-10-28T10:00:00Z");
    expect(changes).toEqual([{ list: "nifty500", detectedAt: "2026-10-28T10:00:00Z", previousFetchedAt: "2026-10-09T20:10:35Z", added: ["ICICILIFE"], removed: ["ICICIPRULI"] }]);
    const log = appendChanges(null, changes, "2026-10-09T20:10:35Z");
    expect(log.trackingSince).toBe("2026-10-09T20:10:35Z");
    expect(log.note).toMatch(/publishes no effective dates/);
    expect(appendChanges(log, [], "ignored")).toEqual(log); // a re-run with no differences changes nothing
  });

  it("does not treat a newly tracked list, or an unchanged list, as a membership change", () => {
    expect(diffConstituents({}, { nifty500: list(["A"], "t2") }, "t2")).toEqual([]);
    expect(diffConstituents({ nifty500: list(["A"], "t1") }, { nifty500: list(["A"], "t2") }, "t2")).toEqual([]);
  });
});
