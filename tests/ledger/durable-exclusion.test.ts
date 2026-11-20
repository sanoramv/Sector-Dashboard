/**
 * Durable holdout exclusions (design erratum 20). ledger-state.json is mutable; a date that was ever anomalous in ANY
 * committed version must stay excluded even if the current file is reset, edited or deleted, and incomplete history
 * must fail closed. Most tests use real temporary Git repositories; the 2026-11-18 tests read THIS repository's history.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { computeLiveHoldout, loadExclusionHistory, realGuardGit, type GuardGit } from "../../scripts/ledger/guard.mts";
import { precommit, realPrecommitGit, validatePending } from "../../scripts/ledger/precommit.mts";
import { evaluateGate } from "../../scripts/ledger/gate.mts";
import { RULE_FILES } from "../../scripts/ledger/ruleVersion.mts";
import { emptyState, saveLedgerState, type DateRecord, type LedgerState } from "../../scripts/ledger/state.mts";
import { last, realVersion, tmpDir } from "./fixture";
import { makeRepo, ROOT } from "./gitRepo";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp?.cleanup());

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const ev = (at: string, status: "anomaly" | "existing", cand = B) => ({ at, status, existingPredictionsSha256: A, candidatePredictionsSha256: cand, detail: `test ${status}` });
const anomalyRec = (date: string, extraEvents: ReturnType<typeof ev>[] = []): DateRecord => ({
  status: "anomaly",
  reasons: ["R6: test anomaly"],
  sourceDataDate: date,
  generatedAt: null,
  publicationClass: null,
  earliestCutoffUtc: null,
  cutoffUtc: null,
  updatedAt: "2026-11-02T00:00:00Z",
  r6: { status: "anomaly", checkedAt: "2026-11-02T00:00:00Z", existingPredictionsSha256: A, candidatePredictionsSha256: B, detail: "test anomaly", firstAnomalyAt: "2026-11-02T00:00:00Z" },
  r6Events: [ev("2026-11-02T00:00:00Z", "anomaly"), ...extraEvents],
});
const stateWith = (dates: Record<string, DateRecord>): LedgerState => ({ ...emptyState("2026-11-02T00:00:00Z"), runStatus: "anomaly", dates });
const exclusionKinds = (v: { kind: string; detail: string }[]) => v.filter((x) => x.kind === "exclusion").map((x) => x.detail);

/** A real repository whose session `last` was recorded as anomalous in a committed state. */
async function anomalousRepo() {
  const r = await makeRepo(tmp.dir);
  await saveLedgerState(r.p.state, stateWith({ [last]: anomalyRec(last) }));
  r.commit("state: anomaly");
  return r;
}
const eligible = async (git: GuardGit, root: string) => (await computeLiveHoldout(git, root)).eligible;

