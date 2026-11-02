import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateGate, parseOutcome } from "../../scripts/ledger/gate.mts";
import { emptyState } from "../../scripts/ledger/state.mts";
import { tmpDir } from "./fixture";

const run = promisify(execFile);
let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const okState = () => ({ ...emptyState("2026-11-01T00:00:00Z"), runStatus: "ok" as const, lastSuccessfulSessionDate: "2026-10-30" });
const outcomes = { captureOutcome: "success", verifyOutcome: "success", precommitOutcome: "success" } as const;

describe("gate decision (pure)", () => {
  it("passes only when every step succeeded and the state is healthy", () => {
    expect(evaluateGate({ state: okState(), ...outcomes }).exitCode).toBe(0);
  });
  it("a failed capture step fails the gate even though ledger-state.json holds an old successful status", () => {
    const g = evaluateGate({ state: okState(), ...outcomes, captureOutcome: "failure" });
    expect(g.exitCode).toBe(1);
    expect(g.errors.join()).toMatch(/capture step failed.*stale/);
  });
  it("failed or skipped verification / pre-commit steps fail the gate, as does cancellation", () => {
    for (const k of ["verifyOutcome", "precommitOutcome", "captureOutcome"] as const) for (const o of ["failure", "skipped", "cancelled"] as const) expect(evaluateGate({ state: okState(), ...outcomes, [k]: o }).exitCode, `${k}=${o}`).toBe(1);
  });
  it("blocked, anomaly and error states fail; waiting and not-enabled only warn", () => {
    for (const s of ["blocked", "anomaly", "error"] as const) expect(evaluateGate({ state: { ...okState(), runStatus: s }, ...outcomes }).exitCode).toBe(1);
    for (const s of ["waiting", "not-enabled"] as const) {
      const g = evaluateGate({ state: { ...okState(), runStatus: s }, ...outcomes });
      expect(g.exitCode).toBe(0);
      expect(g.warnings.length).toBe(1);
    }
  });
  it("an outcome that was not supplied is only a warning (outside the workflow) and never silently a success", () => {
    const g = evaluateGate({ state: okState(), captureOutcome: parseOutcome(undefined), verifyOutcome: "success", precommitOutcome: "success" });
    expect(g.exitCode).toBe(0);
    expect(g.warnings.join()).toMatch(/not supplied/);
    expect(parseOutcome("weird")).toBe("unknown");
  });
});

/** A throw-away repository root with the data files the CLIs read. */
async function sandbox(name: string) {
  const dir = path.join(tmp.dir, name);
  await mkdir(path.join(dir, "public/data"), { recursive: true });
  await cp("public/data/manifest.json", path.join(dir, "public/data/manifest.json"));
  return dir;
}
const cli = (script: string, repoRoot: string, args: string[] = [], env: Record<string, string> = {}) =>
  run("npx", ["tsx", path.resolve(script), "--repo-root", repoRoot, ...args], { cwd: path.resolve("."), env: { ...process.env, ...env }, timeout: 120_000 }).then(
    (r) => ({ code: 0, out: r.stdout + r.stderr }),
    (e) => ({ code: e.code as number, out: String(e.stdout ?? "") + String(e.stderr ?? "") }),
  );

describe("a crashed capture cannot hide behind a stale successful state (real CLI)", () => {
  it("crash BEFORE the state is loaded: the CLI exits non-zero, the stale state stays 'ok', and the gate still fails", async () => {
    const dir = await sandbox("crash-before-state");
    const ledger = path.join(dir, "public/data/ledger");
    await mkdir(ledger, { recursive: true });
    await writeFile(path.join(ledger, "ledger-state.json"), "{ corrupt"); // loadLedgerState throws outside the try block
    const cap = await cli("scripts/ledger-capture.mts", dir);
    expect(cap.code).not.toBe(0);
    // Pretend an earlier successful run left an 'ok' state behind, then evaluate the gate with the real step outcome.
    await writeFile(path.join(ledger, "ledger-state.json"), JSON.stringify(okState()));
    const gate = await cli("scripts/ledger-gate.mts", dir, [], { LEDGER_CAPTURE_OUTCOME: cap.code === 0 ? "success" : "failure", LEDGER_VERIFY_OUTCOME: "success", LEDGER_PRECOMMIT_OUTCOME: "success" });
    expect(gate.code).toBe(1);
    expect(gate.out).toMatch(/capture step failed/);
  });

  it("crash DURING capture (unreadable source data): the crash handler records an error state and exits non-zero", async () => {
    const dir = await sandbox("crash-during");
    const cap = await cli("scripts/ledger-capture.mts", dir); // stocks.json etc. are missing
    expect(cap.code).not.toBe(0);
    const state = JSON.parse(await readFile(path.join(dir, "public/data/ledger/ledger-state.json"), "utf-8"));
    expect(state.runStatus).toBe("error");
    const gate = await cli("scripts/ledger-gate.mts", dir, [], { LEDGER_CAPTURE_OUTCOME: "failure", LEDGER_VERIFY_OUTCOME: "success", LEDGER_PRECOMMIT_OUTCOME: "success" });
    expect(gate.code).toBe(1);
  });

  it("crash BEFORE the state update: the old 'ok' state is untouched, and only the step outcome reveals the failure", async () => {
    const dir = await sandbox("crash-before-update");
    const ledger = path.join(dir, "public/data/ledger");
    await mkdir(ledger, { recursive: true });
    await writeFile(path.join(ledger, "ledger-state.json"), JSON.stringify(okState()));
    const withoutOutcome = await cli("scripts/ledger-gate.mts", dir, [], { LEDGER_CAPTURE_OUTCOME: "success", LEDGER_VERIFY_OUTCOME: "success", LEDGER_PRECOMMIT_OUTCOME: "success" });
    expect(withoutOutcome.code).toBe(0); // the stale state alone looks healthy...
    const withOutcome = await cli("scripts/ledger-gate.mts", dir, [], { LEDGER_CAPTURE_OUTCOME: "failure", LEDGER_VERIFY_OUTCOME: "success", LEDGER_PRECOMMIT_OUTCOME: "success" });
    expect(withOutcome.code).toBe(1); // ...but the real outcome fails the gate
  });

  it("an unreadable ledger-state.json fails the gate", async () => {
    const dir = await sandbox("gate-bad-state");
    const ledger = path.join(dir, "public/data/ledger");
    await mkdir(ledger, { recursive: true });
    await writeFile(path.join(ledger, "ledger-state.json"), "{ nope");
    expect((await cli("scripts/ledger-gate.mts", dir, [], { LEDGER_CAPTURE_OUTCOME: "success", LEDGER_VERIFY_OUTCOME: "success", LEDGER_PRECOMMIT_OUTCOME: "success" })).code).toBe(1);
  });
});
