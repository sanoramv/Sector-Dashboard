/** A real git repository holding a captured session, its live receipt, a valid state and the protocol files. */
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runGuard, realGuardGit } from "../../scripts/ledger/guard.mts";
import { buildHoldoutFile, buildOd1File } from "../../scripts/ledger/protocol.mts";
import { emptyState, saveLedgerState } from "../../scripts/ledger/state.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { captureInto, receiptInto } from "./fixture";

export const ROOT = "public/data/ledger";
let n = 0;
export async function makeRepo(base: string, opts: { liveLate?: boolean; receipt?: boolean } = {}) {
  const dir = path.join(base, `h${n++}`);
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
  if (opts.receipt !== false) await receiptInto(path.join(dir, ROOT), cap.ruleVersion, !!opts.liveLate);
  await saveLedgerState(ledgerPaths(path.join(dir, ROOT)).state, emptyState("2026-11-01T00:00:00Z"));
  git("add", "-A");
  git("commit", "-qm", "init");
  const guard = () => runGuard(realGuardGit(dir), path.join(dir, ROOT));
  return { dir, git, w, guard, ruleVersion: cap.ruleVersion, root: path.join(dir, ROOT), p: ledgerPaths(path.join(dir, ROOT)), commit: (m: string) => { git("add", "-A"); git("commit", "-qm", m); } };
}
