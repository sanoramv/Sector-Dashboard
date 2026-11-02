import { describe, expect, it } from "vitest";
import * as R from "../../scripts/ledger/readiness.mts";
import { READINESS } from "../../scripts/ledger/constants.mts";

const ok = { status: "ok" as const, checkedAt: "x", attempts: 1 };
const lists = (n: { nifty500: number; microcap250: number; midcap150: number; smallcap250: number }) => Object.fromEntries(Object.entries(n).map(([k, v]) => [k, { present: true, count: v }]));
const nominal = { nifty500: 500, microcap250: 250, midcap150: 150, smallcap250: 250 };
const prev = (symbolCount: number, fetched = "t1", readable = true): R.PreviousSnapshot => ({ source: "live-capture", symbolCount, constituentsFetchedAt: fetched, readable });

describe("R1 / R2 (waiting, not failure)", () => {
  it("R1 passes only when both archives are ok", () => {
    expect(R.checkR1("d", ok, ok).status).toBe("pass");
    expect(R.checkR1("d", ok, { ...ok, status: "failed" }).disposition).toBe("waiting");
    expect(R.checkR1("d", undefined, ok).disposition).toBe("waiting");
  });
  it("R2 requires all 20 tracked series", () => {
    const all = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`x${i}`, true]));
    expect(R.checkR2("d", { ...all }).disposition).toBe("waiting"); // wrong slugs => none of the expected exist
    const bars: Record<string, boolean> = {};
    for (const s of R.checkR2("d", {}).affected ?? []) bars[s] = true;
    expect(Object.keys(bars)).toHaveLength(20);
    expect(R.checkR2("d", bars).status).toBe("pass");
    bars[Object.keys(bars)[0]] = false;
    expect(R.checkR2("d", bars)).toMatchObject({ status: "fail", disposition: "waiting" });
  });
});

describe("R3 volume coverage (99%)", () => {
  it("boundary: 990/1000 passes, 989/1000 fails", () => {
    expect(R.checkR3(1000, 990, []).status).toBe("pass");
    expect(R.checkR3(1000, 989, ["a"]).disposition).toBe("blocked");
  });
  it("no stock with a bar blocks", () => expect(R.checkR3(0, 0, []).disposition).toBe("blocked"));
});

describe("R4 eligible count (90% of the trailing median)", () => {
  const base = Array(20).fill(740);
  it("boundary at 90% of the median", () => {
    expect(R.checkR4(666, base).status).toBe("pass");
    expect(R.checkR4(665, base)).toMatchObject({ status: "fail", disposition: "blocked" });
  });
  it("uses at most the 20 latest sessions and blocks with no baseline", () => {
    expect(R.checkR4(700, [1, 1, 1, ...base]).status).toBe("pass");
    expect(R.checkR4(700, []).disposition).toBe("blocked");
  });
  it("median helper", () => {
    expect(R.median([3, 1, 2])).toBe(2);
    expect(R.median([1, 2, 3, 4])).toBe(2.5);
    expect(R.median([])).toBeNull();
  });
});

describe("R5 universe lists (nominal on the first snapshot, previous live snapshot afterwards)", () => {
  it("R5a: nominal +-5% boundaries for each list", () => {
    const base = { ...nominal };
    const cases: [keyof typeof base, number, boolean][] = [["nifty500", 475, true], ["nifty500", 474, false], ["nifty500", 525, true], ["nifty500", 526, false], ["microcap250", 238, true], ["microcap250", 237, false], ["microcap250", 262, true], ["microcap250", 263, false], ["midcap150", 143, true], ["midcap150", 142, false], ["midcap150", 157, true], ["midcap150", 158, false]];
    for (const [slug, n, passes] of cases) expect(R.checkR5(lists({ ...base, [slug]: n }), 755, "t", null).status === "pass").toBe(passes);
  });
  it("first snapshot uses nominal sizes only", () => {
    const r = R.checkR5(lists({ nifty500: 501, microcap250: 254, midcap150: 150, smallcap250: 251 }), 755, "t1", null);
    expect(r).toMatchObject({ status: "pass", mode: "bootstrap-nominal" });
  });
  it("second snapshot compares with the previous live snapshot within 5%", () => {
    const l = lists(nominal);
    expect(R.checkR5(l, 755, "t1", prev(755))).toMatchObject({ status: "pass", mode: "previous-live" });
    expect(R.checkR5(l, 718, "t1", prev(755)).status).toBe("pass"); // 755*0.95 = 717.25
    expect(R.checkR5(l, 717, "t1", prev(755))).toMatchObject({ status: "fail", disposition: "blocked" });
    expect(R.checkR5(l, 792, "t1", prev(755)).status).toBe("pass"); // 755*1.05 = 792.75
    expect(R.checkR5(l, 793, "t1", prev(755)).status).toBe("fail");
  });
  it("skips the previous-snapshot comparison when the lists were refreshed", () => {
    expect(R.checkR5(lists(nominal), 640, "t2", prev(755, "t1"))).toMatchObject({ status: "pass", mode: "list-refreshed" });
  });
  it("an unreadable baseline falls back to the nominal check with a warning", () => {
    expect(R.checkR5(lists(nominal), 700, "t1", prev(0, "", false))).toMatchObject({ mode: "nominal-only", status: "warn" });
  });
  it("a missing or empty list always blocks", () => {
    const l = lists(nominal);
    expect(R.checkR5({ ...l, microcap250: { present: false, count: 0 } }, 500, "t", null).disposition).toBe("blocked");
    expect(R.checkR5({ ...l, midcap150: { present: true, count: 0 } }, 600, "t", prev(755)).disposition).toBe("blocked");
  });
});

