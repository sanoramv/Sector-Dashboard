/**
 * Phase B1: shared OD1 engine (scripts/ledger/od1.mts) and the protected outcome schema (scripts/ledger/outcomes.mts).
 * SYNTHETIC fixtures only: no live prediction file is read for outcomes, no live outcome is computed, nothing is written
 * outside a temporary directory.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";
import { OD1_DEFINITIONS, od1DefinitionsSha256 } from "../../scripts/ledger/protocol.mts";
import { OD1, OD1_CLASSES, OD1_HEADLINE_HORIZONS, OD1_STORED_HORIZONS, od1Classify, od1Epsilon, od1Maturity, od1Measure, od1Outcome, od1SigmaWindow, populationSd, type Od1WindowBar } from "../../scripts/ledger/od1.mts";
import {
  assertPrivateStorageRoot,
  buildOutcomeReceipt,
  buildOutcomeRecord,
  commitmentOf,
  computeEngine,
  createOnlyDecision,
  engineVersionOf,
  outcomeStorageKey,
  requireUnblinded,
  validateCorrectionChain,
  validateOutcomeCorrection,
  validateOutcomeReceipt,
  validateOutcomeRecord,
  verifyReceiptAgainstRecord,
  type OutcomeCorrection,
  type OutcomeRecord,
} from "../../scripts/ledger/outcomes.mts";
import { od1FromBars as researchOd1FromBars } from "../../scripts/research/breakout-baseline.mts";
import { computePriceAction } from "../../src/lib/momentum/features";
import { barsFrom, weekdays } from "../momentum/fixtures";

const DEFS = od1DefinitionsSha256();
const RV = "mv1-8ecef864";
const T = "2031-03-05"; // a synthetic, far-future session: never a live date
const bar = (b: Partial<Od1WindowBar> & { close: number; date: string }): Od1WindowBar => ({ open: b.open ?? b.close, high: b.high ?? b.close, low: b.low ?? b.close, close: b.close, date: b.date, sameSegmentAsT: b.sameSegmentAsT ?? true });

// ---------------------------------------------------------------------------------------------------------------------
describe("frozen OD1 contract (protocol compatibility)", () => {
  it("engine constants are the sealed protocol's; flags are pinned to the sealed text", async () => {
    expect(OD1.k).toBe(0.5);
    expect(OD1.floorPct).toBe(0.2);
    expect(OD1.sigmaWindow).toBe(20);
    expect(OD1.minComparableBars).toBe(22);
    expect(OD1_DEFINITIONS.flags.abnormalGap).toContain(`>= ${OD1.abnormalGapSigma} sigma`);
    expect(OD1_DEFINITIONS.flags.volWindowOutlier).toContain(`>= ${OD1.volWindowOutlierSigma} sigma`);
    expect(OD1_DEFINITIONS.sigma.source).toBe("volatility20, frozen in the prediction record");
    expect(OD1_STORED_HORIZONS).toEqual([1, 2, 5, 10]);
    expect(OD1_HEADLINE_HORIZONS).toEqual([1, 5]);
  });
  it("the sealed od1.json on disk is unchanged and matches the definitions the engine reads", async () => {
    const file = JSON.parse(await readFile("public/data/ledger/protocol/od1.json", "utf-8"));
    expect(file.definitionsSha256).toBe(DEFS);
    expect(file.definitions).toEqual(OD1_DEFINITIONS);
    expect(execFileSync("git", ["status", "--porcelain", "--", "public/data/ledger/protocol", "public/data/ledger/holdout.json"]).toString()).toBe("");
  });
  it("the research script uses the shared engine and returns exactly its old result shape", () => {
    for (let n = 0; n < 200; n++) {
      const r = (k: number) => Math.sin(n * 7.3 + k) * 3;
      const changes = Array.from({ length: 20 }, (_, k) => r(k));
      const window = Array.from({ length: 1 + (n % 5) }, (_, k) => ({ open: 100 + r(k + 30), close: 100 + r(k + 40), high: 104 + r(k + 50), low: 96 + r(k + 60) }));
      const a = { up: n % 2 === 0, day: { close: 100, high: 102 + r(70), low: 98 + r(80) }, window, benchT: 20000, benchTh: 20000 + 50 * r(90), sigmaChanges: changes };
      const old = researchOd1FromBars(a);
      expect(Object.keys(old).sort()).toEqual(["R", "X", "abnormalGap", "cls", "eps", "volWindowOutlier"]);
      const m = od1Measure({ ...a, sigma: populationSd(changes) });
      expect(old).toEqual({ cls: m.cls, R: m.R, X: m.X, eps: m.eps, abnormalGap: m.abnormalGap, volWindowOutlier: m.volWindowOutlier });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("OD1 classification: thresholds, precedence, all five classes", () => {
  const base = { up: true, Ht: 103, Lt: 96, eps: 1 };
  const c = (q: Partial<{ R: number; X: number; Hstar: number; Lstar: number; up: boolean }>) => od1Classify({ ...base, R: 0, X: 0, Hstar: 103, Lstar: 96, ...q }).cls;
  it("exact boundaries: R = +eps is P, R = -eps is D; X = 0 is not E; H* = H_t is not N; L* = L_t is not B", () => {
    expect(c({ R: 1, X: 0.01, Hstar: 103.01 })).toBe("confirmed");
    expect(c({ R: 1 - 1e-12, X: 0.01, Hstar: 103.01 })).toBe("partial");
    expect(c({ R: -1 })).toBe("failed");
    expect(c({ R: -1 + 1e-12 })).toBe("sideways");
    expect(c({ R: 2, X: 0, Hstar: 104 })).toBe("partial");
    expect(c({ R: 2, X: 1, Hstar: 103 })).toBe("partial");
    expect(c({ R: -2, Lstar: 96 })).toBe("failed");
    expect(c({ R: -2, Lstar: 95.999 })).toBe("reversal");
  });
  it("first match wins: reversal > failed > confirmed > partial > sideways", () => {
    expect(c({ R: -2, X: 9, Hstar: 110, Lstar: 90 })).toBe("reversal");
    expect(c({ R: -2, X: 9, Hstar: 110, Lstar: 97 })).toBe("failed");
    expect(c({ R: 2, X: 1, Hstar: 104, Lstar: 90 })).toBe("confirmed");
    expect(c({ R: 0, X: 1 })).toBe("partial");
    expect(c({})).toBe("sideways");
  });
  it("every class is reachable for gainers and for the loser mirror", () => {
    const g = new Set([c({ R: 2, X: 1, Hstar: 104 }), c({ X: 1 }), c({}), c({ R: -2 }), c({ R: -2, Lstar: 95 })]);
    const l = new Set([c({ up: false, R: -2, X: -1, Lstar: 95 }), c({ up: false, X: -1 }), c({ up: false }), c({ up: false, R: 2 }), c({ up: false, R: 2, Hstar: 104 })]);
    expect([...g].sort()).toEqual([...OD1_CLASSES].sort());
    expect([...l].sort()).toEqual([...OD1_CLASSES].sort());
  });
  it("epsilon: k * sigma * sqrt(h) with the 0.20% floor", () => {
    expect(od1Epsilon(2, 1)).toBe(1);
    expect(od1Epsilon(2, 5)).toBeCloseTo(2.236, 3);
    expect(od1Epsilon(0.1, 1)).toBe(0.2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("OD1 outcome: frozen volatility, missing bars, discontinuities", () => {
  const sessions = ["2031-03-06", "2031-03-07"];
  const day = { close: 100, high: 103, low: 96 };
  const good = [bar({ date: sessions[0], close: 101, high: 104, low: 99 }), bar({ date: sessions[1], close: 103, high: 105, low: 100 })];
  const base = { sessions, bars: good, up: true, day, sigma: 2, sigmaChanges: Array.from({ length: 20 }, (_, k) => (k % 2 ? -2 : 2)), benchT: 20000, benchTh: 20020 };

  it("uses the SUPPLIED frozen sigma; the sigma-window changes only feed the descriptive flag", () => {
    const a = od1Outcome(base);
    const b = od1Outcome({ ...base, sigmaChanges: Array(20).fill(0) });
    expect(a.status).toBe("complete");
    if (a.status !== "complete" || b.status !== "complete") return;
    expect(b.cls).toBe(a.cls);
    expect(b.eps).toBe(a.eps);
    expect(a.eps).toBeCloseTo(od1Epsilon(2, 2), 12);
    const bigger = od1Outcome({ ...base, sigma: 4 });
    expect(bigger.status === "complete" && bigger.eps).toBeCloseTo(od1Epsilon(4, 2), 12);
    expect(od1Outcome({ ...base, sigmaChanges: null })).toMatchObject({ status: "complete", volWindowOutlier: null });
  });
  it("the prediction record's volatility20 is bit-identical to the OD1 sigma of the same bars", () => {
    for (let s = 0; s < 25; s++) {
      const dates = weekdays("2030-01-07", 30 + s);
      const closes = dates.map((_, i) => 100 * (1 + 0.03 * Math.sin(i * (1.1 + s / 10)) + 0.001 * i));
      const bars = barsFrom(dates, closes);
      const v = computePriceAction(bars).volatility20;
      expect(v.available).toBe(true);
      if (v.available) expect(populationSd(od1SigmaWindow(bars)!)).toBe(v.value);
    }
  });
  it("missing sigma -> insufficient-history; a missing bar -> no-bar; another segment -> discontinuity; precedence in order", () => {
    expect(od1Outcome({ ...base, sigma: null })).toEqual({ status: "unavailable", reason: "insufficient-history" });
    expect(od1Outcome({ ...base, sigma: null, bars: [null, null] })).toEqual({ status: "unavailable", reason: "insufficient-history" });
    expect(od1Outcome({ ...base, bars: [good[0], null] })).toEqual({ status: "unavailable", reason: "no-bar" });
    expect(od1Outcome({ ...base, bars: [{ ...good[0], sameSegmentAsT: false }, good[1]] })).toEqual({ status: "unavailable", reason: "discontinuity" });
    expect(od1Outcome({ ...base, bars: [null, { ...good[1], sameSegmentAsT: false }] })).toEqual({ status: "unavailable", reason: "no-bar" });
    expect(od1Outcome({ ...base, bars: [{ ...good[0], sameSegmentAsT: false }, null] })).toEqual({ status: "unavailable", reason: "discontinuity" });
    expect(() => od1Outcome({ ...base, bars: [good[1], good[0]] })).toThrow("is not session");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("maturity on the trading calendar", () => {
  // Thu 2031-03-06 is t; Fri 03-07 trading; Mon 03-10 holiday; Tue 03-11 .. Mon 03-17 trading
  const trading = ["2031-03-05", "2031-03-06", "2031-03-07", "2031-03-11", "2031-03-12", "2031-03-13", "2031-03-14", "2031-03-17"];
  const status: Record<string, string> = Object.fromEntries(trading.map((d) => [d, "trading"]));
  status["2031-03-10"] = "non-trading";
  const ok = Object.fromEntries(trading.map((d) => [d, { index: "ok", stocks: "ok" }]));
  const m = (over: Partial<Parameters<typeof od1Maturity>[0]> = {}) => od1Maturity({ sessionDate: "2031-03-06", h: 5, tradingCalendar: trading, calendarStatus: status, archives: ok, ...over });

  it("h=1 and h=5 end on the 1st and 5th trading session (weekend and holiday skipped)", () => {
    expect(m({ h: 1 })).toEqual({ status: "mature", sessions: ["2031-03-07"], endDate: "2031-03-07" });
    expect(m()).toEqual({ status: "mature", sessions: ["2031-03-07", "2031-03-11", "2031-03-12", "2031-03-13", "2031-03-14"], endDate: "2031-03-14" });
  });
  it("pending: not enough sessions, unresolved or unpublished weekday, missing archives, unknown status", () => {
    expect(m({ sessionDate: "2031-03-14" }).status).toBe("pending");
    expect(m({ calendarStatus: { ...status, "2031-03-10": "pending-publication" } })).toMatchObject({ status: "pending", reason: expect.stringContaining("2031-03-10") });
    expect(m({ calendarStatus: { ...status, "2031-03-10": undefined } }).status).toBe("pending");
    expect(m({ calendarStatus: { ...status, "2031-03-12": "unresolved" } }).status).toBe("pending");
    expect(m({ archives: { ...ok, "2031-03-13": { index: "ok", stocks: "failed" } } })).toMatchObject({ status: "pending", reason: expect.stringContaining("archives") });
    expect(m({ archives: { ...ok, "2031-03-13": undefined } }).status).toBe("pending");
    expect(m({ sessionDate: "2031-03-08" }).status).toBe("pending");
  });
  it("every sealed stored horizon is supported (2 and 10 included); others are refused", () => {
    expect(m({ h: 2 }).status).toBe("mature");
    expect(m({ h: 10 }).status).toBe("pending"); // not enough sessions in this calendar, but a valid horizon
    expect(m({ h: 3 })).toMatchObject({ status: "pending", reason: expect.stringContaining("not a stored OD1 horizon") });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Synthetic prediction file and record
// ---------------------------------------------------------------------------------------------------------------------
const SESSIONS = ["2031-03-06"];
function pred(symbol: string, changePct: number, vol: number | null, b = { open: 99, high: 103, low: 96, close: 100 }) {
  const rec: Record<string, unknown> = { predictionId: `${T}|${symbol}|${RV}`, date: T, symbol, bar: { ...b, prevClose: 99 }, price: { changePct, volatility20: vol }, classification: { setup: "mixed" } };
  rec.recordHash = sha256Canonical(rec);
  return rec as { predictionId: string; symbol: string; recordHash: string; bar: { high: number; low: number; close: number }; price: { changePct: number; volatility20: number | null } };
}
function daily() {
  const predictions = [pred("AAA", 4, 2), pred("BBB", -3, 1.5), pred("CCC", 2, 2), pred("DDD", 1, null)];
  return { header: { sessionDate: T, predictionsSha256: sha256Canonical(predictions), predictionCount: predictions.length, model: { ruleVersion: RV } }, predictions };
}
const SIGMA_CH: Record<string, number[]> = { AAA: Array.from({ length: 20 }, (_, k) => (k % 2 ? -2 : 2)), BBB: Array.from({ length: 20 }, (_, k) => (k % 2 ? -1.5 : 1.5)), CCC: Array.from({ length: 20 }, (_, k) => (k % 2 ? -2 : 2)) };
const EVIDENCE = (symbol: string) => ({
  bars: symbol === "CCC" ? [null] : [bar({ date: SESSIONS[0], close: symbol === "BBB" ? 97 : 103, high: 105, low: 98 })],
  sigmaChanges: SIGMA_CH[symbol] ?? null,
});
async function record(over: Partial<Parameters<typeof buildOutcomeRecord>[0]> = {}): Promise<OutcomeRecord> {
  const engine = await computeEngine(process.cwd(), DEFS);
  return buildOutcomeRecord({
    daily: daily(),
    dailyFile: `private-test/${RV}/${T}.json`,
    dailyFileSha256: "1".repeat(64),
    receipt: { file: `private-test/receipts/${T}.json`, fileSha256: "2".repeat(64), class: "live" },
    horizon: 1,
    sessions: SESSIONS,
    calendar: { [SESSIONS[0]]: "trading" },
    archives: { [SESSIONS[0]]: { index: "ok", stocks: "ok" } },
    benchmark: { closeT: 20000, closeTh: 20040 },
    evidence: EVIDENCE,
    definitionsSha256: DEFS,
    engine,
    data: { commit: "3".repeat(40), files: [{ name: "stocks.json", sha256: "4".repeat(64) }] },
    generatedAt: "2031-03-06T22:00:00.000Z",
    github: { runId: null, runAttempt: null, sha: null },
    commitmentSalt: "5".repeat(64),
    ...over,
  });
}

describe("protected outcome record: schema, provenance, tamper detection", () => {
  it("a built record is valid, bound to its prediction file, deterministic, and covers every prediction once", async () => {
    const r = await record();
    expect(validateOutcomeRecord(r, { definitionsSha256: DEFS, daily: daily() })).toEqual([]);
    expect(r.outcomes.map((o) => [o.symbol, o.group, o.outcome.status])).toEqual([
      ["AAA", "gainer", "complete"],
      ["BBB", "loser", "complete"],
      ["CCC", "gainer", "unavailable"],
      ["DDD", "gainer", "unavailable"],
    ]);
    expect(r.outcomes.find((o) => o.symbol === "DDD")!.outcome).toEqual({ status: "unavailable", reason: "insufficient-history" });
    const again = await record();
    expect(sha256Canonical(again)).toBe(sha256Canonical(r));
    expect(again.header.outcomesSha256).toBe(r.header.outcomesSha256);
    // canonical hashing ignores key order
    const reordered = JSON.parse(JSON.stringify(r.outcomes.map((o) => Object.fromEntries(Object.entries(o).reverse()))));
    expect(sha256Canonical(reordered)).toBe(r.header.outcomesSha256);
  });

  it("tampering is detected: class, measurements, hash, frozen inputs, and outcomes that do not re-derive", async () => {
    const r = await record();
    const t1 = structuredClone(r);
    (t1.outcomes[0].outcome as { cls: string }).cls = "confirmed" === (r.outcomes[0].outcome as { cls?: string }).cls ? "failed" : "confirmed";
    t1.header.outcomesSha256 = sha256Canonical(t1.outcomes); // even with a consistent hash
    expect(validateOutcomeRecord(t1, { definitionsSha256: DEFS }).join(" ")).toContain("does not re-derive from its stored inputs");
    const t2 = structuredClone(r);
    t2.header.outcomesSha256 = "6".repeat(64);
    expect(validateOutcomeRecord(t2, { definitionsSha256: DEFS }).join(" ")).toContain("outcomesSha256 does not match");
    const t3 = structuredClone(r);
    t3.outcomes[0].frozen.sigma = 9;
    t3.header.outcomesSha256 = sha256Canonical(t3.outcomes);
    expect(validateOutcomeRecord(t3, { definitionsSha256: DEFS, daily: daily() }).join(" ")).toContain("frozen sigma differs");
    const t4 = structuredClone(r);
    t4.outcomes[1].recordHash = "7".repeat(64);
    t4.header.outcomesSha256 = sha256Canonical(t4.outcomes);
    expect(validateOutcomeRecord(t4, { definitionsSha256: DEFS, daily: daily() }).join(" ")).toContain("recordHash differs");
  });

  it("invalid provenance is rejected", async () => {
    const r = await record();
    const bad = (mut: (x: OutcomeRecord) => void) => {
      const x = structuredClone(r);
      mut(x);
      return validateOutcomeRecord(x, { definitionsSha256: DEFS }).join(" ");
    };
    expect(bad((x) => (x.header.protocol.definitionsSha256 = "8".repeat(64)))).toContain("sealed definitionsSha256");
    expect(bad((x) => (x.header.engine.version = "od1e-00000000"))).toContain("does not match its file hashes");
    expect(bad((x) => (x.header.data.commit = "abc"))).toContain("data commit");
    expect(bad((x) => ((x.header.source.receipt as { class: string }).class = "live-late"))).toContain("live receipt");
    expect(bad((x) => (x.header.source.dailyFile = `private-test/${RV}/2031-03-04.json`))).toContain("does not name this session");
    expect(bad((x) => (x.header.calendar[SESSIONS[0]] = "pending-publication"))).toContain("not recorded as trading");
    expect(bad((x) => (x.header.archives[SESSIONS[0]] = { index: "ok", stocks: "failed" }))).toContain("archives are not recorded as ok");
    expect(bad((x) => (x.header.horizon = 3))).toContain("sealed stored horizons");
    expect(bad((x) => ((x.header as unknown as Record<string, unknown>).classSummary = { confirmed: 1 }))).toContain("unknown key classSummary");
  });

  it("the builder fails closed on a recordHash mismatch, a non-live receipt, or a sigma window that no longer reproduces volatility20", async () => {
    const d = daily();
    d.predictions[0].recordHash = "0".repeat(64);
    d.header.predictionsSha256 = sha256Canonical(d.predictions);
    await expect(record({ daily: d })).rejects.toThrow("recordHash does not match");
    await expect(record({ receipt: { file: "x", fileSha256: "2".repeat(64), class: "live-late" } })).rejects.toThrow("only built for live sessions");
    await expect(record({ evidence: (s) => ({ ...EVIDENCE(s), sigmaChanges: s === "AAA" ? Array(20).fill(1) : EVIDENCE(s).sigmaChanges }) })).rejects.toThrow("source revision");
  });

  it("duplicates and incompleteness are rejected; create-only: identical = existing, different = conflict (never overwrite)", async () => {
    const r = await record();
    const dup = structuredClone(r);
    dup.outcomes.push(structuredClone(dup.outcomes[3]));
    dup.header.outcomesSha256 = sha256Canonical(dup.outcomes);
    expect(validateOutcomeRecord(dup, { definitionsSha256: DEFS }).join(" ")).toContain("duplicate outcome");
    const missing = structuredClone(r);
    missing.outcomes.pop();
    missing.header.outcomesSha256 = sha256Canonical(missing.outcomes);
    missing.header.source.predictionCount = 3;
    expect(validateOutcomeRecord(missing, { definitionsSha256: DEFS, daily: daily() }).join(" ")).toContain("prediction has no outcome entry");
    expect(createOnlyDecision(null, r)).toBe("create");
    expect(createOnlyDecision(r, await record({ generatedAt: "2031-03-07T01:00:00.000Z", commitmentSalt: "9".repeat(64) }))).toBe("existing");
    expect(createOnlyDecision(r, await record({ benchmark: { closeT: 20000, closeTh: 19000 } }))).toBe("conflict");
    expect(() => createOnlyDecision(r, { header: { ...r.header, horizon: 5 } })).toThrow("different sessions");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("public receipt: confidentiality and binding", () => {
  it("contains only identifiers, hashes, horizon, prediction count and times - no classes, returns or per-stock data", async () => {
    const r = await record();
    const rc = buildOutcomeReceipt(r, "2031-03-06T22:00:01.000Z");
    expect(validateOutcomeReceipt(rc, { definitionsSha256: DEFS })).toEqual([]);
    const text = JSON.stringify(rc);
    for (const w of [...OD1_CLASSES, "AAA", "BBB", "unavailable", "complete", "no-bar", "insufficient", "R\"", "eps", "gap", "20040", r.header.commitmentSalt, r.header.outcomesSha256]) expect(text).not.toContain(w); // never the secret salt or the record's own content hash
    const numbers: number[] = [];
    JSON.parse(text, (_k, v) => (typeof v === "number" && numbers.push(v), v));
    expect(numbers.sort()).toEqual([1, 1, 4].sort()); // schemaVersion, horizon, predictionCount
    expect(rc.storage).toEqual({ store: "private", key: outcomeStorageKey(RV, T, 1) });
    expect(verifyReceiptAgainstRecord(rc, r)).toEqual([]);
  });
  it("two records with different outcomes yield receipts that differ only in the salted commitment", async () => {
    const a = buildOutcomeReceipt(await record(), "2031-03-06T22:00:01.000Z");
    const b = buildOutcomeReceipt(await record({ benchmark: { closeT: 20000, closeTh: 19000 }, commitmentSalt: "a".repeat(64) }), "2031-03-06T22:00:01.000Z");
    expect({ ...a, commitment: null }).toEqual({ ...b, commitment: null });
    expect(a.commitment.value).not.toBe(b.commitment.value);
    // the commitment is unlinkable without the secret salt
    const r = await record();
    expect(commitmentOf("5".repeat(64), r.header.outcomesSha256)).toBe(a.commitment.value);
    expect(commitmentOf("6".repeat(64), r.header.outcomesSha256)).not.toBe(a.commitment.value);
  });
  it("any extra field, a wrong storage key, or a mismatched record is rejected", async () => {
    const r = await record();
    const rc = buildOutcomeReceipt(r, "2031-03-06T22:00:01.000Z");
    expect(validateOutcomeReceipt({ ...rc, counts: { confirmed: 2 } }, { definitionsSha256: DEFS }).join(" ")).toContain("unknown key counts");
    expect(validateOutcomeReceipt({ ...rc, source: { ...rc.source, classes: ["confirmed"] } }, { definitionsSha256: DEFS }).join(" ")).toContain("unknown key classes");
    expect(validateOutcomeReceipt({ ...rc, storage: { store: "private", key: "public/data/x" } }, { definitionsSha256: DEFS }).join(" ")).toContain("private logical key");
    expect(verifyReceiptAgainstRecord(rc, await record({ benchmark: { closeT: 20000, closeTh: 19000 } }))).toEqual(["the receipt does not commit to this outcome record"]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("append-only corrections", () => {
  const orig = { sessionDate: T, ruleVersion: RV, horizon: 1, commitment: "a".repeat(64) };
  const corr = (seq: number, sup: string, rep: string, over: Partial<OutcomeCorrection> = {}): OutcomeCorrection => ({ kind: "momentum-ledger.od1-outcome-correction", schemaVersion: 1, sessionDate: T, ruleVersion: RV, horizon: 1, sequence: seq, supersedes: sup, replacement: rep, reasonCode: "source-revised", reason: "NSE re-published the bhavcopy for the window session; values changed.", recordedAt: "2031-03-20T00:00:00Z", recordedBy: "owner", analyticalTreatment: "pending-owner-decision", ...over });
  it("a valid chain supersedes by commitment and never touches the original", () => {
    expect(validateCorrectionChain(orig, [corr(1, "a".repeat(64), "b".repeat(64)), corr(2, "b".repeat(64), "c".repeat(64))])).toEqual([]);
  });
  it("forks, gaps, duplicates, restoring an earlier record and silent replacement are rejected", () => {
    expect(validateCorrectionChain(orig, [corr(1, "a".repeat(64), "b".repeat(64)), corr(2, "a".repeat(64), "c".repeat(64))]).join(" ")).toContain("a fork or a silent replacement");
    expect(validateCorrectionChain(orig, [corr(2, "a".repeat(64), "b".repeat(64))]).join(" ")).toContain("without gaps");
    expect(validateCorrectionChain(orig, [corr(1, "a".repeat(64), "b".repeat(64)), corr(1, "b".repeat(64), "c".repeat(64))]).join(" ")).toContain("without gaps or duplicates");
    expect(validateCorrectionChain(orig, [corr(1, "a".repeat(64), "b".repeat(64)), corr(2, "b".repeat(64), "a".repeat(64))]).join(" ")).toContain("cannot restore an earlier record");
    expect(validateOutcomeCorrection(corr(1, "a".repeat(64), "a".repeat(64))).join(" ")).toContain("DIFFERENT record");
  });
  it("corrections are attributable and their analytical treatment stays an owner decision", () => {
    expect(validateOutcomeCorrection(corr(1, "a".repeat(64), "b".repeat(64), { analyticalTreatment: "replace" as never })).join(" ")).toContain("pending-owner-decision");
    expect(validateOutcomeCorrection(corr(1, "a".repeat(64), "b".repeat(64), { reason: "fix" })).join(" ")).toContain("meaningful explanation");
    expect(validateOutcomeCorrection(corr(1, "a".repeat(64), "b".repeat(64), { recordedBy: "" })).join(" ")).toContain("attribute");
    expect(JSON.stringify(corr(1, "a".repeat(64), "b".repeat(64)))).not.toMatch(/confirmed|partial|sideways|failed|reversal/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe("storage, sealing and engine identity", () => {
  it("protected records can never be stored inside the repository or under public/", () => {
    expect(() => assertPrivateStorageRoot(path.resolve("public/data/ledger/outcomes"), process.cwd())).toThrow("inside the repository");
    expect(() => assertPrivateStorageRoot(path.resolve("."), process.cwd())).toThrow("inside the repository");
    expect(() => assertPrivateStorageRoot("relative/dir", process.cwd())).toThrow("absolute path");
    expect(() => assertPrivateStorageRoot(path.join(os.tmpdir(), "x", "public", "y"), process.cwd())).toThrow("public/");
    expect(() => assertPrivateStorageRoot(path.join(os.tmpdir(), "od1-private-store"), process.cwd())).not.toThrow();
  });
  it("analysis is refused while the holdout is sealed (the real holdout.json is sealed)", async () => {
    const h = JSON.parse(await readFile("public/data/ledger/holdout.json", "utf-8"));
    expect(h).toMatchObject({ status: "sealed", unblinded: null, gate: { minCompletedLiveSessions: 250 } });
    expect(() => requireUnblinded(h)).toThrow("sealed");
    expect(() => requireUnblinded(null)).toThrow("sealed");
    expect(() => requireUnblinded({ status: "unblinded", unblinded: null })).toThrow("sealed");
    expect(() => requireUnblinded({ status: "unblinded", unblinded: { authorisedBy: "owner" } })).not.toThrow();
  });
  it("B1 writes nothing and no outcome file exists in the repository", async () => {
    for (const f of ["scripts/ledger/od1.mts", "scripts/ledger/outcomes.mts"]) {
      const src = await readFile(f, "utf-8");
      expect(src).not.toMatch(/writeFile|appendFile|createOnly\(|mkdir|rename\(|unlink/);
    }
    const tracked = execFileSync("git", ["ls-files"]).toString();
    expect(tracked).not.toMatch(/od1-outcome|\/outcomes\/od1\//);
  });
  it("the engine version is deterministic and changes with any engine file", async () => {
    const a = await computeEngine(process.cwd(), DEFS);
    const b = await computeEngine(process.cwd(), DEFS);
    expect(a).toEqual(b);
    expect(a.version).toMatch(/^od1e-[0-9a-f]{8}$/);
    expect(engineVersionOf([{ ...a.files[0], sha256: "0".repeat(64) }, ...a.files.slice(1)], DEFS)).not.toBe(a.version);
    expect(engineVersionOf(a.files, "0".repeat(64))).not.toBe(a.version);
  });
});
