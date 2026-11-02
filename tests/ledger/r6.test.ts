import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCapture, readExistingDaily, compareR6, type ExistingDaily } from "../../scripts/ledger/capture.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { applyCaptureToState } from "../../scripts/ledger/run.mts";
import { applyPublication, emptyState, validateState } from "../../scripts/ledger/state.mts";
import { last, makeEnv, makeFixture, tmpDir, type Fixture } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const root = (n: string) => path.join(tmp.dir, n);
const sessionOf = (run: Awaited<ReturnType<typeof runCapture>>) => run.sessions.find((s) => s.date === last)!;
/** Changes the ranking of the last session: a former loser becomes a +9.9% gainer. */
const changeRanking = (f: Fixture) => {
  const st = f.stocks[0];
  const prev = st.bars[st.bars.length - 2].close;
  const c = prev * 1.099;
  st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: prev, close: c, high: c * 1.001, low: prev * 0.999 };
};
const fileOf = async (r: string) => ledgerPaths(r).dailyFile((await makeEnv(r)).ruleVersion, last);

describe("R6: conflicting existing record", () => {
  it("1. no existing record: R6 passes, the capture proceeds and the check is part of the record's own report", async () => {
    const r = root("none");
    const run = await runCapture(makeFixture().source, await makeEnv(r));
    const s = sessionOf(run);
    expect(s.outcome).toBe("recorded");
    expect(s.r6?.status).toBe("pass");
    const daily = JSON.parse(await readFile(await fileOf(r), "utf-8"));
    expect(daily.header.readiness.checks.find((c: { id: string }) => c.id === "R6")).toMatchObject({ status: "pass", disposition: "ok" });
  });

  it("2. existing record with an identical prediction digest: reported as existing, nothing written, not a new capture", async () => {
    const r = root("identical");
    await runCapture(makeFixture().source, await makeEnv(r));
    const file = await fileOf(r);
    const before = await readFile(file, "utf-8");
    const run2 = await runCapture(makeFixture().source, await makeEnv(r, { now: new Date(`${last}T23:00:00Z`) })); // different generatedAt
    const s = sessionOf(run2);
    expect(s.outcome).toBe("exists");
    expect(s.r6).toMatchObject({ status: "existing" });
    expect(s.r6!.existingPredictionsSha256).toBe(s.r6!.candidatePredictionsSha256);
    expect(await readFile(file, "utf-8")).toBe(before);
    // In the mutable state it records the evidence but does not look like a new successful capture.
    const state = emptyState("2026-11-01T00:00:00Z");
    applyCaptureToState(state, await runCapture(makeFixture().source, await makeEnv(r)), { now: "2026-11-02T00:00:00Z", slot: null, ruleVersion: "mv1-aaaaaaaa", enabledVersion: "mv1-aaaaaaaa", enabledFrom: last, startedAt: "2026-11-02T00:00:00Z", captureSeconds: 1 });
    expect(state.lastSuccessfulCaptureAt).toBeNull();
    expect(state.dates[last].r6?.status).toBe("existing");
    expect(validateState(state)).toEqual([]);
  });

  it("3. existing record with a different prediction digest: anomaly, never overwritten", async () => {
    const r = root("different");
    await runCapture(makeFixture().source, await makeEnv(r));
    const file = await fileOf(r);
    const before = await readFile(file, "utf-8");
    const f2 = makeFixture();
    changeRanking(f2);
    const s = sessionOf(await runCapture(f2.source, await makeEnv(r, { now: new Date(`${last}T23:00:00Z`) })));
    expect(s.outcome).toBe("anomaly");
    expect(s.r6?.status).toBe("anomaly");
    expect(s.r6!.existingPredictionsSha256).not.toBe(s.r6!.candidatePredictionsSha256);
    expect(s.checks.find((c) => c.id === "R6")).toMatchObject({ status: "fail", disposition: "blocked" });
    expect(await readFile(file, "utf-8")).toBe(before);
    expect(await readdir(path.dirname(file))).toEqual([path.basename(file)]);
    // The anomaly lands in the mutable state, raising the status and keeping publication information.
    const state = emptyState("2026-11-01T00:00:00Z");
    state.dates[last] = applyPublication({ status: "recorded", reasons: [], sourceDataDate: last, generatedAt: "t", publicationClass: "live", earliestCutoffUtc: null, cutoffUtc: null, updatedAt: "2026-11-01T00:00:00Z" }, "live", [], "2026-11-01T00:00:00Z");
    const f3 = makeFixture();
    changeRanking(f3);
    const status = applyCaptureToState(state, await runCapture(f3.source, await makeEnv(r)), { now: "2026-11-02T00:00:00Z", slot: null, ruleVersion: "mv1-aaaaaaaa", enabledVersion: "mv1-aaaaaaaa", enabledFrom: last, startedAt: "2026-11-02T00:00:00Z", captureSeconds: 1 });
    expect(status).toBe("anomaly");
    expect(state.dates[last]).toMatchObject({ status: "anomaly", publicationClass: "live" });
    expect(state.dates[last].r6).toMatchObject({ status: "anomaly" });
    expect(state.dates[last].r6?.firstAnomalyAt).toBeTruthy();
    expect(validateState(state)).toEqual([]);
  });

  it("4. existing unreadable, truncated or invalid record: anomaly, never overwritten or repaired", async () => {
    const cases: [string, (good: string) => string][] = [
      ["garbage", () => "not json at all"],
      ["truncated", (good) => good.slice(0, Math.floor(good.length / 2))],
      ["empty", () => ""],
      ["invalid-schema", () => JSON.stringify({ kind: "momentum-ledger.daily", schemaVersion: 1, header: { sessionDate: last }, predictions: [] })],
    ];
    const good = await (async () => {
      const r = root("good-source");
      await runCapture(makeFixture().source, await makeEnv(r));
      return readFile(await fileOf(r), "utf-8");
    })();
    for (const [name, make] of cases) {
      const r = root(`bad-${name}`);
      const file = await fileOf(r);
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(file), { recursive: true });
      const bad = make(good);
      await writeFile(file, bad);
      const s = sessionOf(await runCapture(makeFixture().source, await makeEnv(r)));
      expect(s.outcome, name).toBe("anomaly");
      expect(s.r6?.status, name).toBe("anomaly");
      expect(await readFile(file, "utf-8"), name).toBe(bad);
    }
    expect(await readExistingDaily(path.join(tmp.dir, "missing.json"), { date: last, ruleVersion: "x" })).toEqual({ kind: "none" });
  });

  it("existing valid record but a fresh candidate cannot be built now: left untouched and reported as uncompared, not as a new capture", async () => {
    const r = root("uncompared");
    await runCapture(makeFixture().source, await makeEnv(r));
    const f2 = makeFixture();
    f2.source.refreshState.archives.stocks[last] = { status: "failed", checkedAt: "x", attempts: 4 };
    const s = sessionOf(await runCapture(f2.source, await makeEnv(r)));
    expect(s.outcome).toBe("exists");
    expect(s.r6?.status).toBe("existing-uncompared");
    expect(s.r6?.detail).toMatch(/R1/);
  });

  it("5. concurrent writers with identical predictions: exactly one creates the file, the others recognise the identical record", async () => {
    const r = root("race-same");
    const envs = await Promise.all([0, 1, 2, 3].map((i) => makeEnv(r, { now: new Date(`${last}T2${i}:00:00Z`) })));
    const runs = await Promise.all(envs.map((e) => runCapture(makeFixture().source, e)));
    const ss = runs.map(sessionOf);
    expect(ss.filter((s) => s.outcome === "recorded")).toHaveLength(1);
    expect(ss.filter((s) => s.outcome === "exists")).toHaveLength(3);
    expect(ss.filter((s) => s.outcome === "exists").every((s) => s.r6?.status === "existing")).toBe(true);
    expect(await readdir(ledgerPaths(r).predictionsDir(envs[0].ruleVersion))).toEqual([`${last}.json`]);
  });

  it("6. concurrent writers with different predictions: one creates the file, the other reports an anomaly", async () => {
    const r = root("race-diff");
    const fa = makeFixture();
    const fb = makeFixture();
    changeRanking(fb);
    const [ea, eb] = await Promise.all([makeEnv(r, { now: new Date(`${last}T20:00:00Z`) }), makeEnv(r, { now: new Date(`${last}T20:01:00Z`) })]);
    const [ra, rb] = await Promise.all([runCapture(fa.source, ea), runCapture(fb.source, eb)]);
    const outcomes = [sessionOf(ra).outcome, sessionOf(rb).outcome].sort();
    expect(outcomes).toEqual(["anomaly", "recorded"]);
    const files = await readdir(ledgerPaths(r).predictionsDir(ea.ruleVersion));
    expect(files).toEqual([`${last}.json`]); // never two files, never a partial
    const winner = [ra, rb].map(sessionOf).find((s) => s.outcome === "recorded")!;
    const stored = JSON.parse(await readFile(await fileOf(r), "utf-8"));
    expect(stored.header.predictionsSha256).toBe(winner.r6!.candidatePredictionsSha256);
  });
});