describe("durable exclusions: guard (real temporary repositories)", () => {
  it("baseline: a session with no anomaly in history is eligible and the history is complete", async () => {
    const r = await makeRepo(tmp.dir);
    const h = await loadExclusionHistory(realGuardGit(r.dir), r.root);
    expect(h).toMatchObject({ complete: true, problems: [] });
    expect(h.anomalies.size).toBe(0);
    expect(await eligible(realGuardGit(r.dir), r.root)).toEqual([last]);
    expect((await r.guard()).violations).toEqual([]);
  });

  it("1 / 10. a historical anomaly is preserved through legitimate append-only updates (no violation)", async () => {
    const r = await anomalousRepo();
    await saveLedgerState(r.p.state, stateWith({ [last]: anomalyRec(last, [ev("2026-11-03T00:00:00Z", "existing", C)]), "2026-11-04": { ...anomalyRec("2026-11-04"), status: "recorded", r6: undefined, r6Events: undefined } }));
    r.commit("state: append");
    const h = await loadExclusionHistory(realGuardGit(r.dir), r.root);
    expect(h.complete).toBe(true);
    expect([...h.anomalies.keys()]).toEqual([last]);
    expect(exclusionKinds((await r.guard()).violations)).toEqual([]);
    expect(await eligible(realGuardGit(r.dir), r.root)).toEqual([]);
  });

  it("2 / 15. a state reset is a guard violation and does not restore eligibility", async () => {
    const r = await anomalousRepo();
    await saveLedgerState(r.p.state, emptyState("2026-11-05T00:00:00Z"));
    r.commit("state: reset");
    const g = await r.guard();
    expect(exclusionKinds(g.violations).join(" ")).toContain(`${last}: the date was anomalous in committed history`);
    expect(g.holdout.eligible).toEqual([]);
    expect(g.holdout.excluded.find((s) => s.date === last)!.reasons.join(" ")).toContain("committed history of ledger-state.json (permanent)");
  });

  it("3. deleting ledger-state.json is a violation and fails closed", async () => {
    const r = await anomalousRepo();
    r.git("rm", "-q", `${ROOT}/ledger-state.json`);
    r.git("commit", "-qm", "state: delete");
    const g = await r.guard();
    const d = exclusionKinds(g.violations).join(" ");
    expect(d).toContain("missing or was deleted");
    expect(d).toContain("is missing or unreadable although committed history records anomalies");
    expect(g.holdout.eligible).toEqual([]);
  });

  it("4. removing the anomaly evidence (first anomaly event) is a violation", async () => {
    const r = await anomalousRepo();
    const rec = anomalyRec(last);
    rec.r6Events = [];
    await saveLedgerState(r.p.state, stateWith({ [last]: rec }));
    r.commit("state: drop event");
    expect(exclusionKinds((await r.guard()).violations).join(" ")).toContain("first anomaly event (2026-11-02T00:00:00Z) recorded in committed history is missing or was rewritten");
    // rewriting the event's content is caught as well
    const rec2 = anomalyRec(last);
    rec2.r6Events = [{ ...ev("2026-11-02T00:00:00Z", "anomaly"), detail: "rewritten" }];
    await saveLedgerState(r.p.state, stateWith({ [last]: rec2 }));
    r.commit("state: rewrite event");
    expect(exclusionKinds((await r.guard()).violations).join(" ")).toContain("missing or was rewritten");
  });

  it("5. downgrading an anomalous date is a violation and it stays excluded", async () => {
    const r = await anomalousRepo();
    await saveLedgerState(r.p.state, stateWith({ [last]: { ...anomalyRec(last), status: "recorded" } }));
    r.commit("state: downgrade");
    const g = await r.guard();
    expect(exclusionKinds(g.violations).join(" ")).toContain('its status is now "recorded"; an anomaly can never be downgraded');
    expect(g.holdout.eligible).toEqual([]);
  });

  it("6. truncated history: a replacement graft cannot hide the anomaly, and a grafts file fails closed", async () => {
    const r = await anomalousRepo();
    await saveLedgerState(r.p.state, emptyState("2026-11-05T00:00:00Z"));
    r.commit("state: reset");
    const head = r.git("rev-parse", "HEAD").trim();
    r.git("replace", "--graft", head); // plain `git log` now shows HEAD as a root commit with no anomaly before it
    expect(r.git("log", "--format=%H").trim().split("\n")).toHaveLength(1);
    const h = await loadExclusionHistory(realGuardGit(r.dir), r.root); // the guard ignores replacement objects
    expect([...h.anomalies.keys()]).toEqual([last]);
    expect(exclusionKinds((await r.guard()).violations).join(" ")).toContain("the date was anomalous in committed history");
    expect(await eligible(realGuardGit(r.dir), r.root)).toEqual([]);
    r.git("replace", "-d", head);
    await writeFile(path.join(r.dir, ".git", "info", "grafts"), `${head}\n`); // legacy grafts: cannot be disabled -> fail closed
    const h2 = await loadExclusionHistory(realGuardGit(r.dir), r.root);
    expect(h2.complete).toBe(false);
    expect(h2.problems[0].detail).toContain("shallow");
    expect(await eligible(realGuardGit(r.dir), r.root)).toEqual([]);
  });

  it("6b. history that does not reach an enabling record fails closed", async () => {
    const r = await anomalousRepo();
    await r.w(`${ROOT}/protocol/versions/${r.ruleVersion}.json`, "{}\n"); // only its presence matters for this check
    r.commit("enable");
    const base = realGuardGit(r.dir);
    const cut: GuardGit = { ...base, log: async (args) => (args.includes("--diff-filter=A") ? "" : base.log(args)) };
    const h = await loadExclusionHistory(cut, r.root);
    expect(h.complete).toBe(false);
    expect(h.problems.map((p) => p.detail).join(" ")).toContain("does not contain the commit that added the enabling record");
    expect(await eligible(cut, r.root)).toEqual([]);
  });

  it("7. missing / unreadable history fails closed (never 'no exclusions')", async () => {
    const r = await anomalousRepo();
    const base = realGuardGit(r.dir);
    const broken: GuardGit = { ...base, log: async () => Promise.reject(new Error("fatal: bad object")) };
    const h = await loadExclusionHistory(broken, r.root);
    expect(h.complete).toBe(false);
    expect(h.problems[0].detail).toContain("cannot be read");
    // the full eligibility computation cannot run at all without history: it throws (the guard crashes red), never "eligible"
    await expect(eligible(broken, r.root)).rejects.toThrow("bad object");
    // a listed version whose blob is gone
    const gone: GuardGit = { ...base, show: async () => null };
    expect((await loadExclusionHistory(gone, r.root)).problems.map((p) => p.detail).join(" ")).toContain("missing or was deleted");
    // an interface that cannot tell whether the clone is shallow is treated as shallow
    const unknown: GuardGit = { ...base, isShallow: async () => Promise.reject(new Error("no")) };
    expect((await loadExclusionHistory(unknown, r.root)).complete).toBe(false);
  });

  it("8. a shallow clone fails closed", async () => {
    const r = await anomalousRepo();
    const clone = path.join(tmp.dir, `shallow-${Date.now()}`);
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, clone]);
    const h = await loadExclusionHistory(realGuardGit(clone), path.join(clone, ROOT));
    expect(h.complete).toBe(false);
    expect(h.problems[0].detail).toContain("shallow");
    expect(await eligible(realGuardGit(clone), path.join(clone, ROOT))).toEqual([]);
  });

  it("9. an invalid historical state version fails closed", async () => {
    const r = await makeRepo(tmp.dir);
    const bad = { ...emptyState("2026-11-02T00:00:00Z"), runStatus: "bogus" };
    await writeFile(r.p.state, JSON.stringify(bad, null, 1));
    r.commit("state: invalid");
    await saveLedgerState(r.p.state, emptyState("2026-11-03T00:00:00Z"));
    r.commit("state: valid again");
    const h = await loadExclusionHistory(realGuardGit(r.dir), r.root);
    expect(h.complete).toBe(false);
    expect(h.problems.map((p) => p.detail).join(" ")).toContain("is invalid");
    expect(await eligible(realGuardGit(r.dir), r.root)).toEqual([]);
  });
});

