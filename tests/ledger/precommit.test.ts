import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { link, mkdir, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCapture } from "../../scripts/ledger/capture.mts";
import { cleanPartials } from "../../scripts/ledger/files.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { precommit, realPrecommitGit, validatePending } from "../../scripts/ledger/precommit.mts";
import { buildHoldoutFile, buildOd1File } from "../../scripts/ledger/protocol.mts";
import { applyCaptureToState } from "../../scripts/ledger/run.mts";
import { emptyState, saveLedgerState, validateState } from "../../scripts/ledger/state.mts";
import { last, makeEnv, makeFixture, prevDate, receiptInto, tmpDir, truncateLast } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const ROOT = "public/data/ledger";
let n = 0;

/** A real git repository whose HEAD holds the protocol files, one captured daily file and a valid state. */
async function baseline() {
  const dir = path.join(tmp.dir, `p${n++}`);
  const ledger = path.join(dir, ROOT);
  await mkdir(path.join(ledger, "protocol"), { recursive: true });
  await writeFile(path.join(ledger, "protocol/od1.json"), JSON.stringify(buildOd1File(), null, 1));
  await writeFile(path.join(ledger, "holdout.json"), JSON.stringify(buildHoldoutFile(), null, 1));
  await writeFile(path.join(dir, "public/data/stocks.json"), "{}").catch(async () => {
    await mkdir(path.join(dir, "public/data"), { recursive: true });
    await writeFile(path.join(dir, "public/data/stocks.json"), "{}");
  });
  const env = await makeEnv(ledger);
  await runCapture(makeFixture().source, env);
  const state = emptyState("2026-11-01T00:00:00Z");
  await saveLedgerState(ledgerPaths(ledger).state, state);
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, encoding: "utf-8" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "baseline");
  const dailyFile = ledgerPaths(ledger).dailyFile(env.ruleVersion, last);
  return { dir, ledger, git, env, dailyFile, p: ledgerPaths(ledger), gitApi: realPrecommitGit(dir) };
}

