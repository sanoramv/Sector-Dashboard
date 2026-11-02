import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { realGuardGit, runGuard, scanHistory } from "../../scripts/ledger/guard.mts";
import { buildHoldoutFile, buildOd1File } from "../../scripts/ledger/protocol.mts";
import { captureInto, last, receiptInto, tmpDir } from "./fixture";
import { emptyState, saveLedgerState } from "../../scripts/ledger/state.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { validateExemption } from "../../scripts/ledger/validate.mts";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const ROOT = "public/data/ledger";
let n = 0;
async function repo() {
  const dir = path.join(tmp.dir, `g${n++}`);
  await mkdir(dir, { recursive: true });
  const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, encoding: "utf-8" });
  git("init", "-q", "-b", "main");
  const w = async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), content);
  };
  await w(`${ROOT}/protocol/od1.json`, JSON.stringify(buildOd1File(), null, 1));
  await w(`${ROOT}/holdout.json`, JSON.stringify(buildHoldoutFile(), null, 1));
  const cap = await captureInto(path.join(dir, ROOT));
  await receiptInto(path.join(dir, ROOT), cap.ruleVersion, false);
  await saveLedgerState(ledgerPaths(path.join(dir, ROOT)).state, emptyState("2026-11-01T00:00:00Z"));
  git("add", "-A");
  git("commit", "-qm", "init");
  const guard = () => runGuard(realGuardGit(dir), path.join(dir, ROOT)).then(async (r) => ({ ...r, history: await scanHistory(realGuardGit(dir), ROOT) }));
  return { dir, git, w, guard };
}

