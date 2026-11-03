import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as W from "../../scripts/ledger/watchdog-core.mjs";
import * as C from "../../scripts/ledger/calendar.mts";

const st = (over: object = {}) => ({ updatedAt: "2026-10-29T20:00:00Z", enabledFrom: "2026-10-26", dates: {}, calendar: {}, metrics: {}, ...over });
const rec = (status: string, extra: object = {}) => ({ status, reasons: [], publicationClass: null, ...extra });
const keys = (r: ReturnType<typeof W.evaluate>) => r.wanted.map((w) => w.key);

describe("watchdog core", () => {
  it("calendar maths matches calendar.mts", () => {
    for (const d of ["2026-10-29", "2026-10-30", "2026-10-31", "2026-11-02", "2027-03-19"]) {
      expect(W.cutoffAt(d)).toBe(C.cutoffAt(d));
      expect(W.isWeekend(d)).toBe(C.isWeekend(d));
      expect(W.addDays(d, 3)).toBe(C.addDays(d, 3));
    }
  });
  it("alerts a missing session after its cut-off, as a lost session", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T05:00:00Z"), state: st({ dates: { "2026-10-29": rec("blocked", { reasons: ["R3"] }) }, calendar: { "2026-10-29": "trading" } }) });
    expect(keys(r)).toContain("missing:2026-10-29");
    expect(r.wanted.find((w) => w.key === "missing:2026-10-29")!.labels).toContain("ledger-lost-session");
  });
  it("warns before the cut-off (auto-closing) when still uncaptured", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T03:20:00Z"), state: st({ dates: { "2026-10-29": rec("waiting") }, calendar: { "2026-10-29": "trading" } }) });
    expect(r.wanted.find((w) => w.key === "missing:2026-10-29")).toMatchObject({ autoClose: true });
  });
  it("never alerts for exchange holidays or dates before enablement", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ calendar: { "2026-10-29": "non-trading", "2026-10-20": "trading" } }) });
    expect(keys(r).filter((k) => k.startsWith("missing:"))).toEqual([]);
  });
  it("resolves when a live capture exists", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ dates: { "2026-10-29": rec("recorded", { publicationClass: "live" }) }, calendar: { "2026-10-29": "trading" } }) });
    expect(keys(r)).not.toContain("missing:2026-10-29");
    expect(r.resolvable).toContain("missing:2026-10-29");
  });
  it("a recorded-but-late capture is not reported as missing", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ dates: { "2026-10-29": rec("recorded-late") }, calendar: { "2026-10-29": "trading" } }) });
    expect(keys(r)).not.toContain("missing:2026-10-29");
  });
  it("raises review issues for anomaly, source-revised, price-break flag and long-unverified publications", () => {
    const dates = { "2026-10-26": rec("anomaly"), "2026-10-27": rec("source-revised"), "2026-10-28": rec("review-required"), "2026-10-23": rec("unverified") };
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ enabledFrom: "2026-10-20", dates, calendar: {} }) });
    expect(keys(r)).toEqual(expect.arrayContaining(["anomaly:2026-10-26", "source-revised:2026-10-27", "review:2026-10-28", "unverified:2026-10-23"]));
    expect(r.wanted.find((w) => w.key === "anomaly:2026-10-26")!.autoClose).toBe(false);
    expect(r.wanted.find((w) => w.key === "review:2026-10-28")!.autoClose).toBe(true);
  });
  it("stale capture on a weekday, but not on a weekend", () => {
    const state = st({ updatedAt: "2026-10-27T00:00:00Z" });
    expect(keys(W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state }))).toContain("stale");
    expect(keys(W.evaluate({ now: new Date("2026-10-31T12:00:00Z"), state }))).not.toContain("stale");
  });
  it("capacity triggers", () => {
    const r = W.evaluate({ now: new Date("2026-10-29T21:00:00Z"), state: st({ metrics: { publicDataBytes: 600e6, ledgerBytes: 1, dailyFileBytes: 6e6, captureSeconds: 10 } }) });
    expect(keys(r)).toEqual(expect.arrayContaining(["capacity:publicDataBytes", "capacity:dailyFileBytes"]));
    expect(keys(r)).not.toContain("capacity:ledgerBytes");
  });
  it("unreadable state raises a single stale issue and never throws", () => {
    expect(W.evaluate({ now: new Date(), state: null }).wanted).toHaveLength(1);
  });
});

