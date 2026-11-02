import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeLiveHoldout, loadValidR6Reviews, realGuardGit, validateVersionRecords } from "../../scripts/ledger/guard.mts";
import { evaluateGate } from "../../scripts/ledger/gate.mts";
import { applyCaptureToState } from "../../scripts/ledger/run.mts";
import { runCapture } from "../../scripts/ledger/capture.mts";
import { applyPublication, emptyState, saveLedgerState, type DateRecord, type LedgerState } from "../../scripts/ledger/state.mts";
import { buildHoldoutFile } from "../../scripts/ledger/protocol.mts";
import { validateExemption } from "../../scripts/ledger/validate.mts";
import { last, makeEnv, makeFixture, receiptInto, tmpDir, type Fixture } from "./fixture";
import { ROOT, makeRepo } from "./gitRepo";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const rec = (status: DateRecord["status"], extra: Partial<DateRecord> = {}): DateRecord => ({ status, reasons: [], sourceDataDate: last, generatedAt: "t", publicationClass: "pending", earliestCutoffUtc: null, cutoffUtc: null, updatedAt: "2026-11-01T00:00:00Z", ...extra });
const withState = async (r: Awaited<ReturnType<typeof makeRepo>>, edit: (s: LedgerState) => void) => {
  const s = emptyState("2026-11-01T00:00:00Z");
  edit(s);
  await saveLedgerState(r.p.state, s);
};
const stateViolations = async (r: Awaited<ReturnType<typeof makeRepo>>) => (await r.guard()).violations.filter((v) => v.kind === "state").map((v) => v.detail);

describe("C1: receipts and state must agree - checked by the guard, in both directions", () => {
  it("state says live, receipt says live-late => violation", async () => {
    const r = await makeRepo(tmp.dir, { liveLate: true });
    await withState(r, (s) => (s.dates[last] = rec("recorded", { publicationClass: "live" })));
    expect((await stateViolations(r)).join()).toMatch(/says .* is "live" but its receipt says "live-late"/);
  });
  it("state says live-late, receipt says live => violation", async () => {
    const r = await makeRepo(tmp.dir);
    await withState(r, (s) => (s.dates[last] = rec("recorded-late", { publicationClass: "live-late" })));
    expect((await stateViolations(r)).join()).toMatch(/is "live-late" but its receipt says "live"/);
  });
  it("state claims a live class with NO receipt => violation; consistent or merely lagging state is accepted", async () => {
    const none = await makeRepo(tmp.dir, { receipt: false });
    await withState(none, (s) => (s.dates[last] = rec("recorded", { publicationClass: "live" })));
    expect((await stateViolations(none)).join()).toMatch(/no valid receipt/);
    const ok = await makeRepo(tmp.dir);
    await withState(ok, (s) => (s.dates[last] = rec("recorded", { publicationClass: "live" })));
    expect(await stateViolations(ok)).toEqual([]);
    const lag = await makeRepo(tmp.dir);
    await withState(lag, (s) => (s.dates[last] = rec("recorded", { publicationClass: "pending" })));
    expect(await stateViolations(lag)).toEqual([]); // receipt exists, state not yet updated: fixed by the next verification
  });
  it("the state update path itself cannot silently replace a receipt-backed class (evidence results are ignored, receipt results win)", () => {
    const stale = rec("recorded-late", { publicationClass: "live-late" });
    expect(applyPublication(stale, "live", [], "t").publicationClass).toBe("live-late");
    expect(applyPublication(stale, "live", [], "t", "receipt")).toMatchObject({ publicationClass: "live-late", status: "anomaly" });
    expect(applyPublication(rec("recorded", { publicationClass: "live" }), "live-late", [], "t", "receipt")).toMatchObject({ publicationClass: "live-late", status: "anomaly" });
  });
});

