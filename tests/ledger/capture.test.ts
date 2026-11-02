import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { runCapture, type CaptureSource } from "../../scripts/ledger/capture.mts";
import { validateDaily } from "../../scripts/ledger/validate.mts";
import { ledgerPaths, READINESS, POOL } from "../../scripts/ledger/constants.mts";
import { dates, last, makeEnv, makeFixture, prevDate, tmpDir, truncateLast } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => {
  tmp = await tmpDir();
});
afterAll(async () => tmp.cleanup());

const read = async (file: string) => JSON.parse(await readFile(file, "utf-8"));

async function capture(over: { mutate?: (s: CaptureSource, f: ReturnType<typeof makeFixture>) => void; root?: string; env?: Parameters<typeof makeEnv>[1] } = {}) {
  const f = makeFixture();
  over.mutate?.(f.source, f);
  const root = over.root ?? path.join(tmp.dir, `r${Math.random().toString(36).slice(2)}`);
  const env = await makeEnv(root, over.env);
  const run = await runCapture(f.source, env);
  return { run, root, env, f, session: run.sessions.find((s) => s.date === last)! };
}

describe("daily capture: record correctness", () => {
  it("writes one valid, schema-checked file per trading date with the application's own results", async () => {
    const { session, env, root } = await capture();
    expect(session.outcome).toBe("recorded");
    const file = ledgerPaths(root).dailyFile(env.ruleVersion, last);
    const daily = await read(file);
    expect(validateDaily(daily, { date: last, ruleVersion: env.ruleVersion })).toEqual([]);
    expect(daily.kind).toBe("momentum-ledger.daily");
    expect(daily.header.source).toBe("live-capture");
    expect(daily.header.filings).toBeNull();
    expect(JSON.stringify(daily.predictions)).not.toMatch(/forwardReturn|"outcome"|"mfe"|"mae"|"filings"/);
  });

  it("stores each stock once, keeping every list membership and the rank within each list", async () => {
    const { root, env } = await capture();
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    const symbols = daily.predictions.map((p: { symbol: string }) => p.symbol);
    expect(new Set(symbols).size).toBe(symbols.length);
    const multi = daily.predictions.filter((p: { lists: unknown[] }) => p.lists.length > 1);
    expect(multi.length).toBeGreaterThan(0); // volume spikes overlap with price movers
    for (const list of ["gainer", "loser", "volume"] as const) {
      const declared: string[] = daily.header.lists[list];
      expect(declared.length).toBeLessThanOrEqual(POOL[list === "gainer" ? "gainers" : list === "loser" ? "losers" : "volume"]);
      declared.forEach((sym, i) => {
        const p = daily.predictions.find((x: { symbol: string }) => x.symbol === sym);
        expect(p.lists.find((l: { list: string }) => l.list === list).rank).toBe(i + 1);
      });
    }
    // Every membership carries the classification as shown in that list.
    for (const p of daily.predictions) for (const l of p.lists) expect(l).toMatchObject({ setup: p.classification.setup, evidence: p.classification.evidence, netScore: p.classification.netScore });
  });

  it("reconstructs the top-20 gainers and losers exactly from the stored ranks", async () => {
    const { root, env } = await capture();
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    for (const list of ["gainer", "loser"] as const) {
      const top20 = daily.predictions
        .filter((p: { lists: { list: string; rank: number }[] }) => p.lists.some((l) => l.list === list && l.rank <= 20))
        .sort((a: any, b: any) => a.lists.find((l: any) => l.list === list).rank - b.lists.find((l: any) => l.list === list).rank)
        .map((p: { symbol: string }) => p.symbol);
      expect(top20).toEqual(daily.header.lists[list].slice(0, 20));
    }
  });

  it("records the ACTUAL effective settings and rule constants, not a hash alone", async () => {
    const { root, env } = await capture();
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    expect(daily.header.config.settings).toEqual(DEFAULT_SETTINGS);
    expect(daily.header.config.settingsReadByMomentum).toHaveLength(11);
    expect(daily.header.config.rules.MOMENTUM_RULES.strongCloseLocation).toBe(0.7);
    expect(daily.header.config.calcConstants.PRICE_BREAK_RATIO).toBe(0.6);
    expect(daily.header.config.pool).toEqual({ gainers: 50, losers: 50, volume: 50 });
  });

  it("records manifest and source metadata, input digests, the rule-version file hashes and the run identity", async () => {
    const { root, env, f } = await capture();
    const h = (await read(ledgerPaths(root).dailyFile(env.ruleVersion, last))).header;
    expect(h.sourceData.manifest).toMatchObject({ schemaVersion: 2, latestMarketDate: last });
    expect(h.sourceData.refreshState.index.status).toBe("ok");
    expect(h.sourceData.universe).toMatchObject({ symbolCount: 750 });
    expect(h.sourceData.universe.symbols).toHaveLength(750);
    expect(h.inputDigest.perSymbol).toHaveLength(750);
    expect(Object.keys(h.inputDigest.indexSeries)).toHaveLength(20);
    expect(h.model.ruleFiles).toHaveLength(22);
    expect(h.github).toMatchObject({ runId: "123", repository: "o/r" });
    expect(h.sourceData.files).toEqual(f.source.files);
    expect(h.generatedAt).toBe(env.now.toISOString());
  });

  it("is deterministic: the same inputs produce byte-identical files", async () => {
    const a = await capture();
    const b = await capture();
    const fa = await readFile(ledgerPaths(a.root).dailyFile(a.env.ruleVersion, last), "utf-8");
    const fb = await readFile(ledgerPaths(b.root).dailyFile(b.env.ruleVersion, last), "utf-8");
    expect(fa).toBe(fb);
  });

  it("records the actual pool size and the reason when fewer stocks qualify (nothing is fabricated)", async () => {
    // Make every stock flat on the last session except a handful: far fewer than 50 gainers and losers.
    const { root, env } = await capture({
      mutate: (_s, f) => {
        for (const st of f.stocks.slice(10)) {
          const b = st.bars[st.bars.length - 1];
          const p = st.bars[st.bars.length - 2];
          st.bars[st.bars.length - 1] = { ...b, open: p.close, close: p.close, high: p.close * 1.01, low: p.close * 0.99 };
        }
      },
    });
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    expect(daily.header.lists.gainer.length).toBeLessThan(50);
    const sf = daily.header.market.poolShortfalls.find((s: { list: string }) => s.list === "gainer");
    expect(sf).toMatchObject({ expected: 50, actual: daily.header.lists.gainer.length });
    expect(sf.reason).toMatch(/Only \d+ eligible stock/);
  });
});

