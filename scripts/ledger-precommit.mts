/**
 * Pre-commit ledger validation. Run by update-data.yml after capture/verify and BEFORE the data commit.
 * Exit 1 when pending ledger changes were rejected (they are restored to HEAD and an anomaly is recorded);
 * market-data files outside public/data/ledger are never touched.
 *
 * If this script cannot finish (a crash, or the restore itself fails) it exits non-zero WITHOUT announcing
 * "restored"; the workflow then runs a separate fail-safe restore and, failing that, keeps the ledger out of the commit.
 */
import { appendFileSync } from "node:fs";
import path from "node:path";
import { ledgerRootFrom, parseArgs, resolveRepoRoot, writeManifestSupplement } from "./ledger/run.mts";
import { precommit, realPrecommitGit } from "./ledger/precommit.mts";
import { realGuardGit } from "./ledger/guard.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
try {
  const result = await precommit(realPrecommitGit(repoRoot), repoRoot, ledgerRootFrom(args), new Date(), realGuardGit(repoRoot));
  if (result.ok) {
    console.log("ledger pre-commit validation passed.");
    process.exit(0);
  }
  for (const v of result.violations) console.log(`::error file=${v.path}::${v.kind}: ${v.detail}`);
  console.log("::error::Pending ledger changes were rejected and restored to HEAD; an anomaly was recorded in ledger-state.json.");
  if (result.state && args["no-manifest"] !== true) await writeManifestSupplement(path.join(repoRoot, "public/data/manifest.json"), result.state).catch(() => undefined);
  // Tell the workflow the rollback COMPLETED, so it does not repeat it and wipe the recorded anomaly.
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, "restored=true\n");
  process.exit(1);
} catch (err) {
  console.log(`::error::Ledger pre-commit validation could not finish: ${String(err)}. Nothing was announced as restored; the fail-safe step will act.`);
  process.exit(2);
}