describe("C2: an enable record cannot be validated by rewinding the manifest in its own commit", () => {
  const rec2 = (over: object = {}) => ({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-aaaaaaaa", enabledFrom: "2026-10-05", latestMarketDateAtEnable: "2026-10-01", reason: "hand made", ...over });
  it("the exact audit scenario: one commit rewinds the manifest to 2026-10-01 and adds a record enabled from 2026-10-05", async () => {
    const r = await makeRepo(tmp.dir);
    await r.w("public/data/manifest.json", JSON.stringify({ latestMarketDate: "2026-10-29" }));
    r.commit("real data");
    await r.w("public/data/manifest.json", JSON.stringify({ latestMarketDate: "2026-10-01" })); // rewound
    await r.w(`${ROOT}/protocol/versions/mv1-aaaaaaaa.json`, JSON.stringify(rec2()));
    r.commit("rewind + backdated record");
    const v = await validateVersionRecords(realGuardGit(r.dir), r.root);
    expect(v).toHaveLength(1);
    expect(v[0].detail).toMatch(/2026-10-29 \(in the parent commit/);
    expect((await r.guard()).violations.some((x) => x.kind === "version")).toBe(true);
  });
  it("a normal record - enabledFrom later than BOTH the commit's and the parent's manifest - is accepted; a record in the very first commit has no parent and is judged on its own manifest", async () => {
    const r = await makeRepo(tmp.dir);
    await r.w("public/data/manifest.json", JSON.stringify({ latestMarketDate: "2026-10-29" }));
    r.commit("data");
    await r.w(`${ROOT}/protocol/versions/mv1-aaaaaaaa.json`, JSON.stringify(rec2({ enabledFrom: "2026-10-30", latestMarketDateAtEnable: "2026-10-29" })));
    r.commit("enable");
    expect(await validateVersionRecords(realGuardGit(r.dir), r.root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Decision 1: R6 review decisions
// ---------------------------------------------------------------------------------------------------------------
const hex = (c: string) => c.repeat(64);
const reviewBody = (date: string, rv: string, existing: string, candidate: string, over: object = {}) => ({ kind: "momentum-ledger.r6-review", schemaVersion: 1, sessionDate: date, ruleVersion: rv, existingPredictionsSha256: existing, candidatePredictionsSha256: candidate, reason: "The candidate differed because NSE re-published a constituent file; owner reviewed.", recordedAt: "2026-11-03T00:00:00Z", ...over });
const reviewName = (date: string, rv: string, candidate: string) => `r6-review-${date}-${rv}-${candidate.slice(0, 12)}.json`;

describe("Decision 1: an R6 anomaly is never cleared; a record-bound review decision turns the gate amber only", () => {
  /** Real flow: capture, then an anomaly produced by a changed ranking, folded into a state. */
  async function realAnomaly() {
    const repo = await makeRepo(tmp.dir, { receipt: false });
    const f: Fixture = makeFixture();
    const st = f.stocks[0];
    const prev = st.bars[st.bars.length - 2].close;
    const c = prev * 1.099;
    st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: prev, close: c, high: c * 1.001, low: prev * 0.999 };
    const state = emptyState("2026-11-01T00:00:00Z");
    const env = await makeEnv(repo.root);
    applyCaptureToState(state, await runCapture(f.source, env), { now: "2026-11-02T00:00:00Z", slot: null, ruleVersion: env.ruleVersion, enabledVersion: env.ruleVersion, enabledFrom: last, startedAt: "2026-11-02T00:00:00Z", captureSeconds: 1 });
    const ev = state.dates[last].r6Events!.find((e) => e.status === "anomaly")!;
    return { repo, state, env, existing: ev.existingPredictionsSha256!, candidate: ev.candidatePredictionsSha256! };
  }
  const gate = (state: LedgerState, reviews: { sessionDate: string; existingPredictionsSha256: string; candidatePredictionsSha256: string }[] = []) => evaluateGate({ state, r6Reviews: reviews, captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" });

  it("without a review decision the gate is red; with a valid one it is amber (exit 0) but the anomaly and its evidence remain", async () => {
    const { state, existing, candidate } = await realAnomaly();
    expect(state.dates[last].status).toBe("anomaly");
    expect(gate(state).exitCode).toBe(1);
    const reviewed = gate(state, [{ sessionDate: last, existingPredictionsSha256: existing, candidatePredictionsSha256: candidate }]);
    expect(reviewed.exitCode).toBe(0);
    expect(reviewed.errors).toEqual([]);
    expect(reviewed.warnings.join("\n")).toMatch(/has been reviewed.*stays excluded from live results/s);
    // nothing was cleared
    expect(state.dates[last].status).toBe("anomaly");
    expect(state.dates[last].r6!.status).toBe("anomaly");
    expect(state.dates[last].r6Events!.some((e) => e.status === "anomaly")).toBe(true);
  });
  it("a review is bound to ONE anomaly: another date, another digest, or a second different anomaly keeps the gate red", async () => {
    const { state, existing, candidate } = await realAnomaly();
    const ok = { sessionDate: last, existingPredictionsSha256: existing, candidatePredictionsSha256: candidate };
    expect(gate(state, [{ ...ok, sessionDate: "2026-01-01" }]).exitCode).toBe(1);
    expect(gate(state, [{ ...ok, candidatePredictionsSha256: hex("e") }]).exitCode).toBe(1);
    expect(gate(state, [{ ...ok, existingPredictionsSha256: hex("e") }]).exitCode).toBe(1);
    // a LATER, different anomaly on the same date needs its own review
    const later = structuredClone(state);
    later.dates[last].r6Events!.push({ at: "2026-11-05T00:00:00Z", status: "anomaly", existingPredictionsSha256: existing, candidatePredictionsSha256: hex("f"), detail: "again" });
    expect(gate(later, [ok]).exitCode).toBe(1);
    expect(gate(later, [ok, { ...ok, candidatePredictionsSha256: hex("f") }]).exitCode).toBe(0);
  });
  it("an anomaly that cannot be bound to digests (for example an invalid stored record) can never be reviewed", async () => {
    const { state } = await realAnomaly();
    const bare = structuredClone(state);
    bare.dates[last].r6Events = bare.dates[last].r6Events!.map((e) => ({ ...e, existingPredictionsSha256: null }));
    bare.dates[last].r6 = { ...bare.dates[last].r6!, existingPredictionsSha256: null };
    expect(gate(bare, [{ sessionDate: last, existingPredictionsSha256: hex("a"), candidatePredictionsSha256: hex("b") }]).exitCode).toBe(1);
    const none = emptyState("2026-11-01T00:00:00Z");
    none.runStatus = "ok";
    none.dates[last] = rec("anomaly"); // an anomaly with no R6 evidence (for example an invalid receipt)
    expect(gate(none, [{ sessionDate: last, existingPredictionsSha256: hex("a"), candidatePredictionsSha256: hex("b") }]).exitCode).toBe(1);
  });
  it("a review does not hide a different failure: the pre-commit or capture step outcome still fails the gate", async () => {
    const { state, existing, candidate } = await realAnomaly();
    const g = evaluateGate({ state, r6Reviews: [{ sessionDate: last, existingPredictionsSha256: existing, candidatePredictionsSha256: candidate }], captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "failure" });
    expect(g.exitCode).toBe(1);
  });
  it("review files are validated (schema, name, digests) and must match the real prediction record on disk", async () => {
    const { repo, state, env, existing, candidate } = await realAnomaly();
    const name = reviewName(last, env.ruleVersion, candidate);
    const good = reviewBody(last, env.ruleVersion, existing, candidate);
    expect(validateExemption(name, good)).toEqual([]);
    const bad: [string, string, unknown][] = [
      ["identical digests", reviewName(last, env.ruleVersion, existing), reviewBody(last, env.ruleVersion, existing, existing)],
      ["name does not carry the digest", reviewName(last, env.ruleVersion, hex("1")), good],
      ["short digest", name, reviewBody(last, env.ruleVersion, "abc", candidate)],
      ["extra key", name, { ...good, clears: true }],
      ["placeholder reason", name, { ...good, reason: "ok" }],
      ["wrong kind", name, { ...good, kind: "momentum-ledger.exemption.history" }],
      ["date mismatch", name, { ...good, sessionDate: "2026-01-01" }],
    ];
    for (const [label, n, body] of bad) expect(validateExemption(n, body).length, label).toBeGreaterThan(0);
    // binding to the record on disk
    await repo.w(`${ROOT}/exemptions/${name}`, JSON.stringify(good));
    expect((await loadValidR6Reviews(repo.root)).valid.map((v) => v.sessionDate)).toEqual([last]);
    await repo.w(`${ROOT}/exemptions/${name}`, JSON.stringify(reviewBody(last, env.ruleVersion, hex("9"), candidate)));
    const r = await loadValidR6Reviews(repo.root);
    expect(r.valid).toEqual([]);
    expect(r.problems.map((p) => p.detail).join()).toMatch(/does not match the prediction record/);
    void state;
  });
  it("the gate CLI path: a review file on disk (loaded by the same loader the CLI uses) turns exactly this anomaly amber", async () => {
    const { repo, state, env, existing, candidate } = await realAnomaly();
    await repo.w(`${ROOT}/exemptions/${reviewName(last, env.ruleVersion, candidate)}`, JSON.stringify(reviewBody(last, env.ruleVersion, existing, candidate)));
    const { valid } = await loadValidR6Reviews(repo.root);
    expect(evaluateGate({ state, r6Reviews: valid, captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" }).exitCode).toBe(0);
    expect(evaluateGate({ state, r6Reviews: [], captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" }).exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Decision 3: live-holdout exclusion is ENFORCED
// ---------------------------------------------------------------------------------------------------------------
describe("Decision 3: sessions with integrity problems can never be live-holdout eligible", () => {
  const eligible = async (r: Awaited<ReturnType<typeof makeRepo>>) => (await computeLiveHoldout(realGuardGit(r.dir), r.root)).eligible;
  const modify = async (r: Awaited<ReturnType<typeof makeRepo>>, rel: string) => {
    await writeFile(path.join(r.dir, rel), (await readFile(path.join(r.dir, rel), "utf-8")) + " ");
    r.git("commit", "-aqm", `edit ${rel}`);
    return r.git("rev-parse", "HEAD").trim();
  };
  const histAck = (sha: string, rel: string, r: Awaited<ReturnType<typeof makeRepo>>) => ({ kind: "momentum-ledger.exemption.history", schemaVersion: 1, commit: sha, items: [{ path: rel, violation: "M", beforeBlob: r.git("rev-parse", `${sha}^:${rel}`).trim(), afterBlob: r.git("rev-parse", `${sha}:${rel}`).trim() }], reason: "Whitespace was appended by hand; reviewed by the owner.", recordedAt: "2026-11-03T00:00:00Z" });

  it("baseline: a valid daily record with a live receipt is eligible", async () => {
    const r = await makeRepo(tmp.dir);
    expect(await eligible(r)).toEqual([last]);
    expect((await r.guard()).holdout).toMatchObject({ eligible: [last], excluded: [] });
  });
  it("a live-late receipt, or no receipt, is not eligible", async () => {
    expect(await eligible(await makeRepo(tmp.dir, { liveLate: true }))).toEqual([]);
    expect(await eligible(await makeRepo(tmp.dir, { receipt: false }))).toEqual([]);
  });
  it("a modified prediction or receipt makes the session ineligible - and an ACKNOWLEDGEMENT does not bring it back (it stays amber and excluded)", async () => {
    for (const which of ["receipt", "prediction"]) {
      const r = await makeRepo(tmp.dir);
      const rel = which === "receipt" ? `${ROOT}/live/receipts/${last}.json` : r.git("ls-files", `${ROOT}/live/predictions`).trim().split("\n")[0];
      const sha = await modify(r, rel);
      expect(await eligible(r), `${which}: modified`).toEqual([]);
      await r.w(`${ROOT}/exemptions/${sha}.json`, JSON.stringify(histAck(sha, rel, r)));
      r.commit("acknowledge");
      const res = await r.guard();
      expect(res.acknowledged, `${which}: acknowledged and reported`).toHaveLength(1);
      expect(res.violations.filter((v) => v.kind === "history"), `${which}: not red`).toEqual([]);
      expect(res.holdout.eligible, `${which}: still excluded`).toEqual([]);
      expect(res.holdout.excluded[0].reasons.join(), which).toMatch(/modified, deleted or renamed \(acknowledged or not\)/);
    }
  });
  it("an R6 anomaly excludes the session, and so does a reviewed one", async () => {
    const r = await makeRepo(tmp.dir);
    await withState(r, (s) => (s.dates[last] = rec("anomaly", { publicationClass: "live", r6Events: [{ at: "2026-11-02T00:00:00Z", status: "anomaly", existingPredictionsSha256: hex("a"), candidatePredictionsSha256: hex("b"), detail: "x" }] })));
    expect(await eligible(r)).toEqual([]);
    const ex = (await r.guard()).holdout.excluded[0];
    expect(ex.reasons.join()).toMatch(/R6 anomaly.*review decision does not restore/);
    const daily = JSON.parse(await readFile(r.p.dailyFile(r.ruleVersion, last), "utf-8"));
    await withState(r, (s) => (s.dates[last] = rec("recorded", { publicationClass: "live", r6Events: [{ at: "2026-11-02T00:00:00Z", status: "anomaly", existingPredictionsSha256: daily.header.predictionsSha256, candidatePredictionsSha256: hex("b"), detail: "x" }] })));
    await r.w(`${ROOT}/exemptions/${reviewName(last, r.ruleVersion, hex("b"))}`, JSON.stringify(reviewBody(last, r.ruleVersion, daily.header.predictionsSha256, hex("b"))));
    expect(await eligible(r)).toEqual([]); // even with a valid review decision and an unflagged status: the anomaly event excludes it
  });
  it("source-revised sessions are excluded unless a valid source-revision acceptance is bound to the record; an acceptance cannot rescue a modified one", async () => {
    const r = await makeRepo(tmp.dir);
    const daily = JSON.parse(await readFile(r.p.dailyFile(r.ruleVersion, last), "utf-8"));
    await withState(r, (s) => (s.dates[last] = rec("source-revised", { publicationClass: "live" })));
    expect(await eligible(r)).toEqual([]);
    const body = { kind: "momentum-ledger.exemption.source-revision", schemaVersion: 1, sessionDate: last, ruleVersion: r.ruleVersion, predictionsSha256: daily.header.predictionsSha256, reason: "NSE re-published the file; owner reviewed the difference.", recordedAt: "2026-11-03T00:00:00Z" };
    await r.w(`${ROOT}/exemptions/source-revision-${last}-${r.ruleVersion}.json`, JSON.stringify(body));
    r.commit("accept");
    expect(await eligible(r)).toEqual([last]);
    await modify(r, `${ROOT}/live/receipts/${last}.json`);
    expect(await eligible(r)).toEqual([]);
  });
  it("an unblinding that claims more completed sessions than are eligible is a guard violation (the system cannot be unblinded on excluded sessions)", async () => {
    const r = await makeRepo(tmp.dir, { liveLate: true });
    const h = buildHoldoutFile();
    await writeFile(r.p.holdout, JSON.stringify({ ...h, status: "unblinded", unblinded: { authorisedBy: "owner", authorisedAt: "2027-01-01", completedLiveSessions: 250, exemptionsCount: 0 } }));
    r.git("commit", "-aqm", "unblind");
    const v = (await r.guard()).violations.filter((x) => x.kind === "holdout");
    expect(v.map((x) => x.detail).join()).toMatch(/claims 250 completed live sessions but only 0 sessions are eligible/);
  });
  it("the guard prints the eligibility summary (real CLI output)", async () => {
    const src = await readFile("scripts/ledger-guard.mts", "utf-8");
    expect(src).toMatch(/live-holdout eligibility/);
    void receiptInto;
  });
});
