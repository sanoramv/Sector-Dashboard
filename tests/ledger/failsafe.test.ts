/**
 * F6 - the data commit must never carry unvalidated ledger changes, whatever happens to the pre-commit step.
 * These tests execute the REAL `run:` text of the "Commit updated data" workflow step and the real shell scripts in
 * throw-away git repositories with a local bare "origin". They prove the shell/Git behaviour; whether GitHub Actions
 * wires the step outcomes into the environment can only be proven by a real Actions run (the static checks at the
 * bottom only verify the wiring text).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { chmod, cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpDir } from "./fixture";

const run = promisify(execFile);
let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const yaml = () => readFile(".github/workflows/update-data.yml", "utf-8");
/** The literal shell of a workflow step. */
async function stepRun(name: string): Promise<string> {
  const y = await yaml();
  const i = y.indexOf(`- name: ${name}`);
  const r = y.indexOf("run: |\n", i);
  const lines = y.slice(r + 7).split("\n");
  const body: string[] = [];
  for (const l of lines) {
    if (l.startsWith("          ") || l.trim() === "") body.push(l.replace(/^ {10}/, ""));
    else break;
  }
  return body.join("\n");
}

let n = 0;
async function sandbox() {
  const base = path.join(tmp.dir, `f${n++}`);
  const origin = path.join(base, "origin.git");
  const work = path.join(base, "work");
  await mkdir(base, { recursive: true });
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd, encoding: "utf-8" });
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, work]);
  g(work, "checkout", "-q", "-b", "main");
  await mkdir(path.join(work, "scripts"), { recursive: true });
  for (const f of ["ledger-stage-data.sh", "ledger-failsafe-restore.sh"]) await cp(`scripts/${f}`, path.join(work, "scripts", f));
  const L = path.join(work, "public/data/ledger");
  await mkdir(path.join(L, "live/predictions/mv1-aaaaaaaa"), { recursive: true });
  await writeFile(path.join(work, "public/data/stocks.json"), '{"v":1}');
  await writeFile(path.join(L, "live/predictions/mv1-aaaaaaaa/2026-10-28.json"), '{"good":"record"}');
  await writeFile(path.join(L, "ledger-state.json"), '{"s":1}');
  g(work, "add", "-A");
  g(work, "commit", "-qm", "baseline");
  g(work, "push", "-q", "origin", "main");
  const originFiles = () => g(origin, "ls-tree", "-r", "--name-only", "main").trim().split("\n");
  const originFile = (f: string) => g(origin, "show", `main:${f}`);
  const commitStep = async (env: Record<string, string>) => {
    const script = await stepRun("Commit updated data if anything changed");
    return run("bash", ["-e", "-c", script], { cwd: work, env: { ...process.env, ...env } }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e) => ({ code: (e.code as number) ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }),
    );
  };
  /** the pending state a data run produces: a market-data change plus an INVALID new ledger file and a changed state */
  const makePending = async () => {
    await writeFile(path.join(work, "public/data/stocks.json"), '{"v":2,"fresh":"market data"}');
    await writeFile(path.join(L, "live/predictions/mv1-aaaaaaaa/2026-10-29.json"), "{ INVALID JSON");
    await writeFile(path.join(L, "ledger-state.json"), '{"s":2}');
  };
  return { work, L, g, originFiles, originFile, commitStep, makePending, origin };
}

