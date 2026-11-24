/**
 * Live OD1 outcome processing (continuous-monitoring policy, docs/design/EVALUATION_POLICY.md).
 *
 *   npm run ledger:outcomes        (run by update-data.yml after the capture; continue-on-error)
 *
 * Writes new create-only records under data/outcomes/ and rebuilds public/data/evaluation/<rule version>.json.
 * Never overwrites a record; exit 1 on a conflict or an internal error (the data update is unaffected).
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { realGuardGit } from "./ledger/guard.mts";
import { processOutcomes, readPolicy } from "./ledger/outcome-process.mts";
import { ledgerRootFrom, parseArgs, resolveRepoRoot } from "./ledger/run.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
process.chdir(repoRoot);
const ledgerRoot = ledgerRootFrom(args);
const policy = await readPolicy(ledgerRoot);
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
const r = await processOutcomes({
  repoRoot,
  ledgerRoot,
  dataDir: path.join(repoRoot, "public", "data"),
  storeRoot: path.join(repoRoot, "data", "outcomes"),
  summaryPath: path.join(repoRoot, "public", "data", "evaluation", `${policy.referenceRuleVersion}.json`),
  git: realGuardGit(repoRoot),
  commit,
  github: { runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, sha: process.env.GITHUB_SHA ?? null },
  now: new Date().toISOString(),
});
console.log(`ledger outcomes (${r.ruleVersion}): eligible ${r.eligible.join(", ") || "none"}; plan ${JSON.stringify(r.plan)}; created ${r.created.length}, existing ${r.existing.length}, blocked ${r.blocked.length}, conflicts ${r.conflicts.length}`);
for (const k of r.created) console.log(`  created ${k}`);
for (const b of r.blocked) console.log(`::warning::${b.key} blocked (${b.code}); retried next run, never fabricated`);
for (const k of r.conflicts) console.log(`::error::${k}: a different record is already stored; nothing was overwritten (owner review)`);
console.log(`summary ${path.relative(repoRoot, r.summaryPath)}`);
process.exit(r.conflicts.length ? 1 : 0);
