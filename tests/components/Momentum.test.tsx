// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { encodeActivity } from "../../src/lib/activity";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { discover } from "../../src/lib/momentum/discovery";
import { MomentumTable } from "../../src/components/MomentumTable";
import { MomentumPanel } from "../../src/components/MomentumPanel";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays } from "../momentum/fixtures";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const d = weekdays("2026-06-01", 80);
const latest = d[79];
const bench = barsFrom(d, flatCloses(80, 1000, 0.002));
const lastMove = (level: number, pct: number) => {
  const b = barsFrom(d.slice(0, 79), flatCloses(79, level));
  const p = b[78].close;
  return [...b, { date: latest, open: p, high: p * (1 + Math.max(pct, 0) / 100) * 1.002, low: p * (1 + Math.min(pct, 0) / 100) * 0.998, close: p * (1 + pct / 100) }];
};
const stocks = [
  { symbol: "ALPHA", bars: lastMove(100, 7) },
  { symbol: "BETA", bars: lastMove(200, 3) },
  { symbol: "GAMMA", bars: lastMove(300, -4) },
];
const ds = buildDataset(bench, stocks);
const activity = { ALPHA: activityFor(d), BETA: activityFor(d), GAMMA: activityFor(d.slice(0, 70)) }; // GAMMA: no volume for recent sessions

describe("MomentumTable", () => {
  const r = discover(prepareUniverse(ds, activity), latest, DEFAULT_SETTINGS, "sideways");

  it("renders ranked rows with labels, and N/A (not 0) for missing relative volume", () => {
    render(<MomentumTable title="Top 20 losers" group="loser" candidates={r.losers} totalBeforeFilters={r.losers.length} onSelect={() => {}} />);
    const row = screen.getByRole("button", { name: /GAMMA/ });
    expect(within(row).getByText("-4.00%")).toBeTruthy();
    expect(within(row).getAllByText("N/A").length).toBeGreaterThan(0);
    expect(within(row).getAllByText("Insufficient evidence")).toHaveLength(2); // evidence category and setup label
  });

  it("sorts by a column when its header is clicked and calls onSelect for a row", () => {
    const onSelect = vi.fn();
    render(<MomentumTable title="Top 20 gainers" group="gainer" candidates={r.gainers} totalBeforeFilters={r.gainers.length} onSelect={onSelect} />);
    const order = () => screen.getAllByRole("button", { name: /View research details/ }).map((b) => b.getAttribute("aria-label"));
    expect(order()).toEqual(["View research details for ALPHA", "View research details for BETA"]);
    fireEvent.click(screen.getByRole("button", { name: /^Change/ }));
    expect(order()).toEqual(["View research details for BETA", "View research details for ALPHA"]);
    fireEvent.click(screen.getByRole("button", { name: /ALPHA/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ symbol: "ALPHA" }));
  });
});

describe("MomentumPanel", () => {
  function stubFetch(opts: { activity?: boolean; announcements?: boolean }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("stock-activity.json")) {
          return opts.activity === false ? new Response("", { status: 404 }) : new Response(JSON.stringify(encodeActivity(activity)), { status: 200 });
        }
        if (url.includes("announcements.json")) {
          return opts.announcements === false
            ? new Response("", { status: 404 })
            : new Response(JSON.stringify({ schemaVersion: 1, source: { name: "t", feedUrl: "t" }, retentionDays: 30, checks: [], items: [] }), { status: 200 });
        }
        return new Response("", { status: 404 });
      }),
    );
  }

  it("shows the session date, the source, both lists, and that it is not Groww's live list", async () => {
    stubFetch({});
    render(<MomentumPanel rawDataset={ds} settings={DEFAULT_SETTINGS} dataStatus="live" />);
    expect(await screen.findByRole("region", { name: /Top 20 gainers/ })).toBeTruthy();
    expect(screen.getByRole("region", { name: /Top 20 losers/ })).toBeTruthy();
    expect(screen.getAllByText(/latest in the data/).length).toBeGreaterThan(0);
    expect(screen.getByText(/NSE equity bhavcopy \(official\)/)).toBeTruthy();
    expect(screen.getByText(/Not Groww's live list/)).toBeTruthy();
    expect(screen.queryByText(/buy now|sell now|target price|stop-loss at/i)).toBeNull();
  });

  it("switches between the gainers/losers, unusual-volume, continuation and exhaustion lists", async () => {
    stubFetch({});
    render(<MomentumPanel rawDataset={ds} settings={DEFAULT_SETTINGS} dataStatus="live" />);
    await screen.findByRole("region", { name: /Top 20 gainers/ });
    fireEvent.click(screen.getByRole("tab", { name: "Unusual volume" }));
    expect(screen.getByRole("region", { name: /Unusual volume/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: /Top 20 gainers/ })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Continuation characteristics" }));
    expect(screen.getByText(/Historically this category did NOT reliably continue/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Exhaustion / reversal risk" }));
    expect(screen.getByText(/Not an instruction to trade against the move/)).toBeTruthy();
  });

  it("keeps working, and says so, when the volume and filings files are missing", async () => {
    stubFetch({ activity: false, announcements: false });
    render(<MomentumPanel rawDataset={ds} settings={DEFAULT_SETTINGS} dataStatus="live" />);
    expect(await screen.findByText(/Volume\/turnover data could not be loaded/)).toBeTruthy();
    expect(screen.getByText(/catalyst information is unavailable \(not 'no news'\)/)).toBeTruthy();
    expect(screen.getAllByText("Insufficient evidence").length).toBeGreaterThan(0);
  });

  it("shows an explicit error when the last refresh failed", async () => {
    stubFetch({});
    const failed = { ...ds, manifest: { ...ds.manifest, refresh: { ...ds.manifest.refresh!, outcome: "failed" as const, tradingDaysBehind: 1 } } };
    render(<MomentumPanel rawDataset={failed} settings={DEFAULT_SETTINGS} dataStatus="partial" />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/last data refresh FAILED/);
  });
});