describe("compareR6 (pure)", () => {
  const ok: ExistingDaily = { kind: "valid", predictionsSha256: "a", universeLists: [] };
  it("covers every row of the approved table", () => {
    expect(compareR6({ kind: "none" }, "a", null).status).toBe("pass");
    expect(compareR6(ok, "a", null).status).toBe("existing");
    expect(compareR6(ok, "b", null).status).toBe("anomaly");
    expect(compareR6({ kind: "invalid", problems: ["x"] }, "a", null).status).toBe("anomaly");
    expect(compareR6(ok, null, "R1").status).toBe("existing-uncompared");
  });
});

// ---------------------------------------------------------------------------------------------------------------
// F2 (constituent-list refresh) and R6 evidence preservation
// ---------------------------------------------------------------------------------------------------------------
import { evaluateGate } from "../../scripts/ledger/gate.mts";
import { R6_UNCOMPARED_WARN_RUNS, type LedgerState } from "../../scripts/ledger/state.mts";

const ctx = (n: number) => ({ now: `2026-11-0${Math.min(n, 9)}T00:00:00Z`, slot: null, ruleVersion: "mv1-aaaaaaaa", enabledVersion: "mv1-aaaaaaaa", enabledFrom: last, startedAt: `2026-11-0${Math.min(n, 9)}T00:00:00Z`, captureSeconds: 1 });
const removeSymbol = (f: Fixture, symbol: string, fetchedAt = "2030-01-01T00:00:00Z") => {
  for (const slug of ["nifty500", "microcap250"]) {
    const c = f.source.dataset.constituents[slug];
    c.constituents = c.constituents.filter((x) => x.symbol !== symbol);
    c.fetchedAt = fetchedAt;
  }
};
async function recordFirst(name: string) {
  const r = root(name);
  const env = await makeEnv(r);
  await runCapture(makeFixture().source, env);
  const daily = JSON.parse(await readFile(ledgerPaths(r).dailyFile(env.ruleVersion, last), "utf-8"));
  return { r, env, file: ledgerPaths(r).dailyFile(env.ruleVersion, last), inPool: new Set<string>(daily.predictions.map((p: { symbol: string }) => p.symbol)), before: await readFile(ledgerPaths(r).dailyFile(env.ruleVersion, last), "utf-8") };
}

