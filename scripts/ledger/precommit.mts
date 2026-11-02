/**
 * Pre-commit fail-closed validation (design section 11.1). Looks ONLY at pending changes under the ledger directory.
 * Allowed: new daily files, new receipts, changes to ledger-state.json. Everything else is a violation.
 * On failure the pending ledger changes (and only those) are restored to HEAD and an anomaly is recorded in the state.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { ledgerPaths } from "./constants.mts";
import { validateDailyFile, validateReceiptFile, validateStateFile, validateVersionRecords, type GuardGit, type Violation } from "./guard.mts";
import { emptyState, loadLedgerState, saveLedgerState, type LedgerState } from "./state.mts";

const run = promisify(execFile);

/** The only directory this module may ever restore or clean. */
export const SAFE_LEDGER_ROOT = "public/data/ledger";

/** Throws unless `rootRel` is the ledger directory itself or strictly inside it (so `.`, `..`, `public/data` or an absolute path can never be cleaned). */
export function assertSafeLedgerRoot(repoRoot: string, rootRel: string): void {
  if (typeof rootRel !== "string" || rootRel.trim() === "" || path.isAbsolute(rootRel)) throw new Error(`unsafe ledger root ${JSON.stringify(rootRel)}: it must be a relative path inside ${SAFE_LEDGER_ROOT}`);
  const abs = path.resolve(repoRoot, rootRel);
  const safe = path.resolve(repoRoot, SAFE_LEDGER_ROOT);
  if (abs !== safe && !abs.startsWith(safe + path.sep)) throw new Error(`unsafe ledger root ${JSON.stringify(rootRel)}: it must be ${SAFE_LEDGER_ROOT} or a directory inside it`);
}

export interface PendingChange {
  /** git status XY code, trimmed: "??" untracked, "A" added, "M" modified, "D" deleted, "R" renamed, "T" type change */
  code: string;
  path: string;
}

export interface PrecommitGit {
  pending(ledgerRoot: string): Promise<PendingChange[]>;
  /** Restores tracked files under `ledgerRoot` to HEAD and removes everything else (untracked, ignored) under it. */
  restore(ledgerRoot: string): Promise<void>;
}

export function realPrecommitGit(cwd: string): PrecommitGit {
  const git = (args: string[]) => run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return {
    async pending(root) {
      const { stdout } = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching", "--", root]);
      const parts = stdout.split("\0").filter(Boolean);
      const out: PendingChange[] = [];
      for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        const xy = entry.slice(0, 2);
        const file = entry.slice(3);
        if (xy === "!!" || xy === "??") out.push({ code: xy, path: file });
        else if (xy.includes("R") || xy.includes("C")) {
          out.push({ code: "R", path: file });
          i++; // the original name follows
        } else out.push({ code: xy.replace(/\s/g, "")[0] ?? "?", path: file });
      }
      return out;
    },
    async restore(root) {
      assertSafeLedgerRoot(cwd, root);
      try {
        await git(["restore", "--source=HEAD", "--staged", "--worktree", "--", root]);
      } catch {
        /* HEAD has no tracked file under the ledger root yet: only cleaning is needed */
      }
      await git(["clean", "-fdx", "--", root]);
    },
  };
}

const rel = (p: string) => p.split(path.sep).join("/");

/** Pure classification + content validation of the pending changes. */
export async function validatePending(git: PrecommitGit, repoRoot: string, ledgerRootRel: string, guardGit?: GuardGit): Promise<Violation[]> {
  assertSafeLedgerRoot(repoRoot, ledgerRootRel);
  const root = rel(ledgerRootRel);
  const paths = ledgerPaths(root);
  const v: Violation[] = [];
  const changes = await git.pending(root);
  let versionsChecked = false;
  for (const c of changes) {
    const p = rel(c.path);
    const abs = path.join(repoRoot, p);
    if (p.endsWith(".partial")) {
      v.push({ kind: "partial", path: p, detail: "an interrupted partial file is present" });
      continue;
    }
    if (c.code === "!!") continue; // other ignored files are not committed
    const isNew = c.code === "??" || c.code === "A";
    if (p === paths.state) {
      if (c.code === "D" || c.code === "R" || c.code === "T") v.push({ kind: "state", path: p, detail: "ledger-state.json may be changed but not deleted, renamed or retyped" });
      else v.push(...(await validateStateFile(abs)));
      continue;
    }
    const isDaily = new RegExp(`^${root}/live/predictions/[^/]+/\\d{4}-\\d{2}-\\d{2}\\.json$`).test(p);
    const isReceipt = new RegExp(`^${root}/live/receipts/\\d{4}-\\d{2}-\\d{2}\\.json$`).test(p);
    if (!isNew) {
      v.push({ kind: "history", path: p, detail: `status ${c.code}: an existing ledger file would be modified, deleted, renamed or retyped; protected records may only be added` });
      continue;
    }
    if (isDaily) {
      v.push(...(await validateDailyFile(abs)));
      if (!versionsChecked && guardGit) {
        // A new prediction is only acceptable if the record that enabled its rule version is valid and not backdated.
        versionsChecked = true;
        v.push(...(await validateVersionRecords(guardGit, path.join(repoRoot, root))));
      }
    }
    else if (isReceipt) v.push(...(await validateReceiptFile(abs, path.join(repoRoot, root))));
    else v.push({ kind: "file", path: p, detail: "the data workflow may not create this file (only daily predictions, receipts and ledger-state.json)" });
  }
  return v;
}

export interface PrecommitResult {
  ok: boolean;
  violations: Violation[];
  restored: boolean;
  state?: LedgerState;
}

/** Validates; on any violation restores the ledger directory and records an anomaly. */
export async function precommit(git: PrecommitGit, repoRoot: string, ledgerRootRel: string, now = new Date(), guardGit?: GuardGit): Promise<PrecommitResult> {
  assertSafeLedgerRoot(repoRoot, ledgerRootRel);
  const violations = await validatePending(git, repoRoot, ledgerRootRel, guardGit);
  if (violations.length === 0) return { ok: true, violations, restored: false };
  await git.restore(ledgerRootRel);
  const file = ledgerPaths(path.join(repoRoot, ledgerRootRel)).state;
  let state: LedgerState;
  try {
    state = await loadLedgerState(file, now.toISOString());
  } catch {
    state = emptyState(now.toISOString());
  }
  const reasons = violations.slice(0, 20).map((x) => `${x.kind} ${x.path}: ${x.detail}`);
  state.runStatus = "anomaly";
  state.lastFailure = { at: now.toISOString(), date: null, reasons: [`Pre-commit validation rejected the pending ledger changes, which were discarded: ${reasons.length} problem(s)`, ...reasons].slice(0, 20) };
  state.updatedAt = now.toISOString();
  await saveLedgerState(file, state);
  return { ok: false, violations, restored: true, state };
}