describe("daily capture: create-only behaviour", () => {
  it("never overwrites an existing daily file: a repeat run leaves it byte-identical", async () => {
    const first = await capture();
    const file = ledgerPaths(first.root).dailyFile(first.env.ruleVersion, last);
    const before = await readFile(file, "utf-8");
    const f2 = makeFixture();
    const env2 = await makeEnv(first.root, { now: new Date(`${last}T22:00:00Z`) });
    const run2 = await runCapture(f2.source, env2);
    expect(run2.sessions.find((s) => s.date === last)?.outcome).toBe("exists");
    expect(await readFile(file, "utf-8")).toBe(before);
  });

  it("concurrent runs create exactly one file and leave no partial files", async () => {
    const root = path.join(tmp.dir, "concurrent");
    const f = makeFixture();
    const envs = await Promise.all([0, 1, 2, 3].map((i) => makeEnv(root, { now: new Date(`${last}T2${i}:00:00Z`) })));
    const runs = await Promise.all(envs.map((e) => runCapture(f.source, e)));
    const outcomes = runs.map((r) => r.sessions.find((s) => s.date === last)?.outcome);
    expect(outcomes.filter((o) => o === "recorded")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "exists")).toHaveLength(3);
    const dir = ledgerPaths(root).predictionsDir(envs[0].ruleVersion);
    expect(await readdir(dir)).toEqual([`${last}.json`]);
  });

  it("captures only sessions on or after the enabled date: no historical backfill", async () => {
    const { root, env, run } = await capture({ env: { enabledFrom: last } });
    expect(run.sessions.map((s) => s.date)).toEqual([last]);
    expect(await readdir(ledgerPaths(root).predictionsDir(env.ruleVersion))).toEqual([`${last}.json`]);
  });

  it("writes nothing and says so when no rule version is enabled (fail closed)", async () => {
    const { run, root } = await capture({ env: { enabledVersion: null, enabledFrom: null } });
    expect(run.sessions[0].outcome).toBe("not-enabled");
    await expect(stat(ledgerPaths(root).root)).rejects.toThrow();
  });
});

describe("R10 source revisions", () => {
  it("flags a past session whose stored rows changed, without blocking a new capture and without touching the old record", async () => {
    const root = path.join(tmp.dir, "r10");
    const f1 = truncateLast(makeFixture());
    const env1 = await makeEnv(root, { enabledFrom: prevDate });
    const run1 = await runCapture(f1.source, env1);
    expect(run1.sessions.map((s) => `${s.date}:${s.outcome}`)).toEqual([`${prevDate}:recorded`]);
    const oldFile = ledgerPaths(root).dailyFile(env1.ruleVersion, prevDate);
    const oldBytes = await readFile(oldFile, "utf-8");
    const f2 = makeFixture();
    // Revise one stored close inside the previous session's window.
    const st = f2.source.dataset.stocks["S005"];
    st.bars[st.bars.length - 5] = { ...st.bars[st.bars.length - 5], close: st.bars[st.bars.length - 5].close * 1.02 };
    const run2 = await runCapture(f2.source, await makeEnv(root, { enabledFrom: prevDate }));
    expect(run2.r10Sessions.find((s) => s.date === prevDate)).toMatchObject({ ok: false, changedSymbols: ["S005"] });
    expect(run2.r10.disposition).toBe("flag");
    expect(run2.sessions.find((s) => s.date === last)?.outcome).toBe("recorded"); // new capture not blocked
    expect(await readFile(oldFile, "utf-8")).toBe(oldBytes); // original untouched
  });
});

