import { describe, it, expect } from "vitest";
import { interpretArchive, validateArchiveText } from "../../scripts/lib/archives.mts";
import { finalizeBars, ingestIndexOutcome, ingestStockOutcome, type StockIngestContext } from "../../scripts/lib/ingest.mts";
import {
  RECENT_DATES,
  emptyState,
  evaluateRefresh,
  planFetch,
  reconcileDate,
  symbolSetHash,
  targetDates,
  toRefreshStatus,
  type RefreshState,
} from "../../scripts/lib/refresh-state.mts";
import { refreshExitCode } from "../../scripts/check-refresh.mts";
import type { ArchiveOutcome } from "../../scripts/lib/http.mts";
import type { IndexSeries, StockSeries } from "../../src/types/market";
import { HTML_ERROR_PAGE, indexCsv, stockCsv } from "./fixtures";

const ok = (text: string): ArchiveOutcome => ({ kind: "ok", text, status: 200, attempts: 1, elapsedMs: 5 });
const notFound: ArchiveOutcome = { kind: "not-found", status: 404, attempts: 1, elapsedMs: 5 };
const timedOut: ArchiveOutcome = { kind: "failed", category: "timeout", detail: "no complete response", attempts: 4, elapsedMs: 194_000 };

describe("archive validation", () => {
  it("accepts real-format index and stock files", () => {
    expect(validateArchiveText("index", indexCsv("2026-10-23"))).toBeNull();
    expect(validateArchiveText("stocks", stockCsv("2026-10-23", [{ symbol: "RELIANCE" }]))).toBeNull();
  });

  it("rejects an HTML page, an empty body, a truncated file and a wrong header", () => {
    expect(validateArchiveText("index", HTML_ERROR_PAGE)).toMatch(/HTML/);
    expect(validateArchiveText("stocks", "")).toMatch(/empty/);
    expect(validateArchiveText("stocks", stockCsv("2026-10-23", [], 10))).toMatch(/only 10 data rows/);
    expect(validateArchiveText("index", "a,b,c\n1,2,3\n")).toMatch(/missing expected column/);
  });

  it("rejects a file that mixes session dates", () => {
    const mixed = indexCsv("2026-10-23") + "Nifty Odd,22-10-2026,1,1,1,1,0,0,1,1,1,1,1\n";
    expect(validateArchiveText("index", mixed)).toMatch(/mixes 2 session dates/);
  });

  it("recognises NSE's holiday behaviour: the bhavcopy URL serving the previous session", () => {
    // Real behaviour: requesting 2026-10-02 (holiday) returns DATE1 = 01-Oct-2026.
    expect(interpretArchive("stocks", stockCsv("2026-10-01", [{ symbol: "RELIANCE" }]), "2026-10-02")).toEqual({ kind: "earlier-session", fileDate: "2026-10-01" });
    expect(interpretArchive("index", indexCsv("2026-10-23"), "2026-10-23").kind).toBe("match");
  });
});

const series = (): Record<string, IndexSeries> => ({
  nifty500: { slug: "nifty500", nseIndexName: "Nifty 500", bars: [{ date: "2026-10-09", open: 1, high: 1, low: 1, close: 21866.65 }] },
});
const IDX = { defs: [{ slug: "nifty500", nseIndexName: "Nifty 500" }, { slug: "auto", nseIndexName: "Nifty Auto" }], benchmarkIndexName: "Nifty 500", checkedAt: "t" };

function stockCtx(over: Partial<StockIngestContext> = {}): StockIngestContext {
  return {
    requiredSymbols: new Set(["RELIANCE", "HFCL", "SCHNEIDER"]),
    trackedSeries: new Set(["EQ", "RR", "BE", "BZ"]),
    symbolSetHash: "h1",
    expectedSymbols: 3,
    minCoverage: 0.8,
    checkedAt: "t",
    ...over,
  };
}