describe("F6: unvalidated ledger changes cannot be committed or pushed", () => {
  it("control: when the ledger is validated (LEDGER_SAFE=true) the commit carries market data AND the ledger changes", async () => {
    const s = await sandbox();
    await s.makePending();
    const r = await s.commitStep({ LEDGER_SAFE: "true" });
    expect(r.code, r.out).toBe(0);
    expect(s.originFiles()).toContain("public/data/ledger/live/predictions/mv1-aaaaaaaa/2026-10-29.json");
  });

  it("LEDGER_SAFE=false: the market-data change is committed and pushed, the invalid ledger file and state change are NOT", async () => {
    const s = await sandbox();
    await s.makePending();
    const r = await s.commitStep({ LEDGER_SAFE: "false" });
    expect(r.code, r.out).toBe(0);
    expect(s.originFile("public/data/stocks.json")).toContain("fresh");
    expect(s.originFiles()).not.toContain("public/data/ledger/live/predictions/mv1-aaaaaaaa/2026-10-29.json");
    expect(s.originFile("public/data/ledger/ledger-state.json")).toBe('{"s":1}'); // unchanged on origin
    expect(s.originFile("public/data/ledger/live/predictions/mv1-aaaaaaaa/2026-10-28.json")).toBe('{"good":"record"}'); // existing record intact
    expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toContain("fresh"); // market data never reset
    expect(r.out).toMatch(/keeping them out of this commit/);
  });

  it("an unset LEDGER_SAFE is treated as unsafe (fail closed)", async () => {
    const s = await sandbox();
    await s.makePending();
    const r = await s.commitStep({});
    expect(r.code, r.out).toBe(0);
    expect(s.originFiles()).not.toContain("public/data/ledger/live/predictions/mv1-aaaaaaaa/2026-10-29.json");
  });

  it("validation FAILURE with a successful rollback: market data commits, the ledger is back to HEAD", async () => {
    const s = await sandbox();
    await s.makePending();
    const fs1 = await run("bash", [path.join(s.work, "scripts/ledger-failsafe-restore.sh")], { cwd: s.work });
    expect(fs1.stdout).toMatch(/restored to HEAD/);
    expect(await readFile(path.join(s.L, "ledger-state.json"), "utf-8")).toBe('{"s":1}');
    expect(await readdir(path.join(s.L, "live/predictions/mv1-aaaaaaaa"))).toEqual(["2026-10-28.json"]);
    expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toContain("fresh"); // outside the ledger: untouched
    const r = await s.commitStep({ LEDGER_SAFE: "true" });
    expect(r.code, r.out).toBe(0);
    expect(s.originFile("public/data/stocks.json")).toContain("fresh");
    expect(s.originFiles().filter((f) => f.includes("2026-10-29"))).toEqual([]);
  });

  it("RESTORE FAILURE (the ledger directory cannot be cleaned): the fail-safe fails, and the commit step refuses to push anything unvalidated", async () => {
    const s = await sandbox();
    await s.makePending();
    const dir = path.join(s.L, "live/predictions/mv1-aaaaaaaa");
    await chmod(dir, 0o555); // cannot delete the untracked invalid file here
    try {
      const failsafe = await run("bash", [path.join(s.work, "scripts/ledger-failsafe-restore.sh")], { cwd: s.work }).then(() => 0, (e) => e.code as number);
      expect(failsafe).not.toBe(0);
      const before = s.g(s.origin, "rev-parse", "main").trim();
      const r = await s.commitStep({ LEDGER_SAFE: "false" });
      expect(r.code, r.out).not.toBe(0); // fail closed: no commit at all
      expect(s.g(s.origin, "rev-parse", "main").trim()).toBe(before); // nothing was pushed
      expect(s.originFiles()).not.toContain("public/data/ledger/live/predictions/mv1-aaaaaaaa/2026-10-29.json");
      expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toContain("fresh"); // market data kept in the working tree
    } finally {
      await chmod(dir, 0o755);
    }
  });

  it("the fail-safe script touches nothing outside the ledger directory and works when HEAD has no ledger files yet", async () => {
    const s = await sandbox();
    await writeFile(path.join(s.work, "public/data/stocks.json"), '{"v":3}');
    await writeFile(path.join(s.work, "public/data/other.json"), '{"keep":"me"}');
    await run("bash", [path.join(s.work, "scripts/ledger-failsafe-restore.sh")], { cwd: s.work });
    expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toBe('{"v":3}');
    expect(await readFile(path.join(s.work, "public/data/other.json"), "utf-8")).toBe('{"keep":"me"}');
    // a repo whose HEAD has no ledger files
    const base = path.join(tmp.dir, "noledger");
    await mkdir(path.join(base, "public/data/ledger/live"), { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main", base]);
    await writeFile(path.join(base, "public/data/a.json"), "{}");
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"], { cwd: base });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x"], { cwd: base });
    await writeFile(path.join(base, "public/data/ledger/live/new.json"), "{}");
    await cp("scripts/ledger-failsafe-restore.sh", path.join(base, "fs.sh"));
    await run("bash", [path.join(base, "fs.sh")], { cwd: base });
    expect(await readdir(path.join(base, "public/data/ledger")).catch(() => [])).toEqual([]);
    expect(await readFile(path.join(base, "public/data/a.json"), "utf-8")).toBe("{}");
  });
});