describe("durable exclusions: pre-commit", () => {
  it("16. a pending reset / downgrade / event removal is rejected, and precommit() restores the committed state", async () => {
    const r = await anomalousRepo();
    const pg = realPrecommitGit(r.dir);
    const gg = realGuardGit(r.dir);
    for (const s of [emptyState("2026-11-05T00:00:00Z"), stateWith({ [last]: { ...anomalyRec(last), status: "recorded" } }), stateWith({ [last]: { ...anomalyRec(last), r6Events: [] } })]) {
      await saveLedgerState(r.p.state, s);
      expect(exclusionKinds(await validatePending(pg, r.dir, ROOT, gg)).length).toBeGreaterThan(0);
    }
    const before = await readFile(r.p.state, "utf-8");
    const res = await precommit(pg, r.dir, ROOT, new Date("2026-11-05T00:00:00Z"), gg);
    expect(res.ok).toBe(false);
    expect(await readFile(r.p.state, "utf-8")).not.toBe(before);
    const restored = JSON.parse(await readFile(r.p.state, "utf-8")) as LedgerState;
    expect(restored.dates[last].status).toBe("anomaly");
    expect(restored.dates[last].r6Events![0]).toEqual(ev("2026-11-02T00:00:00Z", "anomaly"));
  });

  it("10 / 11. legitimate appends and NEW anomalies are accepted by pre-commit", async () => {
    const r = await anomalousRepo();
    const pg = realPrecommitGit(r.dir);
    const gg = realGuardGit(r.dir);
    await saveLedgerState(r.p.state, stateWith({ [last]: anomalyRec(last, [ev("2026-11-03T00:00:00Z", "existing", C)]), "2026-11-04": anomalyRec("2026-11-04") }));
    expect(await validatePending(pg, r.dir, ROOT, gg)).toEqual([]);
  });

  it("pre-commit fails closed on a shallow clone", async () => {
    const r = await anomalousRepo();
    const clone = path.join(tmp.dir, `shallow-pc-${Date.now()}`);
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, clone]);
    await saveLedgerState(path.join(clone, ROOT, "ledger-state.json"), stateWith({ [last]: anomalyRec(last, [ev("2026-11-03T00:00:00Z", "existing", C)]) }));
    expect(exclusionKinds(await validatePending(realPrecommitGit(clone), clone, ROOT, realGuardGit(clone))).join(" ")).toContain("shallow");
  });
});

