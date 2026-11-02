import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCapture } from "../../scripts/ledger/capture.mts";
import { cleanPartials, createOnly } from "../../scripts/ledger/files.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { scanHistory, validateTree, type GuardGit } from "../../scripts/ledger/guard.mts";
import { last, makeEnv, makeFixture, tmpDir } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

describe("crash recovery", () => {
  it("a crash after the partial file was created leaves no valid record; the next run creates the file and the partial is removed by cleanup", async () => {
    const root = path.join(tmp.dir, "partial");
    const env = await makeEnv(root);
    const dir = ledgerPaths(root).predictionsDir(env.ruleVersion);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${last}.json.4242-ab12.partial`), '{"header":{"sess'); // what an interrupted createOnly leaves
    expect((await readdir(dir)).filter((f) => f.endsWith(".json"))).toEqual([]); // not a record
    const run = await runCapture(makeFixture().source, env);
    expect(run.sessions.find((s) => s.date === last)?.outcome).toBe("recorded");
    expect((await validateTree(root)).filter((v) => v.kind !== "protocol").map((v) => v.kind)).toEqual(["partial"]); // the guard flags the leftover until it is cleaned
    expect(await cleanPartials(root)).toHaveLength(1);
    expect((await validateTree(root)).filter((v) => v.kind !== "protocol")).toEqual([]);
  });

  it("a crash after the final link but before cleanup: the file is complete and a rerun is an identical no-op", async () => {
    const root = path.join(tmp.dir, "linked");
    const env = await makeEnv(root);
    await runCapture(makeFixture().source, env);
    const file = ledgerPaths(root).dailyFile(env.ruleVersion, last);
    const before = await readFile(file, "utf-8");
    const run2 = await runCapture(makeFixture().source, await makeEnv(root, { now: new Date(`${last}T23:30:00Z`) }));
    expect(run2.sessions.find((s) => s.date === last)).toMatchObject({ outcome: "exists", r6: { status: "existing" } });
    expect(await readFile(file, "utf-8")).toBe(before);
  });
});

describe("rule versions coexist; corrections are new files", () => {
  it("a new rule version writes beside the old one and never touches it", async () => {
    const root = path.join(tmp.dir, "coexist");
    const a = await makeEnv(root);
    await runCapture(makeFixture().source, a);
    const fileA = ledgerPaths(root).dailyFile(a.ruleVersion, last);
    const beforeA = await readFile(fileA, "utf-8");
    const b = await makeEnv(root, { ruleVersion: "mv1-bbbbbbbb", enabledVersion: "mv1-bbbbbbbb", now: new Date(`${last}T22:00:00Z`) });
    const run = await runCapture(makeFixture().source, b);
    expect(run.sessions.find((s) => s.date === last)?.outcome).toBe("recorded");
    expect(await readFile(fileA, "utf-8")).toBe(beforeA);
    expect(JSON.parse(await readFile(ledgerPaths(root).dailyFile("mv1-bbbbbbbb", last), "utf-8")).header.model.ruleVersion).toBe("mv1-bbbbbbbb");
    expect((await validateTree(root)).filter((v) => v.kind !== "protocol")).toEqual([]);
    // R6 is per (date, ruleVersion): version B's record does not make version A's date look duplicated.
    const again = await runCapture(makeFixture().source, a);
    expect(again.sessions.find((s) => s.date === last)?.r6?.status).toBe("existing");
  });

  it("a correction is a separate create-only file; the original stays byte-identical and corrections cannot be overwritten", async () => {
    const root = path.join(tmp.dir, "correction");
    const env = await makeEnv(root);
    await runCapture(makeFixture().source, env);
    const p = ledgerPaths(root);
    const original = await readFile(p.dailyFile(env.ruleVersion, last), "utf-8");
    const c1 = p.correctionFile(env.ruleVersion, last, 1);
    expect(c1).not.toBe(p.dailyFile(env.ruleVersion, last));
    expect(await createOnly(c1, '{"note":"first correction"}')).toEqual({ created: true });
    expect(await createOnly(c1, '{"note":"another"}')).toEqual({ created: false, existing: "different" });
    expect(await readFile(c1, "utf-8")).toBe('{"note":"first correction"}');
    expect(await readFile(p.dailyFile(env.ruleVersion, last), "utf-8")).toBe(original);
  });

  it("the guard treats a modified or deleted correction like any other protected record", async () => {
    const git: GuardGit = { log: async () => "@@" + "c".repeat(40) + "\nM\tpublic/data/ledger/live/corrections/mv1-x/2026-10-29.v1.json\n@@" + "d".repeat(40) + "\nD\tpublic/data/ledger/live/corrections/mv1-x/2026-10-29.v2.json\n", show: async () => null, revParse: async () => null };
    const v = await scanHistory(git, "public/data/ledger");
    expect(v).toHaveLength(2);
    expect(v.every((x) => !x.acknowledged)).toBe(true);
  });
});