describe("pre-commit validation of pending ledger changes", () => {
  it("accepts a valid new prediction file, a valid receipt and a state change", async () => {
    const b = await baseline();
    // new prediction: the previous session, captured from the truncated fixture
    const run = await runCapture(truncateLast(makeFixture()).source, await makeEnv(b.ledger, { enabledFrom: prevDate }));
    expect(run.sessions.find((s) => s.date === prevDate)?.outcome).toBe("recorded");
    await receiptInto(b.ledger, b.env.ruleVersion, false);
    const state = emptyState("2026-11-02T00:00:00Z");
    state.runStatus = "ok";
    await saveLedgerState(b.p.state, state);
    expect(await validatePending(b.gitApi, b.dir, ROOT)).toEqual([]);
    const res = await precommit(b.gitApi, b.dir, ROOT);
    expect(res).toMatchObject({ ok: true, restored: false });
    expect(await readFile(b.p.receiptFile(last), "utf-8")).toContain("momentum-ledger.receipt"); // kept
  });

  const rejects = async (name: string, mutate: (b: Awaited<ReturnType<typeof baseline>>) => Promise<void>, expectMsg: RegExp) => {
    const b = await baseline();
    await writeFile(path.join(b.dir, "public/data/stocks.json"), '{"market":"data changed by the fetch step"}'); // legitimate market-data change outside the ledger
    const goodDaily = await readFile(b.dailyFile, "utf-8");
    await mutate(b);
    const res = await precommit(b.gitApi, b.dir, ROOT, new Date("2026-11-02T10:00:00Z"));
    expect(res.ok, name).toBe(false);
    expect(res.violations.map((v) => `${v.kind}: ${v.detail}`).join("\n"), name).toMatch(expectMsg);
    // The ledger is back to HEAD (except the recorded anomaly), the existing record is intact, market data is untouched.
    expect(await readFile(b.dailyFile, "utf-8"), name).toBe(goodDaily);
    expect(await readFile(path.join(b.dir, "public/data/stocks.json"), "utf-8"), name).toBe('{"market":"data changed by the fetch step"}');
    const state = JSON.parse(await readFile(b.p.state, "utf-8"));
    expect(state.runStatus, name).toBe("anomaly");
    expect(state.lastFailure.reasons[0], name).toMatch(/Pre-commit validation rejected/);
    expect(validateState(state), name).toEqual([]);
    const status = b.git("status", "--porcelain", "--", ROOT).trim().split("\n").filter(Boolean);
    expect(status.every((l) => l.endsWith("ledger-state.json")), `${name}: ${status.join(",")}`).toBe(true); // nothing else pending under the ledger
    return b;
  };

  it("rejects invalid JSON in a new prediction file and removes it", async () => {
    const b = await rejects("invalid-json", async (b) => writeFile(path.join(path.dirname(b.dailyFile), "2026-01-05.json"), "{ not json"), /not valid JSON/);
    expect(await readdir(path.dirname(b.dailyFile))).toEqual([`${last}.json`]);
  });
  it("rejects a new prediction file with an invalid schema", async () => {
    await rejects("invalid-schema", async (b) => writeFile(path.join(path.dirname(b.dailyFile), "2026-01-05.json"), JSON.stringify({ kind: "momentum-ledger.daily", schemaVersion: 1, header: {}, predictions: [] })), /header\.|missing/);
  });
  it("rejects modification of an existing prediction", async () => {
    await rejects("modified", async (b) => writeFile(b.dailyFile, (await readFile(b.dailyFile, "utf-8")) + " "), /existing ledger file would be modified/);
  });
  it("rejects deletion of an existing prediction", async () => {
    await rejects("deleted", async (b) => rm(b.dailyFile), /status D|deleted/);
  });
  it("rejects modification of protocol, holdout and an unexpected new file", async () => {
    await rejects("holdout", async (b) => writeFile(b.p.holdout, '{"status":"unblinded"}'), /modified/);
    await rejects("protocol", async (b) => writeFile(b.p.protocolOd1, "{}"), /modified/);
    await rejects("unexpected-new", async (b) => writeFile(path.join(b.ledger, "live/other.json"), "{}"), /may not create this file/);
    await rejects("enable-record", async (b) => {
      await mkdir(path.dirname(b.p.versionRecord("mv1-aaaaaaaa")), { recursive: true });
      await writeFile(b.p.versionRecord("mv1-aaaaaaaa"), "{}");
    }, /may not create this file/);
  });
  it("rejects a receipt that does not match its prediction file, and a tampered state", async () => {
    await rejects("bad-receipt", async (b) => {
      await receiptInto(b.ledger, b.env.ruleVersion, false);
      const r = JSON.parse(await readFile(b.p.receiptFile(last), "utf-8"));
      r.fileSha256 = "0".repeat(64);
      await rm(b.p.receiptFile(last));
      await writeFile(b.p.receiptFile(last), JSON.stringify(r));
    }, /fileSha256 does not match/);
    await rejects("bad-state", async (b) => writeFile(b.p.state, JSON.stringify({ ...emptyState("2026-11-02T00:00:00Z"), predictions: [{ predictionId: "x" }] })), /unknown top-level key predictions|prediction payload/);
  });

  it("flags an unexpected partial file and restores the directory", async () => {
    await rejects("partial", async (b) => writeFile(path.join(path.dirname(b.dailyFile), `${prevDate}.json.123-ab.partial`), '{"trunc'), /partial/);
  });

  it("crash after a partial file was created: the cleanup step removes it and the validation then passes", async () => {
    const b = await baseline();
    await writeFile(path.join(path.dirname(b.dailyFile), `${prevDate}.json.99-cd.partial`), '{"trunc');
    expect((await validatePending(b.gitApi, b.dir, ROOT)).some((v) => v.kind === "partial")).toBe(true);
    expect(await cleanPartials(path.join(b.dir, ROOT))).toHaveLength(1);
    expect(await validatePending(b.gitApi, b.dir, ROOT)).toEqual([]);
  });

  it("crash after the final file was linked but before cleanup: the complete file is valid, the stray partial is flagged then removed", async () => {
    const b = await baseline();
    const dir = path.dirname(b.dailyFile);
    // reproduce createOnly's crash window: file linked into place while the partial still exists
    const f = truncateLast(makeFixture());
    await runCapture(f.source, await makeEnv(b.ledger, { enabledFrom: prevDate }));
    const created = path.join(dir, `${prevDate}.json`);
    await link(created, `${created}.77-ef.partial`);
    expect((await validatePending(b.gitApi, b.dir, ROOT)).map((v) => v.kind)).toEqual(["partial"]);
    await cleanPartials(path.join(b.dir, ROOT));
    expect(await validatePending(b.gitApi, b.dir, ROOT)).toEqual([]);
    await unlink(created).catch(() => undefined);
  });

  it("crash before the state update: the pending valid file passes and the next run converges without rewriting it", async () => {
    const b = await baseline();
    await runCapture(truncateLast(makeFixture()).source, await makeEnv(b.ledger, { enabledFrom: prevDate })); // wrote the file, state NOT updated
    expect(await validatePending(b.gitApi, b.dir, ROOT)).toEqual([]);
    const file = path.join(path.dirname(b.dailyFile), `${prevDate}.json`);
    const before = await readFile(file, "utf-8");
    const again = await runCapture(truncateLast(makeFixture()).source, await makeEnv(b.ledger, { enabledFrom: prevDate, now: new Date(`${prevDate}T23:00:00Z`) }));
    expect(again.sessions.find((s) => s.date === prevDate)?.outcome).toBe("exists");
    expect(await readFile(file, "utf-8")).toBe(before);
    const state = emptyState("2026-11-02T00:00:00Z");
    applyCaptureToState(state, again, { now: "2026-11-02T00:00:00Z", slot: null, ruleVersion: b.env.ruleVersion, enabledVersion: b.env.ruleVersion, enabledFrom: prevDate, startedAt: "2026-11-02T00:00:00Z", captureSeconds: 1 });
    expect(state.dates[prevDate].status).toBe("recorded"); // converged
  });

  it("when the pending change is rejected, a restored receipt and prediction from HEAD are never rewritten", async () => {
    const b = await baseline();
    await receiptInto(b.ledger, b.env.ruleVersion, false);
    b.git("add", "-A");
    b.git("commit", "-qm", "receipt");
    const receipt = await readFile(b.p.receiptFile(last), "utf-8");
    await writeFile(b.p.receiptFile(last), receipt.replace('"live"', '"live-late"'));
    const res = await precommit(b.gitApi, b.dir, ROOT);
    expect(res.ok).toBe(false);
    expect(await readFile(b.p.receiptFile(last), "utf-8")).toBe(receipt);
  });
});