describe("durable exclusions: this repository (2026-11-18)", () => {
  const git = realGuardGit(process.cwd());

  it("12. the real history is complete and records 2026-11-18 as anomalous; it stays excluded, 2026-11-19 stays eligible", async () => {
    const h = await loadExclusionHistory(git, ROOT);
    expect(h.problems).toEqual([]);
    expect(h.complete).toBe(true);
    expect(h.versionsChecked).toBeGreaterThanOrEqual(68);
    expect(h.anomalies.get("2026-11-18")).toMatchObject({ firstSeenCommit: expect.stringMatching(/^9e89a3d/), firstAnomalyEvent: { status: "anomaly", existingPredictionsSha256: "ac454375470c738912e2c5c1986458c4f8d877ccd75d9b4adf6601cacf820308", candidatePredictionsSha256: "601c4d671603eaa0830721534475ba50599011813a1a6d7363528f13adbfb71f" } });
    const hold = await computeLiveHoldout(git, ROOT, h);
    expect(hold.sessions.find((s) => s.date === "2026-11-18")!.eligible).toBe(false);
    expect(hold.eligible).toContain("2026-11-19");
  });

  it("13. an R6 review decision for 2026-11-18 (if present) never restores eligibility", async () => {
    const hold = await computeLiveHoldout(git, ROOT);
    const s = hold.sessions.find((x) => x.date === "2026-11-18")!;
    expect(s.eligible).toBe(false);
    expect(s.reasons.join(" ")).toContain("a review decision does not restore it");
    expect(s.reasons.join(" ")).toContain("(permanent)");
  });

  it("14. a reviewed anomaly turns the gate amber, but a NEW unrelated anomaly keeps it red", async () => {
    const state = JSON.parse(await readFile(`${ROOT}/ledger-state.json`, "utf-8")) as LedgerState;
    const reviews = [{ sessionDate: "2026-11-18", existingPredictionsSha256: "ac454375470c738912e2c5c1986458c4f8d877ccd75d9b4adf6601cacf820308", candidatePredictionsSha256: "601c4d671603eaa0830721534475ba50599011813a1a6d7363528f13adbfb71f" }];
    const io = { captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" } as const;
    expect(evaluateGate({ state, r6Reviews: reviews, ...io }).exitCode).toBe(0);
    const s2 = structuredClone(state);
    s2.dates["2026-11-19"] = { ...s2.dates["2026-11-19"], status: "anomaly", r6Events: [{ at: "2026-11-20T22:20:00Z", status: "anomaly", existingPredictionsSha256: A, candidatePredictionsSha256: C, detail: "new" }] };
    const g = evaluateGate({ state: s2, r6Reviews: reviews, ...io });
    expect(g.exitCode).toBe(1);
    expect(g.errors.join(" ")).toContain("Unresolved anomaly on 2026-11-19");
  });

  it("17. holdout.json is sealed and untouched; an excluded date can never count towards unblinding", async () => {
    const h = JSON.parse(await readFile(`${ROOT}/holdout.json`, "utf-8"));
    expect(h).toMatchObject({ status: "sealed", unblinded: null, gate: { minCompletedLiveSessions: 250 } });
    expect(execFileSync("git", ["status", "--porcelain", "--", `${ROOT}/holdout.json`, `${ROOT}/protocol`, `${ROOT}/live`]).toString()).toBe("");
  });

  it("18 / 19. no production prediction rule changed and the rule version is still mv1-8ecef864", async () => {
    expect(execFileSync("git", ["diff", "--name-only", "HEAD", "--", ...RULE_FILES]).toString()).toBe("");
    expect((await realVersion()).ruleVersion).toBe("mv1-8ecef864");
  });
});

