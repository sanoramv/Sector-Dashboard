import { describe, it, expect } from "vitest";
import { ok, unavailable } from "../../src/types/metrics";
import type { AnnouncementsFile, Announcement } from "../../src/types/announcements";
import type { MomentumCandidate } from "../../src/types/momentum";
import { filingsForSession } from "../../src/lib/momentum/news";
import { DEFAULT_FILTERS, matchesFilters, sortCandidates } from "../../src/lib/momentum/filters";
import { momentumFreshnessNotices } from "../../src/lib/momentum/freshness";
import { buildDataset, barsFrom, flatCloses, weekdays } from "./fixtures";

const filing = (id: string, symbol: string, publishedAt: string): Announcement => ({
  id,
  symbol,
  company: `${symbol} LIMITED`,
  subject: "Outcome of Board Meeting",
  description: "results",
  url: `https://nsearchives.nseindia.com/corporate/${symbol}_${id}.pdf`,
  publishedAt,
  category: "results",
  matchedBy: "filing-link-symbol",
});

function file(items: Announcement[], spans: Array<[string, string]>): AnnouncementsFile {
  return {
    schemaVersion: 1,
    source: { name: "test", feedUrl: "x" },
    retentionDays: 30,
    checks: spans.map(([oldest, checkedAt]) => ({ checkedAt, outcome: "ok" as const, oldestInFeed: oldest, newestInFeed: checkedAt })),
    items,
  };
}