describe("ingestion keeps good data when a refresh partially fails", () => {
  it("merges a valid index file for the requested date", () => {
    const s = series();
    const state = emptyState();
    const e = ingestIndexOutcome(s, state, "2026-10-23", ok(indexCsv("2026-10-23")), IDX);
    expect(e.status).toBe("ok");
    expect(s.nifty500.bars.map((b) => b.date)).toEqual(["2026-10-09", "2026-10-23"]);
    expect(s.auto.bars).toHaveLength(1);
  });

  it("a timeout, a 404 and an invalid file leave existing bars untouched and are recorded distinctly", () => {
    const s = series();
    const state = emptyState();
    expect(ingestIndexOutcome(s, state, "2026-10-22", timedOut, IDX).status).toBe("failed");
    expect(ingestIndexOutcome(s, state, "2026-10-21", notFound, IDX).status).toBe("missing");
    const invalid: ArchiveOutcome = { kind: "failed", category: "invalid-content", detail: "HTML page instead of CSV", attempts: 4, elapsedMs: 1 };
    expect(ingestIndexOutcome(s, state, "2026-10-20", invalid, IDX).status).toBe("invalid");
    expect(s.nifty500.bars).toEqual(series().nifty500.bars);
    expect(state.archives.index["2026-10-22"].detail).toMatch(/^timeout/);
  });

  it("an index file without the benchmark row is invalid and not merged", () => {
    const s = series();
    const e = ingestIndexOutcome(s, emptyState(), "2026-10-23", ok(indexCsv("2026-10-23", { includeNifty500: false })), IDX);
    expect(e.status).toBe("invalid");
    expect(s.nifty500.bars).toHaveLength(1);
    expect(s.auto).toBeUndefined();
  });

  it("keeps BE-series rows (HFCL trades in BE in the real 2026-10-23 bhavcopy)", () => {
    const stocks: Record<string, StockSeries> = {};
    const ctx = stockCtx({ rowsPerSeries: new Map() });
    const e = ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok(stockCsv("2026-10-23", [{ symbol: "RELIANCE" }, { symbol: "HFCL", series: "BE" }, { symbol: "SCHNEIDER" }])), ctx);
    expect(e.status).toBe("ok");
    expect(Object.keys(stocks).sort()).toEqual(["HFCL", "RELIANCE", "SCHNEIDER"]);
    expect(Object.fromEntries(ctx.rowsPerSeries!)).toEqual({ EQ: 2, BE: 1 });
  });

  it("does not merge a structurally valid file that lacks most tracked symbols", () => {
    const stocks: Record<string, StockSeries> = { RELIANCE: { symbol: "RELIANCE", bars: [{ date: "2026-10-09", open: 1, high: 1, low: 1, close: 1170.3 }] } };
    const e = ingestStockOutcome(stocks, emptyState(), "2026-10-23", ok(stockCsv("2026-10-23", [{ symbol: "RELIANCE" }])), stockCtx({ expectedSymbols: 500 }));
    expect(e.status).toBe("incomplete");
    expect(stocks.RELIANCE.bars).toHaveLength(1);
  });

  it("records a holiday's previous-session bhavcopy as earlier-session and merges nothing", () => {
    const stocks: Record<string, StockSeries> = {};
    const e = ingestStockOutcome(stocks, emptyState(), "2026-10-02", ok(stockCsv("2026-10-01", [{ symbol: "RELIANCE" }])), stockCtx());
    expect(e.status).toBe("earlier-session");
    expect(stocks).toEqual({});
  });

  it("finalizeBars dedupes (re-extracted rows win), prunes and sorts", () => {
    const bars = [
      { date: "2026-10-09", open: 1, high: 1, low: 1, close: 1 },
      { date: "2025-01-01", open: 1, high: 1, low: 1, close: 1 },
      { date: "2026-10-09", open: 2, high: 2, low: 2, close: 2 },
    ];
    expect(finalizeBars(bars, "2025-06-01")).toEqual([{ date: "2026-10-09", open: 2, high: 2, low: 2, close: 2 }]);
  });
});

describe("which dates are due", () => {
  it("excludes today before 19:00 IST and includes it after (GitHub cron is UTC)", () => {
    // 2026-10-26 is a Monday. 13:00 UTC = 18:30 IST: today's archives are not yet due.
    expect(targetDates(new Date("2026-10-26T13:00:00Z"), 10)[0]).toBe("2026-10-23");
    // 14:30 UTC = 20:00 IST: due.
    expect(targetDates(new Date("2026-10-26T14:30:00Z"), 10)[0]).toBe("2026-10-26");
  });

  it("skips weekends", () => {
    const d = targetDates(new Date("2026-10-26T14:30:00Z"), 7);
    expect(d).toEqual(["2026-10-26", "2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20"]);
  });
});