describe("watchdog issue planning: no repeated comments on unchanged issues", () => {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  const titleOf = (key: string) => (key.startsWith("missing:") ? W.TITLES.missing(key.slice(8)) : key === "stale" ? W.TITLES.stale() : null);
  const wanted = (body: string) => [{ key: "missing:2026-10-29", title: W.TITLES.missing("2026-10-29"), body, labels: ["ledger"], autoClose: true }];
  it("creates a new issue once, with a content marker", () => {
    const a = W.planIssueActions({ wanted: wanted("No capture yet."), resolvable: [], open: [], hash, titleOf });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "create", title: W.TITLES.missing("2026-10-29") });
    expect(W.markerOf((a[0] as { body: string }).body)).toBe(hash("No capture yet."));
  });
  it("does NOTHING when the issue already exists with the same content (no comment, no update)", () => {
    const body = W.withMarker("No capture yet.", hash("No capture yet."));
    expect(W.planIssueActions({ wanted: wanted("No capture yet."), resolvable: [], open: [{ number: 5, title: W.TITLES.missing("2026-10-29"), body }], hash, titleOf })).toEqual([]);
  });
  it("updates and comments once when the content meaningfully changed", () => {
    const body = W.withMarker("No capture yet.", hash("No capture yet."));
    const a = W.planIssueActions({ wanted: wanted("Status: blocked. R3 volume coverage 62%."), resolvable: [], open: [{ number: 5, title: W.TITLES.missing("2026-10-29"), body }], hash, titleOf });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: "update", number: 5 });
  });
  it("closes a resolved issue once, and does not touch issues that are still wanted or already absent", () => {
    const open = [{ number: 5, title: W.TITLES.missing("2026-10-29"), body: "" }];
    expect(W.planIssueActions({ wanted: [], resolvable: ["missing:2026-10-29"], open, hash, titleOf })).toMatchObject([{ type: "close", number: 5 }]);
    expect(W.planIssueActions({ wanted: [], resolvable: ["missing:2026-10-29"], open: [], hash, titleOf })).toEqual([]);
    expect(W.planIssueActions({ wanted: wanted("x"), resolvable: ["missing:2026-10-29"], open: [{ number: 5, title: W.TITLES.missing("2026-10-29"), body: W.withMarker("x", hash("x")) }], hash, titleOf })).toEqual([]);
  });
  it("a long-unverified publication is raised from the publication class", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ dates: { "2026-10-27": rec("recorded", { publicationClass: "unverified" }) }, calendar: {} }) });
    expect(r.wanted.map((w) => w.key)).toContain("unverified:2026-10-27");
  });
});

describe("F7: review-required (R11) issues have a defined closing rule", () => {
  const review = (_date: string) => ({ status: "review-required", reasons: ["R11: 3 stocks start a price break"], publicationClass: "live" });
  it("open while the session is within REVIEW_FLAG_DAYS; resolvable (closes itself) after; the flag itself stays in the state", () => {
    const young = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ enabledFrom: null, dates: { "2026-10-28": review("2026-10-28") } }) });
    expect(young.wanted.map((w) => w.key)).toContain("review:2026-10-28");
    expect(young.resolvable).not.toContain("review:2026-10-28");
    const old = W.evaluate({ now: new Date(Date.parse("2026-10-28T00:00:00Z") + (W.REVIEW_FLAG_DAYS + 1) * 86_400_000), state: st({ enabledFrom: null, dates: { "2026-10-28": review("2026-10-28") } }) });
    expect(old.wanted.map((w) => w.key)).not.toContain("review:2026-10-28");
    expect(old.resolvable).toContain("review:2026-10-28");
  });
  it("anomaly, source-revised and unverified issues are never auto-closed", () => {
    const r = W.evaluate({ now: new Date("2027-06-01T00:00:00Z"), state: st({ enabledFrom: null, updatedAt: "2027-06-01T00:00:00Z", dates: { "2026-10-26": rec("anomaly"), "2026-10-27": rec("source-revised"), "2026-10-23": rec("recorded", { publicationClass: "unverified" }) } }) });
    for (const k of ["anomaly:2026-10-26", "source-revised:2026-10-27", "unverified:2026-10-23"]) {
      expect(r.wanted.find((w) => w.key === k)?.autoClose, k).toBe(false);
      expect(r.resolvable, k).not.toContain(k);
    }
  });
});