describe("R7 manifest currency", () => {
  const m = (over: object) => ({ latestMarketDate: "2026-10-29", refresh: { outcome: "complete", tradingDaysBehind: 0, reasons: [] as string[] }, ...over });
  it("stale manifest waits; failed blocks; partial needs the date resolved and zero days behind", () => {
    expect(R.checkR7("2026-10-29", m({}), true).status).toBe("pass");
    expect(R.checkR7("2026-10-30", m({}), true)).toMatchObject({ disposition: "waiting" });
    expect(R.checkR7("2026-10-29", m({ refresh: { outcome: "failed", tradingDaysBehind: 1 } }), true).disposition).toBe("blocked");
    expect(R.checkR7("2026-10-29", m({ refresh: { outcome: "partial", tradingDaysBehind: 0 } }), true)).toMatchObject({ status: "warn" });
    expect(R.checkR7("2026-10-29", m({ refresh: { outcome: "partial", tradingDaysBehind: 1 } }), true).disposition).toBe("blocked");
    expect(R.checkR7("2026-10-29", m({ refresh: { outcome: "partial", tradingDaysBehind: 0 } }), false).disposition).toBe("blocked");
    expect(R.checkR7("2026-10-29", { latestMarketDate: "2026-10-29" }, true).disposition).toBe("blocked");
  });
});

describe("R8 rule version", () => {
  const reads = ["regime.breadthThresholdPct"];
  it("passes only for the enabled version reading recorded settings", () => {
    expect(R.checkR8("mv1-a", "mv1-a", reads).status).toBe("pass");
    expect(R.checkR8("mv1-b", "mv1-a", reads).disposition).toBe("blocked");
    expect(R.checkR8("mv1-a", null, reads).disposition).toBe("blocked");
    expect(R.checkR8("mv1-a", "mv1-a", [...reads, "scoring.near52wHighThresholdPct"])).toMatchObject({ status: "fail", affected: ["scoring.near52wHighThresholdPct"] });
  });
});

describe("R9 missing-today stocks: trailing median + 1", () => {
  const zeros = Array(20).fill(0);
  it("margin boundary with a zero median", () => {
    expect(R.checkR9([], zeros)).toMatchObject({ status: "pass" });
    expect(R.checkR9(["A"], zeros)).toMatchObject({ status: "warn", affected: ["A"] }); // recorded, not blocked
    expect(R.checkR9(["A", "B"], zeros)).toMatchObject({ status: "fail", disposition: "blocked", affected: ["A", "B"] });
  });
  it("the limit moves with the median", () => {
    const ones = Array(20).fill(1);
    expect(R.checkR9(["A", "B"], ones).status).toBe("warn");
    expect(R.checkR9(["A", "B", "C"], ones).disposition).toBe("blocked");
  });
  it("blocks when no baseline exists, preserving the affected symbols", () => expect(R.checkR9(["A"], [])).toMatchObject({ disposition: "blocked", affected: ["A"] }));
  it("thresholds come from the approved constants", () => expect(READINESS.R9).toMatchObject({ margin: 1, baselineSessions: 20 }));
});

describe("R11 price-break burst: review flag only", () => {
  const e = (symbol: string, ratio: number | null, reason = "corporate-action-break") => ({ symbol, reason, closeRatio: ratio });
  it("flags at 3 break-starts, not at 2, and never blocks", () => {
    expect(R.checkR11([e("A", 0.5), e("B", 0.6)]).status).toBe("pass");
    const flagged = R.checkR11([e("A", 0.5), e("B", 0.4), e("C", 0.2)]);
    expect(flagged).toMatchObject({ status: "warn", disposition: "flag" });
    expect(flagged.affected).toEqual(["A", "B", "C"]);
    expect(flagged.reason).toMatch(/Every excluded stock is recorded/);
  });
  it("a new listing (first bar) is not a break and missing comparison data is safe", () => {
    expect(R.checkR11([e("A", null, "first-bar-in-history"), e("B", null, "first-bar-in-history"), e("C", null, "first-bar-in-history"), e("D", 0.5)]).status).toBe("pass");
    expect(R.checkR11([e("A", null), e("B", null), e("C", null)]).disposition).toBe("flag"); // counted by number even without ratios
  });
  it("three stocks sharing one rounded ratio are described as such", () => {
    expect(R.checkR11([e("A", 0.5001), e("B", 0.4999), e("C", 0.5)]).reason).toMatch(/3 stocks start a price break|share/);
  });
});

describe("R10 summary", () => {
  it("vacuous pass with nothing captured; flag (never block) on any revision", () => {
    expect(R.summariseR10([]).status).toBe("pass");
    const s = R.summariseR10([{ date: "d1", ok: true, changedSymbols: [], changedIndices: [], removedFromSource: [] }, { date: "d2", ok: false, changedSymbols: ["X"], changedIndices: [], removedFromSource: [] }]);
    expect(s).toMatchObject({ status: "warn", disposition: "flag", affected: ["d2"] });
    expect(R.anyBlocking([s])).toHaveLength(0);
  });
});