describe("fetch planning (no full re-download on every run)", () => {
  const targets = targetDates(new Date("2026-10-26T14:30:00Z"), 60);

  it("skips dates already downloaded OK and settled non-trading dates outside the recent window", () => {
    const state = emptyState();
    for (const d of targets) state.archives.index[d] = { status: "ok", checkedAt: "t" };
    state.archives.index["2026-10-02"] = { status: "missing", checkedAt: "t" };
    const plan = planFetch("index", targets, state, { maxBackfill: 40 });
    expect(plan).toEqual({ recent: [], backfill: [], deferred: 0 });
  });

  it("always re-checks unresolved recent dates, including a recent 404", () => {
    const state = emptyState();
    for (const d of targets) state.archives.index[d] = { status: "ok", checkedAt: "t" };
    state.archives.index["2026-10-26"] = { status: "missing", checkedAt: "t" };
    state.archives.index["2026-10-23"] = { status: "failed", checkedAt: "t" };
    expect(planFetch("index", targets, state, { maxBackfill: 40 }).recent).toEqual(["2026-10-26", "2026-10-23"]);
  });

  it("retries an old failed date, and bounds older re-extraction per run", () => {
    const state = emptyState();
    for (const d of targets) state.archives.stocks[d] = { status: "ok", checkedAt: "t", symbolSetHash: "old" };
    const plan = planFetch("stocks", targets, state, { maxBackfill: 10, currentSymbolSetHash: "new" });
    expect(plan.recent).toHaveLength(RECENT_DATES);
    expect(plan.backfill).toHaveLength(10);
    expect(plan.deferred).toBe(targets.length - RECENT_DATES - 10);
  });

  it("does not re-fetch stock dates just because some symbols (e.g. DUMMY placeholders) never have rows", () => {
    const state = emptyState();
    for (const d of targets) state.archives.stocks[d] = { status: "ok", checkedAt: "t", symbolSetHash: "same" };
    expect(planFetch("stocks", targets, state, { maxBackfill: 40, currentSymbolSetHash: "same" })).toEqual({ recent: [], backfill: [], deferred: 0 });
  });

  it("symbolSetHash changes when the tracked series or symbols change, and only then", () => {
    expect(symbolSetHash(["B", "A"], ["EQ"])).toBe(symbolSetHash(["A", "B"], ["EQ"]));
    expect(symbolSetHash(["A"], ["EQ", "BE"])).not.toBe(symbolSetHash(["A"], ["EQ"]));
  });
});

describe("reconciling a date: unexpected 404 vs non-trading day", () => {
  it("index 404 + bhavcopy serving the previous session = non-trading", () => {
    expect(reconcileDate({ status: "missing", checkedAt: "t" }, { status: "earlier-session", checkedAt: "t" }, false)).toBe("non-trading");
  });
  it("one archive present and the other 404 = unresolved (unexpected missing archive)", () => {
    expect(reconcileDate({ status: "ok", checkedAt: "t" }, { status: "missing", checkedAt: "t" }, false)).toBe("unresolved");
    expect(reconcileDate({ status: "missing", checkedAt: "t" }, { status: "ok", checkedAt: "t" }, false)).toBe("unresolved");
  });
  it("both 404 on the latest due date = not yet published; on an older date = no archive (non-trading)", () => {
    const m = { status: "missing" as const, checkedAt: "t" };
    expect(reconcileDate(m, m, true)).toBe("pending-publication");
    expect(reconcileDate(m, m, false)).toBe("non-trading");
  });
  it("a timeout is never treated as a holiday", () => {
    expect(reconcileDate({ status: "failed", checkedAt: "t", detail: "timeout" }, { status: "earlier-session", checkedAt: "t" }, false)).toBe("unresolved");
  });
});

