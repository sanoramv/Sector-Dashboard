/**
 * EXPERIMENTAL shadow predictions (docs/research/SHADOW_PREDICTIONS.md). Capture runs on the real public data into
 * temporary directories (nothing in the repository is written). No shadow-variant outcome of a real session is computed
 * here; the engine-path check only recomputes mv1 outcomes that are already stored and compares them for equality.
 */
import { cp, mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadSource, type CaptureSource } from "../../scripts/ledger/capture.mts";
import { prepareUniverse, type PreparedUniverse } from "../../src/lib/momentum/universe.ts";
import { VARIANTS, isMv1Breakout, shadowVersions, versionIdOf, type ShadowInput } from "../../scripts/shadow/definitions.mts";
import { buildShadowFile, checkAgainstMv1, runShadowCapture, shadowCandidates, validateActivation, validateShadowFile, type ShadowFile } from "../../scripts/shadow/capture.mts";
import { bh, bootDraws, checkpointState, contrast, METRICS, outcomeOf, type Obs } from "../../scripts/shadow/evaluate.mts";
import { calendarInputs } from "../../scripts/ledger/outcome-runner.mts";
import { loadRunnerMarket } from "../../scripts/ledger/outcome-inputs.mts";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";

const ROOT = path.resolve(__dirname, "../..");
const DATA = path.join(ROOT, "public", "data");
const LEDGER = path.join(DATA, "ledger");
const RV = "mv1-8ecef864";
const SESSIONS = ["2026-11-19", "2026-11-20", "2026-11-23"];
const hasData = SESSIONS.every((d) => existsSync(path.join(LEDGER, "live", "predictions", RV, `${d}.json`)));

const base: ShadowInput = { rank: 10, changePct: 4, label: "possible-breakout", breakoutToday: true, distancePct: 2 };
const inc = (id: string, r: Partial<ShadowInput>) => VARIANTS.find((v) => v.id === id)!.include({ ...base, ...r });

describe("shadow definitions (v1, pre-declared)", () => {
  it("BO-wide: the mv1 breakout label at any rank", () => {
    expect(inc("bo-wide", { rank: 300 })).toBe(true);
    expect(inc("bo-wide", { label: "mixed-signals" })).toBe(false);
    expect(inc("bo-wide", { changePct: 15 })).toBe(true);
  });
  it("BO-raw: close above the 60-session high, change < 10, distance < 7; no label, gate or rank condition", () => {
    expect(inc("bo-raw", { label: "insufficient-evidence", rank: 400 })).toBe(true);
    expect(inc("bo-raw", { label: "extended-reversal-risk" })).toBe(true);
    expect(inc("bo-raw", { breakoutToday: false })).toBe(false);
    expect(inc("bo-raw", { breakoutToday: null, distancePct: null })).toBe(false);
    expect(inc("bo-raw", { changePct: 9.999 })).toBe(true);
    expect(inc("bo-raw", { changePct: 10 })).toBe(false);
    expect(inc("bo-raw", { distancePct: 6.999 })).toBe(true);
    expect(inc("bo-raw", { distancePct: 7 })).toBe(false);
  });
  it("BO-cap10: production breakout in the top 50 with change < 10", () => {
    expect(inc("bo-cap10", { rank: 50 })).toBe(true);
    expect(inc("bo-cap10", { rank: 51 })).toBe(false);
    expect(inc("bo-cap10", { changePct: 10 })).toBe(false);
    expect(inc("bo-cap10", { label: "momentum-continuation" })).toBe(false);
  });
  it("the mv1 comparator is the top-50 breakout list", () => {
    expect(isMv1Breakout({ rank: 50, label: "possible-breakout" })).toBe(true);
    expect(isMv1Breakout({ rank: 51, label: "possible-breakout" })).toBe(false);
  });
  it("version identifiers are deterministic and change with the definition, mv1 version or rule file", async () => {
    const a = await shadowVersions(ROOT, RV);
    const b = await shadowVersions(ROOT, RV);
    expect(a.map((v) => v.versionId)).toEqual(b.map((v) => v.versionId));
    expect(new Set(a.map((v) => v.versionId)).size).toBe(3);
    for (const v of a) expect(v.versionId).toMatch(new RegExp(`^${v.id}-v1-[0-9a-f]{8}$`));
    const v0 = VARIANTS[0];
    const id = versionIdOf(v0, RV, "x".repeat(64));
    expect(versionIdOf({ ...v0, definition: v0.definition + " " }, RV, "x".repeat(64))).not.toBe(id);
    expect(versionIdOf(v0, "mv1-00000000", "x".repeat(64))).not.toBe(id);
    expect(versionIdOf(v0, RV, "y".repeat(64))).not.toBe(id);
  });
  it("activation records are validated", () => {
    expect(validateActivation({ kind: "shadow.activation", captureFrom: "2026-11-25", approvedAt: "2026-11-24T10:00:00Z", document: "docs/research/SHADOW_PREDICTIONS.md" })).toEqual([]);
    expect(validateActivation({ kind: "shadow.activation", captureFrom: "25-11-2026", approvedAt: "x", document: "y" }).length).toBe(3);
    expect(validateActivation(null)).toEqual(["not a shadow activation record"]);
  });
});