describe("immutability guard (real git history)", () => {
  it("accepts additions only", async () => {
    const r = await repo();
    await r.w(`${ROOT}/live/receipts/2099-01-01.json`, "{}");
    r.git("add", "-A");
    r.git("commit", "-qm", "add");
    expect((await r.guard()).history).toEqual([]);
  });
  it("flags a modification of a protected file in history", async () => {
    const r = await repo();
    await r.w(`${ROOT}/live/receipts/${last}.json`, '{"x":1}');
    r.git("commit", "-aqm", "edit");
    const h = (await r.guard()).history;
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "history", path: `${ROOT}/live/receipts/${last}.json` });
  });
  it("flags deletion and rename", async () => {
    const r = await repo();
    r.git("rm", "-q", `${ROOT}/live/receipts/${last}.json`);
    r.git("commit", "-qm", "del");
    expect((await r.guard()).history).toHaveLength(1);
    const r2 = await repo();
    await rename(path.join(r2.dir, `${ROOT}/live/receipts/${last}.json`), path.join(r2.dir, `${ROOT}/live/receipts/2099-01-02.json`));
    r2.git("add", "-A");
    r2.git("commit", "-qm", "mv");
    expect((await r2.guard()).history.length).toBeGreaterThan(0);
  });
  // ------------------------------------------------------------------------------------------------------------
  // Acknowledgements. Type A (historical immutability) is bound to a commit, a path and real blob hashes.
  // ------------------------------------------------------------------------------------------------------------
  const blob = (r: { git: (...a: string[]) => string }, spec: string) => {
    try {
      return r.git("rev-parse", "--verify", "--quiet", spec).trim() || null;
    } catch {
      return null;
    }
  };
  const histAck = (sha: string, items: { path: string; violation: string; beforeBlob: string | null; afterBlob: string | null }[], over: object = {}) => ({ kind: "momentum-ledger.exemption.history", schemaVersion: 1, commit: sha, items, reason: "The receipt was re-created by hand after a failed push; reviewed and accepted by the owner.", recordedAt: "2026-11-03T00:00:00Z", ...over });
  /** modifies a tracked file in its own commit and returns what an honest acknowledgement of it would contain */
  async function violate(r: Awaited<ReturnType<typeof repo>>, rel: string, edit = (t: string) => t + " ") {
    const file = path.join(r.dir, rel);
    await writeFile(file, edit(await readFile(file, "utf-8")));
    r.git("commit", "-aqm", `edit ${rel}`);
    const sha = r.git("rev-parse", "HEAD").trim();
    return { sha, item: { path: rel, violation: "M", beforeBlob: blob(r, `${sha}^:${rel}`), afterBlob: blob(r, `${sha}:${rel}`) } };
  }
  const ack = async (r: Awaited<ReturnType<typeof repo>>, sha: string, body: unknown) => {
    await r.w(`${ROOT}/exemptions/${sha}.json`, JSON.stringify(body));
    r.git("add", "-A");
    r.git("commit", "-qm", "acknowledge");
  };

  it("unacknowledged violation: red", async () => {
    const r = await repo();
    await violate(r, `${ROOT}/live/receipts/${last}.json`);
    const res = await r.guard();
    expect(res.violations.filter((v) => v.kind === "history")).toHaveLength(1);
    expect(res.acknowledged).toHaveLength(0);
    expect(res.excludedSessions).toEqual([last]);
  });

  it("a valid, hash-bound acknowledgement reports the violation as ACKNOWLEDGED (not red, not silent) and the session stays excluded from the live holdout", async () => {
    const r = await repo();
    const { sha, item } = await violate(r, `${ROOT}/live/receipts/${last}.json`);
    await ack(r, sha, histAck(sha, [item]));
    const res = await r.guard();
    expect(res.violations.filter((v) => v.kind === "history")).toEqual([]);
    expect(res.acknowledged).toHaveLength(1);
    expect(res.acknowledged[0].detail).toMatch(/ACKNOWLEDGED/);
    expect(res.historyAcknowledgements).toEqual([sha]);
    expect(res.excludedSessions).toEqual([last]); // an acknowledgement never restores the session to the holdout
  });

  it("an acknowledgement is worthless if its hashes are wrong, names another path, or the file was changed again afterwards", async () => {
    const wrongHash = await repo();
    const a = await violate(wrongHash, `${ROOT}/live/receipts/${last}.json`);
    await ack(wrongHash, a.sha, histAck(a.sha, [{ ...a.item, afterBlob: "0".repeat(40) }]));
    expect((await wrongHash.guard()).violations.filter((v) => v.kind === "history")).toHaveLength(1);

    const wrongPath = await repo();
    const b = await violate(wrongPath, `${ROOT}/live/receipts/${last}.json`);
    await ack(wrongPath, b.sha, histAck(b.sha, [{ ...b.item, path: `${ROOT}/live/receipts/other.json` }]));
    expect((await wrongPath.guard()).violations.filter((v) => v.kind === "history")).toHaveLength(1);

    const later = await repo();
    const c = await violate(later, `${ROOT}/live/receipts/${last}.json`);
    await ack(later, c.sha, histAck(c.sha, [c.item]));
    await violate(later, `${ROOT}/live/receipts/${last}.json`, (t) => t + "  "); // modified AGAIN after the acknowledgement
    const res = await later.guard();
    expect(res.violations.filter((v) => v.kind === "history").length).toBeGreaterThanOrEqual(1); // the new change is red; the old ack does not cover it
    expect(res.acknowledged.every((x) => x.commit === c.sha)).toBe(true);
  });

  it("every immutable category: a change is a violation, an acknowledgement can only report it, and holdout changes cannot be acknowledged at all", async () => {
    const cats: { name: string; rel: string; seed?: string; session: boolean }[] = [
      { name: "predictions", rel: "", session: true }, // resolved below
      { name: "receipts", rel: `${ROOT}/live/receipts/${last}.json`, session: true },
      { name: "corrections", rel: `${ROOT}/live/corrections/mv1-aaaaaaaa/${last}.v1.json`, seed: '{"c":1}', session: true },
      { name: "protocol od1", rel: `${ROOT}/protocol/od1.json`, session: false },
      { name: "protocol version record", rel: `${ROOT}/protocol/versions/mv1-aaaaaaaa.json`, seed: '{"v":1}', session: false },
      { name: "protocol calendar override", rel: `${ROOT}/protocol/calendar/2026-12-25.json`, seed: '{"d":1}', session: false },
      { name: "an acknowledgement file itself", rel: `${ROOT}/exemptions/${"a".repeat(40)}.json`, seed: JSON.stringify(histAck("a".repeat(40), [{ path: "x", violation: "M", beforeBlob: "b".repeat(40), afterBlob: "c".repeat(40) }])), session: false },
    ];
    for (const c of cats) {
      const r = await repo();
      let rel = c.rel;
      if (c.name === "predictions") rel = r.git("ls-files", `${ROOT}/live/predictions`).trim().split("\n")[0];
      if (c.seed) {
        await r.w(rel, c.seed);
        r.git("add", "-A");
        r.git("commit", "-qm", `seed ${c.name}`);
      }
      const { sha, item } = await violate(r, rel);
      const red = await r.guard();
      expect(red.violations.filter((v) => v.kind === "history" && v.commit === sha), `${c.name}: unacknowledged`).toHaveLength(1);
      await ack(r, sha, histAck(sha, [item]));
      const res = await r.guard();
      expect(res.violations.filter((v) => v.kind === "history" && v.commit === sha), `${c.name}: acknowledged -> not red`).toHaveLength(0);
      expect(res.acknowledged.filter((v) => v.commit === sha), `${c.name}: reported`).toHaveLength(1);
      expect(res.excludedSessions.includes(last), `${c.name}: session exclusion`).toBe(c.session);
    }
    // deletion is also a violation and can be acknowledged only with a null afterBlob
    const d = await repo();
    const rel = `${ROOT}/live/receipts/${last}.json`;
    const before = blob(d, `HEAD:${rel}`);
    d.git("rm", "-q", rel);
    d.git("commit", "-qm", "delete");
    const dsha = d.git("rev-parse", "HEAD").trim();
    expect((await d.guard()).violations.some((v) => v.kind === "history" && v.code === "D")).toBe(true);
    await ack(d, dsha, histAck(dsha, [{ path: rel, violation: "D", beforeBlob: before, afterBlob: null }]));
    expect((await d.guard()).acknowledged.some((v) => v.code === "D")).toBe(true);
    // holdout.json: any change that is not the approved transition stays red; no acknowledgement type reaches it
    const h = await repo();
    const hf = path.join(h.dir, `${ROOT}/holdout.json`);
    await writeFile(hf, JSON.stringify({ ...JSON.parse(await readFile(hf, "utf-8")), startDate: "2026-11-02" }));
    h.git("commit", "-aqm", "tamper holdout");
    const hs = h.git("rev-parse", "HEAD").trim();
    await ack(h, hs, histAck(hs, [{ path: `${ROOT}/holdout.json`, violation: "M", beforeBlob: "a".repeat(40), afterBlob: "b".repeat(40) }]));
    expect((await h.guard()).violations.some((v) => v.kind === "holdout")).toBe(true);
  }, 120_000);

  it("malformed acknowledgements are reported as violations (both types)", async () => {
    const sha = "a".repeat(40);
    const item = { path: "p", violation: "M", beforeBlob: "b".repeat(40), afterBlob: "c".repeat(40) };
    const srName = `source-revision-${last}-mv1-aaaaaaaa.json`;
    const sr = { kind: "momentum-ledger.exemption.source-revision", schemaVersion: 1, sessionDate: last, ruleVersion: "mv1-aaaaaaaa", predictionsSha256: "d".repeat(64), reason: "Source rows were re-published by NSE; owner reviewed the difference.", recordedAt: "2026-11-03T00:00:00Z" };
    const cases: [string, string, unknown][] = [
      ["short name", "abc123.json", histAck("abc123", [item])],
      ["upper case", `${"A".repeat(40)}.json`, histAck("A".repeat(40), [item])],
      ["empty reason", `${sha}.json`, histAck(sha, [item], { reason: "   " })],
      ["placeholder", `${sha}.json`, histAck(sha, [item], { reason: "n/a" })],
      ["too short", `${sha}.json`, histAck(sha, [item], { reason: "fix it now" })],
      ["wrong commit", `${sha}.json`, histAck("b".repeat(40), [item])],
      ["extra key", `${sha}.json`, histAck(sha, [item], { paths: ["*"] })],
      ["wrong kind", `${sha}.json`, histAck(sha, [item], { kind: "x" })],
      ["no items", `${sha}.json`, histAck(sha, [])],
      ["blanket item", `${sha}.json`, histAck(sha, [{ ...item, path: "" }])],
      ["no before hash", `${sha}.json`, histAck(sha, [{ ...item, beforeBlob: null }])],
      ["deletion with after hash", `${sha}.json`, histAck(sha, [{ ...item, violation: "D" }])],
      ["not an object", `${sha}.json`, ["a"]],
      ["unknown file name", "random.json", histAck(sha, [item])],
      ["source-revision: wrong kind", srName, { ...sr, kind: "momentum-ledger.exemption.history" }],
      ["source-revision: date mismatch", srName, { ...sr, sessionDate: "2026-01-01" }],
      ["source-revision: no binding hash", srName, { ...sr, predictionsSha256: "short" }],
      ["source-revision: extra key", srName, { ...sr, commit: sha }],
    ];
    for (const [label, name, body] of cases) expect(validateExemption(name, body).length, label).toBeGreaterThan(0);
    expect(validateExemption(`${sha}.json`, histAck(sha, [item]))).toEqual([]);
    expect(validateExemption(srName, sr)).toEqual([]);
    const r = await repo();
    await r.w(`${ROOT}/exemptions/not-a-hash.json`, "{}");
    await r.w(`${ROOT}/exemptions/${sha}.json`, "{broken");
    expect((await r.guard()).violations.filter((v) => v.kind === "exemption").length).toBeGreaterThanOrEqual(2);
  });

  it("source-revision acceptance (type B) is distinct: it must bind to the real record, and cannot cover a session whose record was changed", async () => {
    const r = await repo();
    const dailyRel = r.git("ls-files", `${ROOT}/live/predictions`).trim().split("\n")[0];
    const daily = JSON.parse(await readFile(path.join(r.dir, dailyRel), "utf-8"));
    const rv = daily.header.model.ruleVersion;
    const body = { kind: "momentum-ledger.exemption.source-revision", schemaVersion: 1, sessionDate: last, ruleVersion: rv, predictionsSha256: daily.header.predictionsSha256, reason: "Source rows were re-published by NSE; owner reviewed the difference.", recordedAt: "2026-11-03T00:00:00Z" };
    const name = `source-revision-${last}-${rv}.json`;
    await r.w(`${ROOT}/exemptions/${name}`, JSON.stringify(body));
    const ok = await r.guard();
    expect(ok.sourceRevisionAcceptances).toEqual([`${last}:${rv}`]);
    expect(ok.violations.filter((v) => v.kind === "exemption")).toEqual([]);
    // wrong digest: cannot conceal a different record
    await r.w(`${ROOT}/exemptions/${name}`, JSON.stringify({ ...body, predictionsSha256: "e".repeat(64) }));
    expect((await r.guard()).violations.some((v) => v.kind === "exemption" && /cannot conceal/.test(v.detail))).toBe(true);
    // a session whose immutable record was changed cannot be restored by a type B acceptance
    await r.w(`${ROOT}/exemptions/${name}`, JSON.stringify(body));
    r.git("add", "-A");
    r.git("commit", "-qm", "accept");
    await violate(r, `${ROOT}/live/receipts/${last}.json`);
    const res = await r.guard();
    expect(res.violations.some((v) => v.kind === "exemption" && /cannot restore it/.test(v.detail))).toBe(true);
    expect(res.sourceRevisionAcceptances).toEqual([]);
    expect(res.excludedSessions).toContain(last);
  });

  it("F3: version (enable) records are validated - schema, and enabledFrom strictly later than the market date in the commit that added the record", async () => {
    const r = await repo();
    await r.w("public/data/manifest.json", JSON.stringify({ latestMarketDate: "2026-10-29" }));
    r.git("add", "-A");
    r.git("commit", "-qm", "manifest");
    const rec = (over: object = {}) => ({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-aaaaaaaa", enabledFrom: "2026-10-30", latestMarketDateAtEnable: "2026-10-29", reason: "Phase A1 initial enablement", ...over });
    const put = async (body: unknown, name = "mv1-aaaaaaaa.json") => {
      await r.w(`${ROOT}/protocol/versions/${name}`, JSON.stringify(body));
      r.git("add", "-A");
      r.git("commit", "-qm", "version record");
    };
    await put(rec());
    expect((await r.guard()).violations.filter((v) => v.kind === "version")).toEqual([]); // valid
    // a hand-made record that LIES about what it saw but is backdated against the real data in its commit
    await put(rec({ ruleVersion: "mv1-bbbbbbbb", enabledFrom: "2026-10-01", latestMarketDateAtEnable: "2026-09-01" }), "mv1-bbbbbbbb.json");
    // schema problems
    await put({ ...rec({ ruleVersion: "mv1-cccccccc" }), extra: 1 }, "mv1-cccccccc.json");
    await put({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-dddddddd", enabledFrom: "2026-10-30" }, "mv1-dddddddd.json");
    await put(rec({ ruleVersion: "mv1-eeeeeeee", enabledFrom: "2026-10-29" }), "mv1-eeeeeeee.json"); // not later than its own stated market date
    await put(rec({ ruleVersion: "mv1-ffffffff", enabledFrom: "2026-13-45" }), "mv1-ffffffff.json");
    await put(rec(), "wrong-name.json");
    const v = (await r.guard()).violations.filter((x) => x.kind === "version");
    const by = (f: string) => v.filter((x) => x.path.endsWith(f)).map((x) => x.detail).join("\n");
    expect(by("mv1-bbbbbbbb.json")).toMatch(/backdated/);
    expect(by("mv1-cccccccc.json")).toMatch(/unknown key extra/);
    expect(by("mv1-dddddddd.json")).toMatch(/missing key/);
    expect(by("mv1-eeeeeeee.json")).toMatch(/not later than/);
    expect(by("mv1-ffffffff.json")).toMatch(/real YYYY-MM-DD/);
    expect(by("wrong-name.json")).toMatch(/file name must be/);
    expect(by("mv1-aaaaaaaa.json")).toBe("");
    // an untracked (uncommitted) record cannot be validated against history and is refused
    await r.w(`${ROOT}/protocol/versions/mv1-99999999.json`, JSON.stringify(rec({ ruleVersion: "mv1-99999999" })));
    expect((await r.guard()).violations.some((x) => x.kind === "version" && /not in Git history/.test(x.detail))).toBe(true);
  });
  it("receipts are validated: tampered hash, wrong class, missing file, missing fields", async () => {
    const mutate = async (f: (r: any) => void, label: string, expectMsg: RegExp) => {
      const r = await repo();
      const file = path.join(r.dir, `${ROOT}/live/receipts/${last}.json`);
      const obj = JSON.parse(await readFile(file, "utf-8"));
      f(obj);
      await writeFile(file, JSON.stringify(obj));
      const v = (await r.guard()).violations.filter((x) => x.kind === "receipt");
      expect(v.map((x) => x.detail).join("\n"), label).toMatch(expectMsg);
    };
    await mutate((o) => (o.fileSha256 = "0".repeat(64)), "hash", /fileSha256 does not match/);
    await mutate((o) => (o.class = "live-late"), "class", /contradicts tPub/);
    await mutate((o) => (o.class = "unverified"), "unverified", /not live or live-late/);
    await mutate((o) => delete o.evidence.push, "no push", /evidence\.push/);
    await mutate((o) => (o.evidence.tPub = "2000-01-01T00:00:00Z"), "tPub", /tPub does not equal|contradictory/);
    await mutate((o) => (o.sessionDate = "2000-01-01"), "date", /does not match the file name/);
    await mutate((o) => (o.evidence.tGen = "2026-01-01T00:00:00Z"), "tGen", /tGen differs/);
    await mutate((o) => (o.ruleVersion = "mv1-00000000"), "other version", /does not exist|ruleVersion/);
    const r = await repo();
    await r.w(`${ROOT}/live/receipts/2099-01-01.json`, "{}"); // orphan receipt
    expect((await r.guard()).violations.some((v) => v.kind === "receipt" && /does not exist/.test(v.detail))).toBe(true);
  });
  it("ledger-state.json is validated: tampered statuses, extra keys and prediction payloads are rejected", async () => {
    const tamper = async (f: (s: any) => void, label: string, expectMsg: RegExp) => {
      const r = await repo();
      const file = path.join(r.dir, ledgerPaths(`${ROOT}`).state);
      const obj = JSON.parse(await readFile(file, "utf-8"));
      f(obj);
      await writeFile(file, JSON.stringify(obj));
      expect((await r.guard()).violations.filter((x) => x.kind === "state").map((x) => x.detail).join("\n"), label).toMatch(expectMsg);
    };
    await tamper((s) => (s.runStatus = "great"), "status", /runStatus great is not permitted/);
    await tamper((s) => (s.dates["2026-10-29"] = { status: "live", reasons: [], publicationClass: "yes", updatedAt: "x" }), "date record", /status live is not permitted|publicationClass yes/);
    await tamper((s) => (s.predictions = [{ predictionId: "x" }]), "predictions", /unknown top-level key predictions|prediction payload/);
    await tamper((s) => (s.dates["2026-10-29"] = { status: "recorded", reasons: [], publicationClass: null, updatedAt: "2026-11-01T00:00:00Z", header: { lists: {} } }), "payload", /unknown key header|prediction payload/);
    await tamper((s) => (s.calendar["2026-10-29"] = "maybe"), "calendar", /calendar .* is not permitted/);
    await tamper((s) => (s.kind = "other"), "kind", /kind must be/);
    await tamper((s) => (s.ruleVersion = "mv1-xyz"), "ruleVersion", /ruleVersion must be/);
    await tamper((s) => (s.dates["not-a-date"] = {}), "bad key", /is not a date/);
  });
  it("flags leftover partial files and invalid daily files in the tree", async () => {
    const r = await repo();
    await r.w(`${ROOT}/live/predictions/mv1-x/2026-10-29.json.1-ab.partial`, "{");
    await r.w(`${ROOT}/live/predictions/mv1-x/2026-10-29.json`, '{"header":{}}');
    const kinds = (await r.guard()).violations.map((v) => v.kind);
    expect(kinds).toContain("partial");
    expect(kinds).toContain("file");
  });
  it("a clean ledger passes", async () => {
    const r = await repo();
    expect((await r.guard()).violations).toEqual([]);
  });
});

describe("holdout transitions in history", () => {
  it("rejects an edited protocol reference, a premature unblind and deletion; accepts a proper unblind", async () => {
    const r = await repo();
    const h = buildHoldoutFile();
    await r.w(`${ROOT}/holdout.json`, JSON.stringify({ ...h, startDate: "2026-11-02", status: "sealed" }, null, 1));
    r.git("commit", "-aqm", "tamper-sealed");
    expect((await r.guard()).violations.some((v) => v.kind === "holdout")).toBe(true);
    const r2 = await repo();
    await r2.w(`${ROOT}/holdout.json`, JSON.stringify({ ...h, status: "unblinded", unblinded: { authorisedBy: "me", authorisedAt: "2027-01-01", completedLiveSessions: 3, exemptionsCount: 0 } }, null, 1));
    r2.git("commit", "-aqm", "early");
    expect((await r2.guard()).violations.some((v) => v.kind === "holdout")).toBe(true);
    const r3 = await repo();
    await r3.w(`${ROOT}/holdout.json`, JSON.stringify({ ...h, status: "unblinded", unblinded: { authorisedBy: "me", authorisedAt: "2027-01-01", completedLiveSessions: 250, exemptionsCount: 0 } }, null, 1));
    r3.git("commit", "-aqm", "ok");
    // the transition itself is acceptable; the NEW eligibility rule still refuses to count sessions that are not eligible
    const r3v = (await r3.guard()).violations.filter((v) => v.kind === "holdout");
    expect(r3v.every((v) => /sessions are eligible/.test(v.detail))).toBe(true);
    const r4 = await repo();
    r4.git("rm", "-q", `${ROOT}/holdout.json`);
    r4.git("commit", "-qm", "del");
    expect((await r4.guard()).violations.some((v) => v.kind === "protocol" || v.kind === "holdout")).toBe(true);
  });
  it("protocol tampering is caught by the integrity check", async () => {
    const r = await repo();
    const od1 = buildOd1File();
    (od1.definitions as any).horizons = [1, 2];
    await r.w(`${ROOT}/protocol/od1.json`, JSON.stringify(od1, null, 1));
    const v = (await r.guard()).violations;
    expect(v.some((x) => x.kind === "protocol")).toBe(true);
  });
});