describe("F2: a constituent-list refresh is not a 'different predictions' anomaly", () => {
  it("a real-looking refresh (new fetchedAt AND changed universe contents) gives existing-uncompared / constituent-lists-refreshed, with both identities recorded", async () => {
    const { r, file, before, inPool } = await recordFirst("f2-refresh");
    const victim = [...inPool][0];
    const f2 = makeFixture();
    removeSymbol(f2, victim);
    const s = sessionOf(await runCapture(f2.source, await makeEnv(r, { now: new Date(`${last}T23:00:00Z`) })));
    expect(s.outcome).toBe("exists"); // NOT anomaly
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.changedLists).toContain("nifty500");
    expect(s.r6!.universe!.fetchedAtChanged).toBe(true);
    expect(s.r6!.universe!.stored.find((l) => l.slug === "nifty500")!.sha256).not.toBe(s.r6!.universe!.current.find((l) => l.slug === "nifty500")!.sha256);
    expect(s.r6!.candidatePredictionsSha256).not.toBe(s.r6!.existingPredictionsSha256); // the digests really do differ...
    expect(s.checks.find((c) => c.id === "R6")).toMatchObject({ status: "warn", disposition: "ok" }); // ...and that is visible, not blocking
    expect(await readFile(file, "utf-8")).toBe(before); // the record is untouched
  });

  it("the state shows it, never counts it as a successful comparison, and stays uncompared on every later run while the lists differ", async () => {
    const { r, inPool } = await recordFirst("f2-subsequent");
    const victim = [...inPool][0];
    const state = emptyState("2026-11-01T00:00:00Z");
    for (let i = 1; i <= 4; i++) {
      const f = makeFixture();
      removeSymbol(f, victim);
      applyCaptureToState(state, await runCapture(f.source, await makeEnv(r, { now: new Date(`${last}T2${i}:00:00Z`) })), ctx(i));
      expect(state.dates[last].r6, `run ${i}`).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed", uncomparedRuns: i });
      expect(state.dates[last].status).not.toBe("anomaly");
    }
    expect(state.dates[last].r6Events!.map((e) => e.status)).toEqual(["existing-uncompared"]); // one event, not four duplicates
    expect(validateState(state)).toEqual([]);
    const gate = evaluateGate({ state: { ...state, runStatus: "ok" }, captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" });
    expect(gate.exitCode).toBe(0);
    expect(gate.warnings.join()).toMatch(/constituent lists changed.*not a successful comparison/);
  });

  it("if the lists return to what the record used, a real comparison happens again and its result is honest", async () => {
    const { r, inPool } = await recordFirst("f2-restored");
    const state = emptyState("2026-11-01T00:00:00Z");
    const f = makeFixture();
    removeSymbol(f, [...inPool][0]);
    applyCaptureToState(state, await runCapture(f.source, await makeEnv(r)), ctx(1));
    applyCaptureToState(state, await runCapture(makeFixture().source, await makeEnv(r, { now: new Date(`${last}T22:00:00Z`) })), ctx(2));
    expect(state.dates[last].r6).toMatchObject({ status: "existing" });
    expect(state.dates[last].r6Events!.map((e) => e.status)).toEqual(["existing-uncompared", "existing"]);
  });

  it("a changed fetch time alone (identical list contents) does NOT excuse a different digest: that stays an anomaly", async () => {
    const { r } = await recordFirst("f2-fetchedat-only");
    const f = makeFixture();
    for (const slug of ["nifty500", "microcap250"]) f.source.dataset.constituents[slug].fetchedAt = "2030-01-01T00:00:00Z";
    changeRanking(f);
    const s = sessionOf(await runCapture(f.source, await makeEnv(r)));
    expect(s.outcome).toBe("anomaly");
    expect(s.r6!.universe).toMatchObject({ changedLists: [], fetchedAtChanged: true });
  });

  it("a re-fetch that changes only the fetch time (same contents, same predictions) is a normal, successful comparison", async () => {
    const { r } = await recordFirst("f2-harmless");
    const f = makeFixture();
    for (const slug of ["nifty500", "microcap250"]) f.source.dataset.constituents[slug].fetchedAt = "2030-01-01T00:00:00Z";
    const s = sessionOf(await runCapture(f.source, await makeEnv(r)));
    expect(s.r6).toMatchObject({ status: "existing" });
    expect(s.r6!.universe).toMatchObject({ changedLists: [], fetchedAtChanged: true });
  });
});

describe("R6 evidence is preserved and an unresolved anomaly can never look clean", () => {
  async function anomalyThen(more: (r: string) => Promise<Awaited<ReturnType<typeof runCapture>>[]>) {
    const { r } = await recordFirst(`ev-${Math.random().toString(36).slice(2, 6)}`);
    const state = emptyState("2026-11-01T00:00:00Z");
    const fa = makeFixture();
    changeRanking(fa);
    applyCaptureToState(state, await runCapture(fa.source, await makeEnv(r)), ctx(1));
    expect(state.dates[last].status).toBe("anomaly");
    const firstEvidence = JSON.stringify(state.dates[last].r6);
    let i = 2;
    for (const run of await more(r)) applyCaptureToState(state, run, ctx(i++));
    return { state, firstEvidence, r };
  }

  it("anomaly followed by existing-uncompared (inputs unavailable): the anomaly evidence is kept, the status stays anomaly", async () => {
    const { state, firstEvidence } = await anomalyThen(async (r) => {
      const f = makeFixture();
      f.source.refreshState.archives.stocks[last] = { status: "failed", checkedAt: "x", attempts: 4 };
      return [await runCapture(f.source, await makeEnv(r))];
    });
    const rec = state.dates[last];
    expect(rec.status).toBe("anomaly");
    expect(rec.r6!.status).toBe("anomaly"); // not replaced
    expect(rec.r6!.latestObservation).toMatchObject({ status: "existing-uncompared", reasonCode: "inputs-not-ready" });
    expect(rec.r6!.existingPredictionsSha256).toBe(JSON.parse(firstEvidence).existingPredictionsSha256);
    expect(rec.r6Events![0].status).toBe("anomaly");
    expect(rec.r6Events!.map((e) => e.status)).toEqual(["anomaly", "existing-uncompared"]);
  });

  it("anomaly followed by an identical candidate: still anomaly (not cleared by a later clean-looking result); the later result is an observation", async () => {
    const { state } = await anomalyThen(async (r) => [await runCapture(makeFixture().source, await makeEnv(r))]);
    const rec = state.dates[last];
    expect(rec.status).toBe("anomaly");
    expect(rec.r6!.status).toBe("anomaly");
    expect(rec.r6!.latestObservation).toMatchObject({ status: "existing" });
    expect(rec.r6Events!.map((e) => e.status)).toEqual(["anomaly", "existing"]);
    expect(state.runStatus).toBe("anomaly"); // the run does not report a clean success
  });

  it("repeated inability to compare becomes visible: counted, and after the threshold a warning is written to the record", async () => {
    const { r } = await recordFirst("ev-repeat");
    const state = emptyState("2026-11-01T00:00:00Z");
    for (let i = 1; i <= R6_UNCOMPARED_WARN_RUNS + 1; i++) {
      const f = makeFixture();
      f.source.refreshState.archives.stocks[last] = { status: "failed", checkedAt: "x", attempts: 4 };
      applyCaptureToState(state, await runCapture(f.source, await makeEnv(r)), ctx(i));
    }
    const rec = state.dates[last];
    expect(rec.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "inputs-not-ready", uncomparedRuns: R6_UNCOMPARED_WARN_RUNS + 1 });
    expect(rec.reasons.some((x) => /could not compare for \d+ consecutive runs/.test(x))).toBe(true);
    const gate = evaluateGate({ state: state as LedgerState, captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" });
    expect(gate.warnings.join()).toMatch(/could not be compared for \d+ consecutive runs/);
    expect(gate.exitCode).toBe(0); // a warning, not a failure
  });

  it("the gate fails while ANY date has an unresolved anomaly, even if the latest run status says ok", () => {
    const state = emptyState("2026-11-01T00:00:00Z");
    state.runStatus = "ok";
    state.dates[last] = { status: "anomaly", reasons: ["R6: …"], sourceDataDate: last, generatedAt: null, publicationClass: "live", earliestCutoffUtc: null, cutoffUtc: null, updatedAt: "2026-11-01T00:00:00Z" };
    const g = evaluateGate({ state, captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" });
    expect(g.exitCode).toBe(1);
    expect(g.errors.join()).toMatch(/Unresolved anomaly on/);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// B2: the list fingerprint covers every prediction-relevant field
// ---------------------------------------------------------------------------------------------------------------
describe("B2: constituent fingerprints cover symbol, company name AND industry", () => {
  const edit = (f: Fixture, symbol: string, change: (c: { symbol: string; companyName: string; industry: string }) => void) => {
    for (const slug of ["nifty500", "microcap250"]) {
      const c = f.source.dataset.constituents[slug];
      c.fetchedAt = "2030-01-01T00:00:00Z";
      for (const x of c.constituents) if (x.symbol === symbol) change(x);
    }
  };
  it("an industry-only change (same symbols, new fetch time) is existing-uncompared / constituent-lists-refreshed - NOT an unexplained anomaly", async () => {
    const { r, file, before, inPool } = await recordFirst("b2-industry");
    const f = makeFixture();
    edit(f, [...inPool][0], (c) => (c.industry = "Totally Different Industry"));
    const s = sessionOf(await runCapture(f.source, await makeEnv(r, { now: new Date(`${last}T23:00:00Z`) })));
    expect(s.outcome).toBe("exists");
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.changedLists.length).toBeGreaterThan(0);
    expect(s.r6!.universe!.symbolSetChangedLists).toEqual([]); // told apart from a membership change
    expect(s.r6!.detail).toMatch(/labels only, the symbols are identical/);
    expect(await readFile(file, "utf-8")).toBe(before);
  });
  it("a company-name-only change is treated the same way", async () => {
    const { r, inPool } = await recordFirst("b2-name");
    const f = makeFixture();
    edit(f, [...inPool][0], (c) => (c.companyName = "Renamed Company Ltd."));
    const s = sessionOf(await runCapture(f.source, await makeEnv(r)));
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.symbolSetChangedLists).toEqual([]);
  });
  it("an actual symbol change is reported as a membership change", async () => {
    const { r, inPool } = await recordFirst("b2-symbol");
    const f = makeFixture();
    removeSymbol(f, [...inPool][0]);
    const s = sessionOf(await runCapture(f.source, await makeEnv(r)));
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.symbolSetChangedLists).toContain("nifty500");
    expect(s.r6!.detail).toMatch(/membership changed/);
  });
  it("a genuine anomaly is still an anomaly when the lists (every field) are identical", async () => {
    const { r } = await recordFirst("b2-genuine");
    const f = makeFixture();
    for (const slug of ["nifty500", "microcap250"]) f.source.dataset.constituents[slug].fetchedAt = "2030-01-01T00:00:00Z"; // fetch time only
    changeRanking(f);
    const s = sessionOf(await runCapture(f.source, await makeEnv(r)));
    expect(s.outcome).toBe("anomaly");
    expect(s.r6!.universe).toMatchObject({ changedLists: [], symbolSetChangedLists: [] });
  });
  it("the stored identity contains both the full-entry hash and the symbol-only hash", async () => {
    const { file } = await recordFirst("b2-identity");
    const lists = JSON.parse(await readFile(file, "utf-8")).header.sourceData.universe.lists;
    expect(lists.length).toBe(4);
    for (const l of lists) expect(l).toMatchObject({ sha256: expect.stringMatching(/^[0-9a-f]{64}$/), symbolsSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(lists[0].sha256).not.toBe(lists[0].symbolsSha256);
  });
});
