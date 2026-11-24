/**
 * EXPERIMENTAL shadow predictions (docs/research/SHADOW_PREDICTIONS.md): capture, then derived evaluation.
 *
 *   npm run shadow            (update-data.yml, after the mv1 capture and outcomes; continue-on-error)
 *   npm run shadow -- --evaluate-only
 *
 * Writes only public/data/shadow/<versionId>/<date>.json (create-only) and public/data/evaluation/shadow-summary.json.
 * Does nothing until public/data/shadow/activation.json exists (owner approval). Exit 1 on a conflict or an error;
 * the market-data update and the mv1 capture are never affected.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { realGuardGit } from "./ledger/guard.mts";
import { ledgerRootFrom, parseArgs, resolveRepoRoot } from "./ledger/run.mts";
import { runShadowCapture } from "./shadow/capture.mts";
import { evaluateShadow } from "./shadow/evaluate.mts";
import { readJsonIfExists } from "./ledger/files.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
process.chdir(repoRoot);
const ledgerRoot = ledgerRootFrom(args);
const dataDir = path.join(repoRoot, "public", "data");
const shadowRoot = path.join(dataDir, "shadow");
const github = { runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null, sha: process.env.GITHUB_SHA ?? null };
let failed = false;

if (!args["evaluate-only"]) {
  const r = await runShadowCapture({ repoRoot, dataDir, ledgerRoot, shadowRoot, now: new Date(), github });
  console.log(`shadow capture: ${r.status} (${r.detail})`);
  for (const s of r.sessions) {
    console.log(`  ${s.date} ${s.outcome}: ${s.detail}${s.files ? " | " + s.files.map((f) => `${f.versionId} ${f.result} (${f.count})`).join(", ") : ""}`);
    if (s.outcome === "conflict" || s.outcome === "blocked") {
      console.log(`::warning::shadow ${s.date} ${s.outcome}: ${s.detail}`);
      failed ||= s.outcome === "conflict";
    }
  }
}

if ((await readJsonIfExists(path.join(shadowRoot, "activation.json"))) !== null) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf-8" }).trim();
  const s = await evaluateShadow({ repoRoot, ledgerRoot, dataDir, shadowRoot, storeRoot: path.join(repoRoot, "data", "outcomes"), summaryPath: path.join(dataDir, "evaluation", "shadow-summary.json"), git: realGuardGit(repoRoot), commit, now: new Date().toISOString() });
  for (const v of s.variants) {
    console.log(`shadow evaluation ${v.versionId}: ${v.sessions.eligible} eligible of ${v.sessions.files} session file(s); checkpoint ${v.checkpoint.reached ?? "none"} (next ${v.checkpoint.next})`);
    if (v.crossCheck.count) {
      console.log(`::error::${v.versionId}: ${v.crossCheck.count} mv1 outcome(s) recomputed differently from the stored records`);
      failed = true;
    }
  }
} else console.log("shadow evaluation: not activated; nothing written");

process.exit(failed ? 1 : 0);