describe.skipIf(!hasData)("shadow capture on the real public data (temporary directories)", () => {
  let src: CaptureSource;
  let u: PreparedUniverse;
  let tmp: string;
  let ledger: string;
  let shadow: string;
  const activation = { kind: "shadow.activation", captureFrom: "2026-11-19", approvedAt: "2026-11-24T10:00:00Z", document: "docs/research/SHADOW_PREDICTIONS.md" };
  const run = (now: string, root = shadow) => runShadowCapture({ repoRoot: ROOT, dataDir: DATA, ledgerRoot: ledger, shadowRoot: root, now: new Date(now), github: { runId: null, runAttempt: null, sha: null }, source: src });

  beforeAll(async () => {
    src = await loadSource(DATA);
    u = prepareUniverse(src.dataset, src.activity);
    tmp = await mkdtemp(path.join(os.tmpdir(), "shadow-"));
    ledger = path.join(tmp, "ledger");
    await cp(path.join(LEDGER, "protocol"), path.join(ledger, "protocol"), { recursive: true });
    await mkdir(path.join(ledger, "live", "predictions", RV), { recursive: true });
    for (const d of SESSIONS) await cp(path.join(LEDGER, "live", "predictions", RV, `${d}.json`), path.join(ledger, "live", "predictions", RV, `${d}.json`));
    shadow = path.join(tmp, "shadow");
  });
  afterAll(async () => {
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("the any-rank computation reproduces every mv1 top-50 gainer list exactly", async () => {
    for (const d of SESSIONS) {
      const mv1 = JSON.parse(await readFile(path.join(LEDGER, "live", "predictions", RV, `${d}.json`), "utf-8"));
      const { regime, candidates } = shadowCandidates(u, d);
      expect(checkAgainstMv1(candidates, regime, mv1)).toEqual([]);
      expect(candidates.length).toBeGreaterThan(50);
      // a tampered mv1 file is detected (fail closed)
      const bad = structuredClone(mv1);
      const row = bad.predictions.find((p: { lists?: Array<{ list: string }> }) => p.lists?.some((l) => l.list === "gainer"));
      row.lists.find((l: { list: string }) => l.list === "gainer").setup = "weak-momentum-x";
      expect(checkAgainstMv1(candidates, regime, bad).length).toBeGreaterThan(0);
    }
  });

  it("does nothing without an activation record", async () => {
    const r = await run("2026-11-23T20:00:00Z");
    expect(r.status).toBe("not-activated");
    expect(existsSync(shadow)).toBe(false);
  });

  it("captures only on-time sessions, create-only, and never backfills late ones", async () => {
    await mkdir(shadow, { recursive: true });
    await writeFile(path.join(shadow, "activation.json"), JSON.stringify(activation));
    const r = await run("2026-11-23T20:00:00Z");
    const by = Object.fromEntries(r.sessions.map((s) => [s.date, s.outcome]));
    expect(by).toEqual({ "2026-11-19": "late", "2026-11-20": "late", "2026-11-23": "recorded" });
    const versions = await shadowVersions(ROOT, RV);
    for (const v of versions) {
      const files = await readdir(path.join(shadow, v.versionId));
      expect(files).toEqual(["2026-11-23.json"]);
      const f = JSON.parse(await readFile(path.join(shadow, v.versionId, "2026-11-23.json"), "utf-8")) as ShadowFile;
      expect(validateShadowFile(f, { date: "2026-11-23", versionId: v.versionId })).toEqual([]);
      expect(f.header.cutoff).toBe("2026-11-24T03:30:00.000Z");
      expect(f.header.mv1RuleVersion).toBe(RV);
      for (const p of f.predictions) expect(v.include({ rank: p.rank, changePct: p.price.changePct, label: p.mv1.setup, breakoutToday: p.breakout.today, distancePct: p.breakout.distancePct })).toBe(true);
    }
    // re-run: identical predictions -> exists; nothing rewritten
    const before = await readFile(path.join(shadow, versions[0].versionId, "2026-11-23.json"), "utf-8");
    const again = await run("2026-11-24T01:00:00Z");
    expect(again.sessions.find((s) => s.date === "2026-11-23")!.outcome).toBe("exists");
    expect(await readFile(path.join(shadow, versions[0].versionId, "2026-11-23.json"), "utf-8")).toBe(before);
    // after the earliest cut-off a missing file is never created (late, or waiting while the next session is unresolved)
    await rm(path.join(shadow, versions[1].versionId, "2026-11-23.json"));
    const late = await run("2026-11-24T04:00:00Z");
    expect(["late", "waiting"]).toContain(late.sessions.find((s) => s.date === "2026-11-23")!.outcome);
    // (the data ends on 2026-11-23, so 2026-11-24's status is unknown here: the capture waits rather than guess)
    expect(existsSync(path.join(shadow, versions[1].versionId, "2026-11-23.json"))).toBe(false);
  });

  it("a session that has not closed yet is not captured", async () => {
    const root = path.join(tmp, "shadow-early");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "activation.json"), JSON.stringify(activation));
    const r = await run("2026-11-23T09:00:00Z", root);
    expect(r.sessions.find((s) => s.date === "2026-11-23")!.outcome).toBe("waiting");
  });

  it("an existing file with different predictions is a conflict and is not overwritten", async () => {
    const root = path.join(tmp, "shadow-conflict");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "activation.json"), JSON.stringify(activation));
    const v = (await shadowVersions(ROOT, RV))[2];
    await mkdir(path.join(root, v.versionId), { recursive: true });
    const fake = { kind: "shadow.predictions", schemaVersion: 1, header: { predictionsSha256: "0".repeat(64) }, predictions: [] };
    await writeFile(path.join(root, v.versionId, "2026-11-23.json"), JSON.stringify(fake));
    const r = await run("2026-11-23T20:00:00Z", root);
    expect(r.sessions.find((s) => s.date === "2026-11-23")!.outcome).toBe("conflict");
    expect(JSON.parse(await readFile(path.join(root, v.versionId, "2026-11-23.json"), "utf-8"))).toEqual(fake);
  });

  it("tampering with a stored shadow row is detected", async () => {
    const { regime, candidates } = shadowCandidates(u, "2026-11-23");
    const v = (await shadowVersions(ROOT, RV))[1];
    const f = buildShadowFile({ variant: v, date: "2026-11-23", regime, candidates, mv1RuleVersion: RV, mv1File: { path: "x", sha256: "y", predictionsSha256: "z" }, cutoffMs: 0, data: [], generatedAt: "2026-11-23T20:00:00Z", github: { runId: null, runAttempt: null, sha: null } });
    expect(validateShadowFile(f, { date: "2026-11-23", versionId: v.versionId })).toEqual([]);
    if (f.predictions.length) {
      const t = structuredClone(f);
      t.predictions[0].bar.close += 1;
      expect(validateShadowFile(t, { date: "2026-11-23", versionId: v.versionId }).length).toBeGreaterThan(0);
    }
    expect(f.header.predictionsSha256).toBe(sha256Canonical(f.predictions));
  });

  it("the evaluator's engine path reproduces every stored mv1 outcome exactly", async () => {
    const market = await loadRunnerMarket(DATA, { commit: "test" });
    const cal = calendarInputs(market);
    const store = path.join(ROOT, "data", "outcomes", "od1", RV);
    let compared = 0;
    for (const date of existsSync(store) ? await readdir(store) : []) {
      const daily = JSON.parse(await readFile(path.join(LEDGER, "live", "predictions", RV, `${date}.json`), "utf-8"));
      for (const f of await readdir(path.join(store, date))) {
        const h = Number(f.replace(/^h|\.json$/g, ""));
        const rec = JSON.parse(await readFile(path.join(store, date, f), "utf-8"));
        for (const e of rec.outcomes) {
          const p = daily.predictions.find((x: { symbol: string }) => x.symbol === e.symbol);
          const mine = outcomeOf(market, cal, date, h, p);
          if (e.outcome.status === "complete") {
            expect(mine.st).toBe("complete");
            if (mine.st === "complete") {
              expect(mine.cls).toBe(e.outcome.cls);
              expect(mine.X).toBe(e.outcome.X);
              expect(mine.R).toBe(e.outcome.R);
            }
          } else expect(mine).toEqual({ st: "unavailable", why: e.outcome.reason });
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(0);
  });
});

describe("shadow evaluation statistics", () => {
  const obs = (rows: Array<[number, string, number]>): Obs[] => rows.map(([s, cls, X], i) => ({ s, symbol: `S${i}`, out: { 1: { st: "complete", cls, R: X, X, T: X }, 5: { st: "complete", cls, R: X, X, T: X }, 10: { st: "complete", cls, R: X, X, T: X } } }));
  it("pooled differences with a deterministic paired session bootstrap", () => {
    const S = 12;
    const A = obs(Array.from({ length: 36 }, (_, i) => [i % S, i % 3 === 0 ? "failed" : "confirmed", 1] as [number, string, number]));
    const B = obs(Array.from({ length: 36 }, (_, i) => [i % S, i % 2 === 0 ? "reversal" : "partial", 0] as [number, string, number]));
    const c1 = contrast(A, B, S, 1, METRICS.adverse, bootDraws(S));
    const c2 = contrast(A, B, S, 1, METRICS.adverse, bootDraws(S));
    expect(c1).toEqual(c2);
    expect(c1.diff).toBeCloseTo(100 / 3 - 50, 3);
    expect(c1.ci95[0]!).toBeLessThanOrEqual(c1.diff!);
    expect(c1.ci95[1]!).toBeGreaterThanOrEqual(c1.diff!);
    expect(c1.ci975[0]!).toBeLessThanOrEqual(c1.ci95[0]!);
    expect(contrast(A, B, S, 10, METRICS.meanX, bootDraws(S)).diff).toBe(1);
    expect(contrast(A, B, 1, 1, METRICS.adverse, bootDraws(1)).ci95).toEqual([null, null]);
  });
  it("Benjamini-Hochberg and checkpoints follow the pre-declaration", () => {
    expect(bh([0.001, 0.04, 0.5, null], 0.1)).toEqual([true, true, false, false]);
    expect(checkpointState(0)).toEqual({ reached: null, next: 20, decisionLook: false });
    expect(checkpointState(57)).toEqual({ reached: 50, next: 100, decisionLook: false });
    expect(checkpointState(100)).toEqual({ reached: 100, next: 250, decisionLook: true });
    expect(checkpointState(300)).toEqual({ reached: 250, next: null, decisionLook: true });
  });
});