describe("filings relative to the session", () => {
  // Session 2026-10-27; previous session 2026-10-26; next 2026-10-28.
  const now = new Date("2026-10-28T12:00:00+05:30");
  const items = [
    filing("a", "ROUTE", "2026-10-26T14:00:00+05:30"), // before the previous close: outside the window
    filing("b", "ROUTE", "2026-10-27T11:00:00+05:30"), // during the session
    filing("c", "ROUTE", "2026-10-27T23:53:39+05:30"), // after the close, before the next open
    filing("d", "ROUTE", "2026-10-28T10:00:00+05:30"), // after the next open: outside
    filing("e", "OTHER", "2026-10-27T11:00:00+05:30"),
  ];
  const fullCover = file(items, [
    ["2026-10-26T00:00:01+05:30", "2026-10-26T23:59:00+05:30"],
    ["2026-10-27T00:00:05+05:30", "2026-10-27T23:59:59+05:30"],
    ["2026-10-28T00:00:10+05:30", "2026-10-28T11:00:00+05:30"],
  ]);

  it("keeps filings between the previous close and the next open, labelled before/after the close", () => {
    const r = filingsForSession(fullCover, "ROUTE", "2026-10-27", "2026-10-26", "2026-10-28", now);
    expect(r.filings.map((f) => [f.id, f.timing])).toEqual([
      ["b", "before-close"],
      ["c", "after-close"],
    ]);
    expect(r.coverage).toBe("covered");
    expect(r.filings[0].url).toMatch(/^https:\/\/nsearchives\.nseindia\.com\/corporate\//);
  });

  it("distinguishes 'no filing found in a covered window' from 'not covered'", () => {
    const none = filingsForSession(fullCover, "QUIET", "2026-10-27", "2026-10-26", "2026-10-28", now);
    expect(none.coverage).toBe("covered");
    expect(none.summary).toMatch(/No exchange filing found - the feed was read across this whole window/);

    const uncovered = filingsForSession(file(items, []), "QUIET", "2026-10-27", "2026-10-26", "2026-10-28", now);
    expect(uncovered.coverage).toBe("not-covered");
    expect(uncovered.summary).toMatch(/Unknown, not 'no news'/);

    const partial = filingsForSession(file(items, [["2026-10-27T00:00:05+05:30", "2026-10-27T20:00:00+05:30"]]), "QUIET", "2026-10-27", "2026-10-26", "2026-10-28", now);
    expect(partial.coverage).toBe("partial");
    expect(partial.coveredPct).toBeGreaterThan(0);
    expect(partial.summary).toMatch(/may exist/);
  });

  it("reports catalysts as unavailable when the file could not be loaded", () => {
    const r = filingsForSession(null, "ROUTE", "2026-10-27", "2026-10-26", null, now);
    expect(r.coverage).toBe("no-data");
    expect(r.filings).toEqual([]);
  });

  it("ends the window at 'now' when the next session has not opened", () => {
    const r = filingsForSession(fullCover, "ROUTE", "2026-10-27", "2026-10-26", null, new Date("2026-10-27T20:00:00+05:30"));
    expect(r.filings.map((f) => f.id)).toEqual(["b"]);
  });
});

function candidate(over: Partial<MomentumCandidate> & { symbol: string; change: number; rvol?: number | null; dist?: number | null }): MomentumCandidate {
  return {
    symbol: over.symbol,
    companyName: over.symbol,
    industry: over.industry ?? "IT",
    segment: over.segment ?? "large",
    group: "gainer",
    rank: over.rank ?? 1,
    date: "2026-10-27",
    price: { dailyChangePct: over.change, closeLocation: 0.8, distanceFrom52wHigh: ok(-2) } as MomentumCandidate["price"],
    patterns: {
      resistance: over.dist === null ? unavailable("n/a") : ok({ level: 100, levelDate: "2026-09-01", distancePct: over.dist ?? 1, isApproaching: false }),
      breakoutToday: (over.dist ?? 1) > 0,
      breakdownToday: false,
      failedBreakoutToday: false,
      retest: null,
      consolidationBefore: unavailable("n/a"),
      triangleBefore: unavailable("n/a"),
    },
    activity: {
      relativeVolume: over.rvol === null ? unavailable("no data") : ok(over.rvol ?? 2),
      turnoverCr: 5,
      medianTurnover20Cr: ok(5),
      liquidityWarnings: over.activity?.liquidityWarnings ?? [],
    } as unknown as MomentumCandidate["activity"],
    context: { stockVsPeersPp: 1 } as MomentumCandidate["context"],
    quality: { status: "ok", barsUsed: 200, usableFrom: "2025-08-01", notes: [] },
    label: over.label ?? "momentum-continuation",
    assessment: over.assessment ?? { category: "continuation", components: [], total: 3, missingEvidence: [], rationale: "" },
    continuationFactors: [],
    reversalFactors: [],
    lowConfidenceReasons: [],
  };
}

describe("filtering and sorting", () => {
  const list = [
    candidate({ symbol: "A", change: 9, rvol: 3, rank: 1 }),
    candidate({ symbol: "B", change: 4, rvol: null, rank: 2, industry: "Power", label: "weak-momentum" }),
    candidate({ symbol: "C", change: 2.5, rvol: 1.2, rank: 3, segment: "micro", dist: -8, activity: { liquidityWarnings: ["thin"] } as MomentumCandidate["activity"] }),
  ];
  const pick = (f: Partial<typeof DEFAULT_FILTERS>) => list.filter((c) => matchesFilters(c, { ...DEFAULT_FILTERS, ...f })).map((c) => c.symbol);

  it("filters by move size, relative volume (missing volume never passes a volume filter), industry, size, liquidity, resistance distance, pattern and label", () => {
    expect(pick({})).toEqual(["A", "B", "C"]);
    expect(pick({ minAbsChangePct: 3 })).toEqual(["A", "B"]);
    expect(pick({ minRelativeVolume: 1.5 })).toEqual(["A"]);
    expect(pick({ industry: "Power" })).toEqual(["B"]);
    expect(pick({ segment: "micro" })).toEqual(["C"]);
    expect(pick({ liquidOnly: true })).toEqual(["A", "B"]);
    expect(pick({ maxBelowResistancePct: 5 })).toEqual(["A", "B"]);
    expect(pick({ pattern: "breakout-today" })).toEqual(["A", "B"]);
    expect(pick({ label: "weak-momentum" })).toEqual(["B"]);
  });

  it("sorts with unavailable values last in both directions", () => {
    expect(sortCandidates(list, "rvol", "desc").map((c) => c.symbol)).toEqual(["A", "C", "B"]);
    expect(sortCandidates(list, "rvol", "asc").map((c) => c.symbol)).toEqual(["C", "A", "B"]);
    expect(sortCandidates(list, "change", "asc").map((c) => c.symbol)).toEqual(["C", "B", "A"]);
    expect(list.map((c) => c.symbol)).toEqual(["A", "B", "C"]); // input untouched
  });
});

describe("freshness and status notices", () => {
  const d = weekdays("2026-08-03", 60);
  const ds = buildDataset(barsFrom(d, flatCloses(60, 1000)), []);
  const latest = d[59];
  const loaded = { activity: "ok" as const, announcements: "ok" as const };

  it("says nothing extra for a complete, current refresh on the latest session", () => {
    expect(momentumFreshnessNotices(ds.manifest, latest, latest, "live", loaded)).toEqual([]);
  });

  it("states a failed refresh as an error naming the real market date", () => {
    const m = { ...ds.manifest, refresh: { ...ds.manifest.refresh!, outcome: "failed" as const, tradingDaysBehind: 2, latestDueDate: "2026-10-29" } };
    const n = momentumFreshnessNotices(m, latest, latest, "partial", loaded);
    expect(n[0].level).toBe("error");
    expect(n[0].text).toMatch(new RegExp(`latest market data is ${ds.manifest.latestMarketDate}, 2 trading day\\(s\\) behind`));
    expect(n[0].text).toMatch(/NOT for the most recent session/);
  });

  it("flags partial refreshes, stale or cached data, historical views and missing supplements", () => {
    const partial = { ...ds.manifest, refresh: { ...ds.manifest.refresh!, outcome: "partial" as const, reasons: ["3 older date(s) unresolved"] } };
    expect(momentumFreshnessNotices(partial, latest, latest, "live", loaded)[0].text).toMatch(/partial: 3 older/);
    expect(momentumFreshnessNotices(ds.manifest, latest, latest, "stale", loaded)[0].level).toBe("error");
    expect(momentumFreshnessNotices(ds.manifest, latest, latest, "cached", loaded)[0].text).toMatch(/cached/);
    expect(momentumFreshnessNotices(ds.manifest, d[50], latest, "live", loaded)[0].text).toMatch(`Historical view: session ${d[50]}`);
    const missing = momentumFreshnessNotices(ds.manifest, latest, latest, "live", { activity: "unavailable", announcements: "unavailable" });
    expect(missing.map((x) => x.text).join(" ")).toMatch(/Volume\/turnover data could not be loaded.*catalyst information is unavailable \(not 'no news'\)/);
    const noStatus = momentumFreshnessNotices({ ...ds.manifest, refresh: undefined }, latest, latest, "live", loaded);
    expect(noStatus[0].text).toMatch(/did not report/);
  });
});