describe("refresh outcome", () => {
  const now = new Date("2026-10-26T14:30:00Z");
  const targets = targetDates(now, 30);

  function stateWith(fill: (d: string) => [RefreshState["archives"]["index"][string], RefreshState["archives"]["stocks"][string]]): RefreshState {
    const state = emptyState();
    for (const d of targets) {
      const [i, s] = fill(d);
      state.archives.index[d] = i;
      state.archives.stocks[d] = s;
    }
    return state;
  }
  const good = (): [any, any] => [{ status: "ok", checkedAt: "t" }, { status: "ok", checkedAt: "t", symbolSetHash: "h" }];

  it("complete when every due date is resolved and data reaches the latest due date", () => {
    const r = evaluateRefresh(stateWith(good), targets, "2026-10-26", "h", now);
    expect(r.outcome).toBe("complete");
    expect(r.reasons).toEqual([]);
  });

  it("FAILED when the latest expected trading date is missing (the Oct 2026 incident)", () => {
    const state = stateWith((d) => (d > "2026-10-09" ? [{ status: "failed", checkedAt: "t", detail: "timeout" }, { status: "failed", checkedAt: "t", detail: "timeout" }] : good()));
    const r = evaluateRefresh(state, targets, "2026-10-09", "h", now);
    expect(r.outcome).toBe("failed");
    expect(r.tradingDaysBehind).toBe(11);
    expect(r.unresolvedRecent.map((u) => u.date)).toEqual(targets.slice(0, RECENT_DATES));
    expect(r.reasons[0]).toMatch(/recent date\(s\) could not be retrieved/);
  });

  it("not failed when today's archive is simply not published yet", () => {
    const state = stateWith((d) => (d === "2026-10-26" ? [{ status: "missing", checkedAt: "t" }, { status: "missing", checkedAt: "t" }] : good()));
    const r = evaluateRefresh(state, targets, "2026-10-23", "h", now);
    expect(r.outcome).toBe("complete");
    expect(r.pendingPublication).toEqual(["2026-10-26"]);
  });

  it("holidays inside the window do not count as missing trading days", () => {
    const state = stateWith((d) => (d === "2026-10-20" ? [{ status: "missing", checkedAt: "t" }, { status: "earlier-session", checkedAt: "t" }] : good()));
    expect(evaluateRefresh(state, targets, "2026-10-26", "h", now).outcome).toBe("complete");
  });

  it("PARTIAL (not failed) when only an old historical date is unresolved", () => {
    const old = targets[20];
    const state = stateWith((d) => (d === old ? [{ status: "failed", checkedAt: "t" }, { status: "ok", checkedAt: "t", symbolSetHash: "h" }] : good()));
    const r = evaluateRefresh(state, targets, "2026-10-26", "h", now);
    expect(r.outcome).toBe("partial");
    expect(r.unresolvedHistorical.map((u) => u.date)).toEqual([old]);
  });

  it("PARTIAL while older stock dates still await re-extraction for a new symbol/series set", () => {
    const state = stateWith((d) => (d < "2026-10-01" ? [{ status: "ok", checkedAt: "t" }, { status: "ok", checkedAt: "t", symbolSetHash: "old" }] : good()));
    const r = evaluateRefresh(state, targets, "2026-10-26", "h", now);
    expect(r.outcome).toBe("partial");
    expect(r.backfillRemaining).toBeGreaterThan(0);
  });
});

describe("manifest freshness and the workflow gate", () => {
  const summary = (outcome: "complete" | "partial" | "failed") => ({
    outcome,
    evaluatedAt: "2026-10-26T15:00:00.000Z",
    latestDueDate: "2026-10-26",
    latestMarketDate: "2026-10-23",
    tradingDaysBehind: outcome === "failed" ? 1 : 0,
    unresolvedRecent: [],
    unresolvedHistorical: [],
    pendingPublication: [],
    nonTradingDates: 0,
    backfillRemaining: 0,
    reasons: outcome === "complete" ? [] : ["why"],
  });

  it("only a complete run advances lastCompleteRefreshAt", () => {
    expect(toRefreshStatus(summary("complete"), "2026-10-09T20:00:00.000Z").lastCompleteRefreshAt).toBe("2026-10-26T15:00:00.000Z");
    expect(toRefreshStatus(summary("partial"), "2026-10-09T20:00:00.000Z").lastCompleteRefreshAt).toBe("2026-10-09T20:00:00.000Z");
    expect(toRefreshStatus(summary("failed"), null).lastCompleteRefreshAt).toBeNull();
  });

  it("check-refresh fails the workflow when a critical recent date is unresolved", () => {
    const failed = refreshExitCode({ refresh: toRefreshStatus(summary("failed"), null) });
    expect(failed.code).toBe(1);
    expect(failed.lines[0]).toMatch(/^::error::Refresh failed/);
  });

  it("check-refresh passes with a warning for partial, cleanly for complete, and fails without a status", () => {
    expect(refreshExitCode({ refresh: toRefreshStatus(summary("partial"), null) })).toMatchObject({ code: 0 });
    expect(refreshExitCode({ refresh: toRefreshStatus(summary("partial"), null) }).lines[0]).toMatch(/^::warning::/);
    expect(refreshExitCode({ refresh: toRefreshStatus(summary("complete"), null) }).code).toBe(0);
    expect(refreshExitCode({}).code).toBe(1);
  });
});