describe("F4: the ledger root is validated before anything is restored or cleaned", () => {
  it("assertSafeLedgerRoot accepts only public/data/ledger and paths inside it", async () => {
    const { assertSafeLedgerRoot } = await import("../../scripts/ledger/precommit.mts");
    const repo = path.resolve("/some/repo");
    expect(() => assertSafeLedgerRoot(repo, "public/data/ledger")).not.toThrow();
    expect(() => assertSafeLedgerRoot(repo, "public/data/ledger/live")).not.toThrow();
    for (const bad of [".", "", "..", "public", "public/data", "public/data/ledger/../..", "public/data/ledger2", "../x", "/public/data/ledger", "src"]) expect(() => assertSafeLedgerRoot(repo, bad), JSON.stringify(bad)).toThrow(/unsafe ledger root/);
  });
  it("precommit() and the git restore refuse an unsafe root and leave the repository untouched", async () => {
    const b = await baseline();
    await writeFile(path.join(b.dir, "public/data/market-note.json"), "{}"); // untracked market-data file
    await expect(precommit(b.gitApi, b.dir, ".")).rejects.toThrow(/unsafe ledger root/);
    await expect(b.gitApi.restore("public/data")).rejects.toThrow(/unsafe ledger root/);
    expect(await readFile(path.join(b.dir, "public/data/market-note.json"), "utf-8")).toBe("{}");
  });
});