describe("sanity", () => {
  it("fixture has the expected shape", () => {
    expect(dates).toHaveLength(90);
    expect(READINESS.R4.fraction).toBe(0.9);
  });
});

describe("readiness at capture level: nothing is written unless every blocking check passes", () => {
  const dropLast = (f: ReturnType<typeof makeFixture>, idx: number[]) => {
    for (const i of idx) {
      const s = f.stocks[i];
      s.bars.pop();
      f.activity[s.symbol].pop();
    }
  };
  const nothingWritten = async (root: string, env: { ruleVersion: string }) => expect(await readdir(ledgerPaths(root).predictionsDir(env.ruleVersion)).catch(() => [])).toEqual([]);

  it("R1: archives not ok => waiting, no file", async () => {
    const { session, root, env } = await capture({ mutate: (s) => { s.refreshState.archives.stocks[last] = { status: "failed", checkedAt: "x", attempts: 4 }; } });
    expect(session.outcome).toBe("waiting");
    expect(session.reasons.join()).toMatch(/R1/);
    await nothingWritten(root, env);
  });
  it("R2: an index series without a bar => waiting", async () => {
    const { session } = await capture({ mutate: (s) => { s.dataset.indexSeries["auto"].bars.pop(); } });
    expect(session.outcome).toBe("waiting");
    expect(session.reasons.join()).toMatch(/R2/);
  });
  it("R3: volume rows missing for >1% of stocks => blocked (a few missing is recorded, not blocked)", async () => {
    const many = await capture({ mutate: (_s, f) => { for (let i = 0; i < 60; i++) f.activity[f.stocks[i].symbol].pop(); } });
    expect(many.session.outcome).toBe("blocked");
    expect(many.session.reasons.join()).toMatch(/R3/);
    const few = await capture({ mutate: (_s, f) => { for (let i = 0; i < 5; i++) f.activity[f.stocks[i].symbol].pop(); } });
    expect(few.session.outcome).toBe("recorded");
    const daily = await read(ledgerPaths(few.root).dailyFile(few.env.ruleVersion, last));
    expect(daily.header.market.volumeRowsMissing).toHaveLength(5);
  });
  it("R4: a truncated bhavcopy (15% of stocks missing) => blocked", async () => {
    const { session } = await capture({ mutate: (_s, f) => dropLast(f, Array.from({ length: 112 }, (_, i) => i * 6 + 1)) });
    expect(session.outcome).toBe("blocked");
    expect(session.checks.find((c) => c.id === "R4")?.status).toBe("fail");
  });
  it("R5: a truncated constituent list => blocked", async () => {
    const { session } = await capture({ mutate: (s) => { s.dataset.constituents["microcap250"].constituents.length = 120; } });
    expect(session.outcome).toBe("blocked");
    expect(session.reasons.join()).toMatch(/R5/);
  });
  it("R7: a stale manifest waits, a failed refresh blocks", async () => {
    const stale = await capture({ mutate: (s) => { s.dataset.manifest.latestMarketDate = prevDate; } });
    expect(stale.session.outcome).toBe("waiting");
    const failed = await capture({ mutate: (s) => { s.dataset.manifest.refresh!.outcome = "failed"; } });
    expect(failed.session.outcome).toBe("blocked");
  });
  it("R8: a computed rule version that is not the enabled one => blocked", async () => {
    const { session } = await capture({ env: { enabledVersion: "mv1-00000000" } });
    expect(session.outcome).toBe("blocked");
    expect(session.reasons.join()).toMatch(/R8/);
  });
  it("R9: two vanished stocks block, one is recorded with the affected symbol preserved", async () => {
    const two = await capture({ mutate: (_s, f) => dropLast(f, [3, 4]) });
    expect(two.session.outcome).toBe("blocked");
    expect(two.session.checks.find((c) => c.id === "R9")?.affected).toEqual(["S003", "S004"]);
    const one = await capture({ mutate: (_s, f) => dropLast(f, [3]) });
    expect(one.session.outcome).toBe("recorded");
    const daily = await read(ledgerPaths(one.root).dailyFile(one.env.ruleVersion, last));
    expect(daily.header.market.noBarToday).toEqual(["S003"]);
    expect(daily.header.readiness.warnings.join()).toMatch(/R9/);
  });
  it("R11: three simultaneous 1:1 bonus-style breaks raise a review flag, are recorded with evidence, and do not block", async () => {
    const { session, root, env } = await capture({
      mutate: (_s, f) => {
        for (const i of [10, 11, 12]) {
          const st = f.stocks[i];
          const prev = st.bars[st.bars.length - 2].close;
          st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: prev * 0.5, close: prev * 0.5, high: prev * 0.51, low: prev * 0.49 };
        }
      },
    });
    expect(session.outcome).toBe("recorded");
    expect(session.checks.find((c) => c.id === "R11")).toMatchObject({ status: "warn", disposition: "flag" });
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    expect(daily.header.market.excluded.map((e: { symbol: string }) => e.symbol).sort()).toEqual(["S010", "S011", "S012"]);
    expect(daily.header.market.excluded[0]).toMatchObject({ reason: "corporate-action-break", closeRatio: 0.5, openRatio: 0.5 });
    expect(daily.predictions.some((p: { symbol: string }) => ["S010", "S011", "S012"].includes(p.symbol))).toBe(false); // not ranked, but never silently discarded
    expect(daily.header.readiness.warnings.join()).toMatch(/R11/);
  });
  it("a single genuine corporate action is recorded as excluded evidence without a flag", async () => {
    const { session, root, env } = await capture({
      mutate: (_s, f) => {
        const st = f.stocks[20];
        const prev = st.bars[st.bars.length - 2].close;
        st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: prev * 0.5, close: prev * 0.5, high: prev * 0.51, low: prev * 0.49 };
      },
    });
    expect(session.checks.find((c) => c.id === "R11")?.status).toBe("pass");
    const daily = await read(ledgerPaths(root).dailyFile(env.ruleVersion, last));
    expect(daily.header.market.excluded).toHaveLength(1);
    expect(daily.header.market.excluded[0].symbol).toBe("S020");
  });
  it("ordinary large moves are never treated as corrupted data", async () => {
    const { session } = await capture({ mutate: (_s, f) => { const st = f.stocks[30]; const p = st.bars[st.bars.length - 2].close; st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: p * 1.01, close: p * 1.22, high: p * 1.23, low: p * 1.0 }; } });
    expect(session.outcome).toBe("recorded");
    expect(session.checks.find((c) => c.id === "R11")?.status).toBe("pass");
  });
});