describe("watchdog script: every GitHub API call it makes (real process, stubbed fetch)", () => {
  it("only uses the allowed endpoints and methods, closes the resolved review issue, and is silent for an unchanged issue", async () => {
    const { mkdtemp, writeFile } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const dir = await mkdtemp(path.join(os.tmpdir(), "wd-"));
    const stub = path.join(dir, "stub.mjs");
    await writeFile(stub, `
      const calls = [];
      globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ method: init.method || "GET", url: u });
        const path = u.replace("https://api.github.com/repos/o/r", "");
        const json = (b, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(b), json: async () => b });
        if (path.startsWith("/contents/")) return json(JSON.parse(process.env.STUB_STATE));
        if (path.startsWith("/issues?")) return json(JSON.parse(process.env.STUB_ISSUES));
        return json({}, init.method === "POST" && path === "/labels" ? 422 : 201);
      };
      process.on("exit", () => console.log("CALLS:" + JSON.stringify(calls)));
    `);
    const core = await import("../../scripts/ledger/watchdog-core.mjs");
    const today = new Date().toISOString();
    const state = { kind: "momentum-ledger.state", updatedAt: today, enabledFrom: "2020-01-06", dates: { "2020-01-06": { status: "review-required", reasons: [], publicationClass: "live" }, "2020-01-07": { status: "blocked", reasons: ["R3"], publicationClass: null } }, calendar: { "2020-01-07": "trading" }, metrics: {} };
    const sameBody = core.evaluate({ now: new Date(), state }).wanted.find((w: { key: string }) => w.key === "missing:2020-01-07")!;
    const { createHash } = await import("node:crypto");
    const h = createHash("sha256").update(sameBody.body).digest("hex").slice(0, 16);
    const issues = [
      { number: 11, title: core.TITLES.review("price-break burst", "2020-01-06"), body: "old" }, // resolvable -> closed
      { number: 12, title: core.TITLES.missing("2020-01-07"), body: core.withMarker(sameBody.body, h) }, // unchanged -> no activity
    ];
    const out = await promisify(execFile)("node", ["--import", stub, path.resolve("scripts/ledger-watchdog.mjs")], { env: { ...process.env, GITHUB_REPOSITORY: "o/r", GITHUB_TOKEN: "t", STUB_STATE: JSON.stringify(state), STUB_ISSUES: JSON.stringify(issues) } });
    const calls: { method: string; url: string }[] = JSON.parse(out.stdout.split("CALLS:")[1].trim());
    const allowed: [string, RegExp][] = [
      ["GET", /^\/contents\/public\/data\/ledger\/ledger-state\.json\?ref=main$/],
      ["POST", /^\/labels$/],
      ["GET", /^\/issues\?labels=ledger&state=open&per_page=100&page=\d$/],
      ["POST", /^\/issues$/],
      ["PATCH", /^\/issues\/\d+$/],
      ["POST", /^\/issues\/\d+\/comments$/],
    ];
    for (const c of calls) {
      expect(c.url.startsWith("https://api.github.com/repos/o/r/"), c.url).toBe(true);
      const p = c.url.replace("https://api.github.com/repos/o/r", "");
      expect(allowed.some(([m, re]) => m === c.method && re.test(p)), `${c.method} ${p}`).toBe(true); // exact match, not a prefix
    }
    const touched = calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${c.url.replace("https://api.github.com/repos/o/r", "")}`);
    expect(touched.filter((t) => t.includes("/issues/12"))).toEqual([]); // the unchanged issue: no comment, no update
    expect(touched).toEqual(expect.arrayContaining(["POST /issues/11/comments", "PATCH /issues/11"])); // the resolved review issue is closed
    expect(calls.filter((c) => c.method === "PUT" || c.method === "DELETE")).toEqual([]);
  }, 60_000);
});

describe("never-enabled ledger: no missing-capture alerts (defect: 94 false issues on 2026-11-03)", () => {
  // every weekday from 2025-08-18 to 2026-10-30, all "trading" - the shape of the real ledger-state.json calendar
  const calendar: Record<string, string> = {};
  for (let d = "2025-08-18"; d <= "2026-10-30"; d = W.addDays(d, 1)) if (!W.isWeekend(d)) calendar[d] = "trading";
  const now = new Date("2026-11-03T01:42:00Z");
  const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
  const titleOf = (key: string) => (key.startsWith("missing:") ? W.TITLES.missing(key.slice(8)) : key === "stale" ? W.TITLES.stale() : null);
  const fresh = { updatedAt: "2026-11-03T01:26:08Z" };

  it("A. enabledFrom null, dates empty, historical calendar: nothing at all is wanted", () => {
    expect(Object.keys(calendar).length).toBeGreaterThan(300);
    const r = W.evaluate({ now, state: st({ ...fresh, enabledFrom: null, dates: {}, calendar }) });
    expect(r.wanted).toEqual([]);
    expect(r.wanted.filter((w) => w.key.startsWith("missing:"))).toEqual([]);
  });
  it("A. the same when enabledFrom is absent, malformed or an impossible date (never treated as 'evaluate everything')", () => {
    for (const enabledFrom of [undefined, "", "soon", 20261028, "2026-02-30", "2026-13-45", "2026-00-10", "2026-04-31", "2026-10-28T00:00:00Z", " 2026-10-28"]) {
      const state = { ...st({ ...fresh, dates: {}, calendar }), enabledFrom } as object;
      expect(W.evaluate({ now, state }).wanted, String(enabledFrom)).toEqual([]);
    }
  });
  it("A. with open 'Ledger snapshot missing' issues already present, no action is planned (nothing is created, updated or closed)", () => {
    const r = W.evaluate({ now, state: st({ ...fresh, enabledFrom: null, dates: {}, calendar }) });
    const open = [{ number: 94, title: W.TITLES.missing("2026-10-30"), body: "x" }];
    expect(W.planIssueActions({ wanted: r.wanted, resolvable: r.resolvable, open, hash, titleOf })).toEqual([]);
  });
  it("A. protections still apply to records that exist: anomaly / source-revised / review / unverified are raised even when never enabled", () => {
    const dates = { "2026-10-26": rec("anomaly"), "2026-10-27": rec("source-revised"), "2026-10-28": rec("review-required"), "2026-10-23": rec("unverified") };
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ enabledFrom: null, updatedAt: "2026-10-30T00:00:00Z", dates, calendar: {} }) });
    expect(keys(r)).toEqual(expect.arrayContaining(["anomaly:2026-10-26", "source-revised:2026-10-27", "review:2026-10-28", "unverified:2026-10-23"]));
  });
  it("A. stale-state and capacity checks still apply when never enabled", () => {
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ enabledFrom: null, updatedAt: "2026-10-27T00:00:00Z", metrics: { publicDataBytes: 600e6 }, calendar }) });
    expect(keys(r)).toEqual(expect.arrayContaining(["stale", "capacity:publicDataBytes"]));
    expect(keys(r).filter((k) => k.startsWith("missing:"))).toEqual([]);
  });

  it("B. a valid calendar date activates monitoring (including a real leap day), and does not throw", () => {
    const cal = { "2026-10-28": "trading", "2026-10-29": "trading" };
    expect(keys(W.evaluate({ now, state: st({ ...fresh, enabledFrom: "2026-10-28", dates: {}, calendar: cal }) }))).toContain("missing:2026-10-28");
    expect(() => W.evaluate({ now, state: st({ ...fresh, enabledFrom: "2028-02-29", dates: {}, calendar: cal }) })).not.toThrow();
    for (const bad of ["2026-13-45", "2026-02-30", "9999-99-99", "0000-00-00"]) expect(() => W.evaluate({ now, state: st({ ...fresh, enabledFrom: bad, dates: {}, calendar: cal }) }), bad).not.toThrow();
  });
  it("B. enabled: sessions before enabledFrom are ignored; from enabledFrom onwards a missing capture past its cut-off is detected", () => {
    const cal = { "2026-10-23": "trading", "2026-10-26": "trading", "2026-10-27": "trading", "2026-10-28": "trading", "2026-10-29": "trading", "2026-10-30": "trading" };
    const r = W.evaluate({ now, state: st({ ...fresh, enabledFrom: "2026-10-28", dates: {}, calendar: cal }) });
    expect(keys(r).filter((k) => k.startsWith("missing:")).sort()).toEqual(["missing:2026-10-28", "missing:2026-10-29", "missing:2026-10-30"]);
    for (const old of ["2026-10-23", "2026-10-26", "2026-10-27"]) expect(keys(r)).not.toContain(`missing:${old}`);
    // the enabled date itself counts (>=), and a lost session is a permanent (non-auto-closing) alert
    expect(r.wanted.find((w) => w.key === "missing:2026-10-28")!.autoClose).toBe(false);
  });
  it("B. enabled: a captured session is not missing, and a session whose cut-off has not passed is not yet a lost session", () => {
    const cal = { "2026-10-28": "trading", "2026-10-29": "trading", "2026-10-30": "trading" };
    const dates = { "2026-10-29": rec("recorded", { publicationClass: "live" }) };
    const r = W.evaluate({ now: new Date("2026-10-30T12:00:00Z"), state: st({ updatedAt: "2026-10-30T00:00:00Z", enabledFrom: "2026-10-28", dates, calendar: cal }) });
    expect(keys(r)).toContain("missing:2026-10-28"); // cut-off 2026-10-29 03:30Z passed, nothing captured
    expect(keys(r)).not.toContain("missing:2026-10-29"); // live
    expect(keys(r)).not.toContain("missing:2026-10-30"); // earliest cut-off is Monday 2026-11-02 03:30Z
    expect(r.resolvable).toContain("missing:2026-10-29");
  });
  it("C. evaluation is deterministic, so an unchanged state produces no new issue actions on a repeat run", () => {
    const state = st({ ...fresh, enabledFrom: "2026-10-28", dates: {}, calendar: { "2026-10-28": "trading", "2026-10-29": "trading" } });
    const first = W.evaluate({ now, state });
    const open = first.wanted.map((w, i) => ({ number: i + 1, title: w.title, body: W.withMarker(w.body, hash(w.body)) }));
    expect(first.wanted.length).toBeGreaterThan(0);
    expect(W.planIssueActions({ ...W.evaluate({ now, state }), open, hash, titleOf })).toEqual([]);
  });
});