describe("F3: a new prediction is only accepted if the record that enabled its rule version is valid and not backdated", () => {
  const put = async (b: Awaited<ReturnType<typeof baseline>>, body: object) => {
    await writeFile(path.join(b.dir, "public/data/manifest.json"), JSON.stringify({ latestMarketDate: "2026-10-29" }));
    await mkdir(path.dirname(b.p.versionRecord("mv1-aaaaaaaa")), { recursive: true });
    await writeFile(b.p.versionRecord("mv1-aaaaaaaa"), JSON.stringify({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-aaaaaaaa", latestMarketDateAtEnable: "2026-10-29", reason: "Phase A1 initial enablement", ...body }));
    b.git("add", "-A");
    b.git("commit", "-qm", "version record");
    await runCapture(truncateLast(makeFixture()).source, await makeEnv(b.ledger, { enabledFrom: prevDate })); // a pending new prediction
  };
  it("rejects (and rolls back) a new prediction when the version record is backdated against the data in its own commit", async () => {
    const { realGuardGit } = await import("../../scripts/ledger/guard.mts");
    const b = await baseline();
    await put(b, { enabledFrom: "2026-10-01", latestMarketDateAtEnable: "2026-09-01" }); // lies about what it saw
    const res = await precommit(b.gitApi, b.dir, ROOT, new Date("2026-11-02T10:00:00Z"), realGuardGit(b.dir));
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "version" && /backdated/.test(v.detail))).toBe(true);
    expect(await readdir(path.dirname(b.dailyFile))).toEqual([`${last}.json`]); // the back-captured file is gone
  });
  it("accepts the same pending prediction when the version record is valid", async () => {
    const { realGuardGit } = await import("../../scripts/ledger/guard.mts");
    const b = await baseline();
    await put(b, { enabledFrom: "2026-10-30" });
    const res = await precommit(b.gitApi, b.dir, ROOT, new Date("2026-11-02T10:00:00Z"), realGuardGit(b.dir));
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });
  it("C2 at pre-commit: a record validated only by rewinding the manifest in its own commit still gets a new prediction rejected", async () => {
    const { realGuardGit } = await import("../../scripts/ledger/guard.mts");
    const b = await baseline();
    await writeFile(path.join(b.dir, "public/data/manifest.json"), JSON.stringify({ latestMarketDate: "2026-10-29" }));
    b.git("add", "-A");
    b.git("commit", "-qm", "real data");
    await writeFile(path.join(b.dir, "public/data/manifest.json"), JSON.stringify({ latestMarketDate: "2026-10-01" })); // rewound in the same commit as the record
    await mkdir(path.dirname(b.p.versionRecord("mv1-aaaaaaaa")), { recursive: true });
    await writeFile(b.p.versionRecord("mv1-aaaaaaaa"), JSON.stringify({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-aaaaaaaa", enabledFrom: "2026-10-05", latestMarketDateAtEnable: "2026-10-01", reason: "hand made" }));
    b.git("add", "-A");
    b.git("commit", "-qm", "rewind + record");
    await runCapture(truncateLast(makeFixture()).source, await makeEnv(b.ledger, { enabledFrom: prevDate }));
    const res = await precommit(b.gitApi, b.dir, ROOT, new Date("2026-11-02T10:00:00Z"), realGuardGit(b.dir));
    expect(res.ok).toBe(false);
    expect(res.violations.some((v) => v.kind === "version" && /parent commit/.test(v.detail))).toBe(true);
  });
});