describe("R5 across snapshots", () => {
  it("first snapshot uses nominal sizes, the next uses the previous live snapshot, and a refreshed list skips the comparison", async () => {
    const root = path.join(tmp.dir, "r5");
    const f1 = truncateLast(makeFixture());
    const run1 = await runCapture(f1.source, await makeEnv(root, { enabledFrom: prevDate }));
    expect(run1.sessions[0].checks.find((c) => c.id === "R5")).toMatchObject({ mode: "bootstrap-nominal", status: "pass" });
    const run2 = await runCapture(makeFixture().source, await makeEnv(root, { enabledFrom: prevDate }));
    expect(run2.sessions.find((s) => s.date === last)?.checks.find((c) => c.id === "R5")).toMatchObject({ mode: "previous-live", status: "pass" });
    const refreshed = makeFixture();
    refreshed.source.dataset.constituents["nifty500"].fetchedAt = "2030-01-01T00:00:00Z";
    const root2 = path.join(tmp.dir, "r5b");
    await runCapture(truncateLast(makeFixture()).source, await makeEnv(root2, { enabledFrom: prevDate }));
    const run3 = await runCapture(refreshed.source, await makeEnv(root2, { enabledFrom: prevDate }));
    expect(run3.sessions.find((s) => s.date === last)?.checks.find((c) => c.id === "R5")?.mode).toBe("list-refreshed");
  });
  it("never uses a replay file as the live baseline", async () => {
    const root = path.join(tmp.dir, "r5replay");
    const env = await makeEnv(root, { enabledFrom: last });
    const { mkdir, writeFile } = await import("node:fs/promises");
    const dir = ledgerPaths(root).predictionsDir(env.ruleVersion);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${prevDate}.json`), JSON.stringify({ header: { sessionDate: prevDate, source: "replay", sourceData: { universe: { symbolCount: 10, fetchedAt: "t", symbols: [] } }, inputDigest: {} }, predictions: [] }));
    const run = await runCapture(makeFixture().source, env);
    const r5 = run.sessions.find((s) => s.date === last)!.checks.find((c) => c.id === "R5")!;
    expect(r5.mode).toBe("nominal-only"); // the replay snapshot (10 symbols) was NOT used as a baseline
    expect(r5.status).not.toBe("fail");
  });
});
