/**
 * The REAL enable CLI (scripts/ledger-protocol.mts --from ...) run as a process, but ONLY inside throw-away sandbox
 * repositories under the OS temp directory (with a local bare "origin"). Every call passes --repo-root explicitly; the
 * helper refuses to run if that path is not inside the temp directory, so these tests can never touch the real project.
 * The clock is fixed through NODE_ENV=test + LEDGER_TEST_NOW (ignored outside tests).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RULE_FILES } from "../../scripts/ledger/ruleVersion.mts";
import { tmpDir } from "./fixture";

const run = promisify(execFile);
let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const NOW = "2026-11-02T10:00:00Z"; // Monday 15:30 IST: the latest due session is Friday 2026-10-30
const ok = (d: string) => ({ status: "ok", checkedAt: `${d}T14:00:00Z`, attempts: 1, symbolSetHash: "x" });

interface Opts {
  latest?: string | null;
  index?: Record<string, object>;
  stocks?: Record<string, object>;
  manifest?: boolean;
}
let n = 0;
async function sandbox(o: Opts = {}) {
  const base = path.join(tmp.dir, `e${n++}`);
  expect(path.resolve(base).startsWith(path.resolve(os.tmpdir()))).toBe(true);
  const origin = path.join(base, "origin.git");
  const work = path.join(base, "work");
  await mkdir(base, { recursive: true });
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf-8" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work]);
  g(work, "checkout", "-q", "-b", "main");
  for (const f of RULE_FILES) {
    await mkdir(path.dirname(path.join(work, f)), { recursive: true });
    await cp(f, path.join(work, f));
  }
  await mkdir(path.join(work, "public/data"), { recursive: true });
  const latest = o.latest === undefined ? "2026-10-30" : o.latest;
  const days = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"];
  if (o.manifest !== false) await writeFile(path.join(work, "public/data/manifest.json"), JSON.stringify(latest === null ? {} : { latestMarketDate: latest }));
  await writeFile(path.join(work, "public/data/refresh-state.json"), JSON.stringify({ schemaVersion: 1, archives: { index: { ...Object.fromEntries(days.map((d) => [d, ok(d)])), ...(o.index ?? {}) }, stocks: { ...Object.fromEntries(days.map((d) => [d, ok(d)])), ...(o.stocks ?? {}) } } }));
  g(work, "add", "-A");
  g(work, "commit", "-qm", "base");
  g(work, "push", "-q", "origin", "main");
  const versionsDir = path.join(work, "public/data/ledger/protocol/versions");
  const enable = async (from: string, extra: string[] = []) => {
    expect(path.resolve(work).startsWith(path.resolve(os.tmpdir()))).toBe(true);
    return run("npx", ["tsx", path.resolve("scripts/ledger-protocol.mts"), "--repo-root", work, "--from", from, ...extra], { cwd: path.resolve("."), env: { ...process.env, NODE_ENV: "test", LEDGER_TEST_NOW: NOW }, timeout: 120_000 }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e) => ({ code: (e.code as number) ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }),
    );
  };
  const records = async () => (await readdir(versionsDir).catch(() => [])).filter((x) => x.endsWith(".json"));
  return { work, origin, g, enable, versionsDir, records };
}

describe("ledger:enable CLI (sandboxed, real process)", () => {
  it("accepts exactly the next eligible session, writes a strict record and nothing else", async () => {
    const s = await sandbox();
    const r = await s.enable("2026-11-02");
    expect(r.code, r.out).toBe(0);
    const files = await s.records();
    expect(files).toHaveLength(1);
    const rec = JSON.parse(await readFile(path.join(s.versionsDir, files[0]), "utf-8"));
    expect(rec).toMatchObject({ kind: "momentum-ledger.version", enabledFrom: "2026-11-02", latestMarketDateAtEnable: "2026-10-30" });
    expect(files[0]).toBe(`${rec.ruleVersion}.json`);
    expect(await readdir(path.join(s.work, "public/data/ledger"))).toEqual(["protocol"]); // no predictions, no state
  }, 130_000);

  it("refuses a past date, and the latest already-published date, and names the expected date", async () => {
    const s = await sandbox();
    for (const d of ["2025-01-01", "2026-10-29", "2026-10-30"]) {
      const r = await s.enable(d);
      expect(r.code, d).toBe(1);
      expect(r.out, d).toMatch(/on or before the latest published market date 2026-10-30/);
      expect(r.out, d).toMatch(/--from 2026-11-02/);
    }
    expect(await s.records()).toEqual([]);
  }, 300_000);

  it("refuses a skipped session and a postponed activation", async () => {
    const s = await sandbox();
    const r = await s.enable("2026-11-03");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/not the next eligible session.*2026-11-02/);
    expect(await s.records()).toEqual([]);
  }, 130_000);

  it("holiday: skips a known exchange holiday as the next session and refuses the holiday itself", async () => {
    const s = await sandbox({ index: { "2026-11-02": { status: "missing", checkedAt: "x", attempts: 1 } }, stocks: { "2026-11-02": { status: "earlier-session", checkedAt: "x", attempts: 1 } } });
    const holiday = await s.enable("2026-11-02");
    expect(holiday.code).toBe(1);
    expect(holiday.out).toMatch(/--from 2026-11-03/);
    expect(await s.records()).toEqual([]);
    const next = await s.enable("2026-11-03");
    expect(next.code, next.out).toBe(0);
  }, 300_000);

  it("refuses an unresolved or ambiguous next session", async () => {
    const s = await sandbox({ index: { "2026-11-02": { status: "failed", checkedAt: "x", attempts: 4 } }, stocks: { "2026-11-02": ok("2026-11-02") } });
    const r = await s.enable("2026-11-02");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/unresolved/);
    expect(await s.records()).toEqual([]);
  }, 130_000);

  it("fails closed when the latest market date cannot be established (missing manifest, or none in it)", async () => {
    const noFile = await sandbox({ manifest: false });
    const a = await noFile.enable("2026-11-02");
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/Cannot read the published market data/);
    const noDate = await sandbox({ latest: null });
    const b = await noDate.enable("2026-11-02");
    expect(b.code).toBe(1);
    expect(b.out).toMatch(/latest published market date cannot be established/);
    expect([...(await noFile.records()), ...(await noDate.records())]).toEqual([]);
  }, 300_000);

  it("stale local checkout (behind origin): refuses, even for a date that looks correct", async () => {
    const s = await sandbox();
    const other = path.join(path.dirname(s.work), "other");
    execFileSync("git", ["clone", "-q", s.origin, other]);
    await writeFile(path.join(other, "public/data/manifest.json"), JSON.stringify({ latestMarketDate: "2026-11-02" }));
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "newer data"], { cwd: other });
    execFileSync("git", ["push", "-q", "origin", "main"], { cwd: other });
    const r = await s.enable("2026-11-02");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/behind origin\/main/);
    expect(await s.records()).toEqual([]);
  }, 130_000);

  it("stale local data by the clock: sessions that were due but are absent locally make it refuse", async () => {
    const s = await sandbox({ latest: "2026-10-28", index: {}, stocks: {} });
    // refresh-state lacks Oct 29 and Oct 30 results entirely (this checkout never fetched them)
    const rs = JSON.parse(await readFile(path.join(s.work, "public/data/refresh-state.json"), "utf-8"));
    delete rs.archives.index["2026-10-29"];
    delete rs.archives.index["2026-10-30"];
    delete rs.archives.stocks["2026-10-29"];
    delete rs.archives.stocks["2026-10-30"];
    await writeFile(path.join(s.work, "public/data/refresh-state.json"), JSON.stringify(rs));
    s.g(s.work, "commit", "-qam", "stale");
    s.g(s.work, "push", "-q", "origin", "main");
    const r = await s.enable("2026-10-29");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/looks behind the published data/);
    expect(await s.records()).toEqual([]);
  }, 130_000);

  it("a hand-created invalid or backdated version record already present makes the CLI refuse to build on it", async () => {
    const s = await sandbox();
    await mkdir(s.versionsDir, { recursive: true });
    await writeFile(path.join(s.versionsDir, "mv1-aaaaaaaa.json"), JSON.stringify({ kind: "momentum-ledger.version", schemaVersion: 1, ruleVersion: "mv1-aaaaaaaa", enabledFrom: "2026-10-01" })); // missing key, backdated
    s.g(s.work, "add", "-A");
    s.g(s.work, "commit", "-qm", "hand-made record");
    s.g(s.work, "push", "-q", "origin", "main");
    const r = await s.enable("2026-11-02");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/Existing version record mv1-aaaaaaaa\.json is invalid/);
    expect(await s.records()).toEqual(["mv1-aaaaaaaa.json"]); // nothing new was created
  }, 130_000);

  it("rejects malformed --from values and gives no override flag", async () => {
    const s = await sandbox();
    for (const bad of ["tomorrow", "2026-1-5", "2026-13-01"]) expect((await s.enable(bad)).code, bad).toBe(1);
    for (const flag of ["--force", "--allow-past", "--override", "--backfill"]) {
      const r = await s.enable("2025-01-01", [flag]);
      expect(r.code, flag).toBe(1);
    }
    expect(await s.records()).toEqual([]);
  }, 400_000);

  it("the safety warning is shown BEFORE the record is written (and it is written only after the warning)", async () => {
    const s = await sandbox();
    const r = await s.enable("2026-11-02");
    expect(r.code, r.out).toBe(0);
    const warn = r.out.indexOf("READ THIS BEFORE THE ENABLE RECORD IS WRITTEN");
    const done = r.out.indexOf("enabled mv1-");
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(done).toBeGreaterThan(warn);
    for (const must of [/push it IMMEDIATELY/, /must NOT publish 2026-11-02's market data before this\s+record reaches the default branch/, /do NOT rebase blindly/, /latestMarketDate is 2026-11-02 or later/, /npm run ledger:guard/, /Do not change any rule file/]) expect(r.out).toMatch(must);
  }, 130_000);

  it("proof of order: when the write itself fails, the warning has already been printed and no record exists", async () => {
    const s = await sandbox();
    const protocol = path.join(s.work, "public/data/ledger/protocol");
    await mkdir(protocol, { recursive: true });
    await chmod(protocol, 0o555); // the versions folder cannot be created here, so the write fails
    try {
      const r = await s.enable("2026-11-02");
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/READ THIS BEFORE THE ENABLE RECORD IS WRITTEN/);
      expect(r.out).not.toMatch(/enabled mv1-/);
      expect(await s.records()).toEqual([]);
    } finally {
      await chmod(protocol, 0o755);
    }
  }, 130_000);

  it("a refused enable shows no warning (nothing is about to be written)", async () => {
    const s = await sandbox();
    const r = await s.enable("2026-10-30");
    expect(r.code).toBe(1);
    expect(r.out).not.toMatch(/READ THIS BEFORE THE ENABLE RECORD IS WRITTEN/);
  }, 130_000);
});