describe("F6: the pre-commit CLI itself (real process)", () => {
  const cli = (repoRoot: string, env: Record<string, string> = {}) =>
    run("npx", ["tsx", path.resolve("scripts/ledger-precommit.mts"), "--repo-root", repoRoot, "--no-manifest"], { cwd: path.resolve("."), env: { ...process.env, ...env }, timeout: 120_000 }).then(
      (r) => ({ code: 0, out: r.stdout + r.stderr }),
      (e) => ({ code: e.code as number, out: String(e.stdout ?? "") + String(e.stderr ?? "") }),
    );

  it("CRASH (not a git repository): exits 2 and does NOT announce a completed rollback", async () => {
    const dir = path.join(tmp.dir, "crash");
    await mkdir(path.join(dir, "public/data/ledger"), { recursive: true });
    const out = path.join(tmp.dir, "gh-output-crash");
    await writeFile(out, "");
    const r = await cli(dir, { GITHUB_OUTPUT: out });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/could not finish/);
    expect(await readFile(out, "utf-8")).not.toMatch(/restored=true/);
  }, 130_000);

  it("VALIDATION FAILURE: exits 1, restores only the ledger, records the anomaly and announces restored=true", async () => {
    const s = await sandbox();
    await s.makePending();
    const out = path.join(tmp.dir, "gh-output-reject");
    await writeFile(out, "");
    const r = await cli(s.work, { GITHUB_OUTPUT: out });
    expect(r.code, r.out).toBe(1);
    expect(await readFile(out, "utf-8")).toMatch(/restored=true/);
    expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toContain("fresh"); // market data untouched
    expect(await readdir(path.join(s.L, "live/predictions/mv1-aaaaaaaa"))).toEqual(["2026-10-28.json"]); // invalid file removed, record intact
  }, 130_000);

  it("an unsafe ledger root can never be cleaned (F4)", async () => {
    const s = await sandbox();
    await writeFile(path.join(s.work, "public/data/untracked-market-file.json"), "{}");
    for (const bad of [".", "", "..", "public/data", "public", "/", "public/data/ledger/../..", "../outside"]) {
      const r = await run("npx", ["tsx", path.resolve("scripts/ledger-precommit.mts"), "--repo-root", s.work, "--ledger-root", bad, "--no-manifest"], { cwd: path.resolve("."), timeout: 120_000 }).then(() => 0, (e) => e.code as number);
      expect(r, JSON.stringify(bad)).not.toBe(0);
    }
    expect(await readFile(path.join(s.work, "public/data/untracked-market-file.json"), "utf-8")).toBe("{}"); // never cleaned
  }, 300_000);
});

describe("F6: workflow wiring (static text only; behaviour needs a real Actions run)", () => {
  it("the fail-safe runs only when pre-commit neither passed nor completed a rollback; the commit gets LEDGER_SAFE from all three", async () => {
    const y = await yaml();
    expect(y).toMatch(/id: ledger_failsafe\n\s+if: \$\{\{ steps\.ledger_precommit\.outcome != 'success' && steps\.ledger_precommit\.outputs\.restored != 'true' \}\}/);
    expect(y).toContain("LEDGER_SAFE: ${{ steps.ledger_precommit.outcome == 'success' || steps.ledger_precommit.outputs.restored == 'true' || steps.ledger_failsafe.outcome == 'success' }}");
    const i = y.indexOf("- name: Commit updated data");
    expect(y.indexOf("- name: Ledger fail-safe restore")).toBeLessThan(i);
    expect(y.indexOf("- name: Ledger pre-commit validation")).toBeLessThan(y.indexOf("- name: Ledger fail-safe restore"));
  });
});

describe("B1: the fail-safe restore works on a LARGE ledger (regression for the grep -q / pipefail bug)", () => {
  it("restores the original state and removes the invalid file when the tracked ledger listing is large", async () => {
    const s = await sandbox();
    // 3,000 tracked files with long names: the listing is ~240 KB, far above a pipe buffer
    const dir = path.join(s.L, "live/predictions/mv1-aaaaaaaa");
    await Promise.all(Array.from({ length: 3000 }, (_, i) => writeFile(path.join(dir, `2020-01-01-file-with-a-fairly-long-name-to-fill-the-pipe-buffer-${i}.json`), "{}")));
    s.g(s.work, "add", "-A");
    s.g(s.work, "commit", "-qm", "large ledger");
    expect(s.g(s.work, "ls-tree", "-r", "--name-only", "HEAD", "--", "public/data/ledger").length).toBeGreaterThan(200_000);
    await s.makePending(); // state changed + invalid new file + market-data change
    for (let attempt = 1; attempt <= 5; attempt++) {
      // five runs: the old bug depended on timing, so one lucky pass proves nothing
      await writeFile(path.join(s.L, "ledger-state.json"), '{"s":2}');
      await writeFile(path.join(dir, "2026-10-29.json"), "{ INVALID JSON");
      const r = await run("bash", [path.join(s.work, "scripts/ledger-failsafe-restore.sh")], { cwd: s.work }).then((x) => ({ code: 0, out: x.stdout }), (e) => ({ code: e.code as number, out: String(e.stdout) + String(e.stderr) }));
      expect(r.code, `attempt ${attempt}: ${r.out}`).toBe(0);
      expect(await readFile(path.join(s.L, "ledger-state.json"), "utf-8"), `attempt ${attempt}`).toBe('{"s":1}'); // the ORIGINAL state is back
      expect((await readdir(dir)).includes("2026-10-29.json"), `attempt ${attempt}`).toBe(false);
      expect((await readdir(dir)).length).toBe(3001); // all tracked files intact (3000 + the baseline record)
    }
    expect(await readFile(path.join(s.work, "public/data/stocks.json"), "utf-8")).toContain("fresh"); // market data untouched
  }, 180_000);

  it("the script no longer contains the unsafe pipe", async () => {
    const src = await readFile("scripts/ledger-failsafe-restore.sh", "utf-8");
    expect(src.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")).not.toMatch(/\|\s*grep -q/);
  });
});
