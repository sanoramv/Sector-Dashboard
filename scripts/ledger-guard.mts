/**
 * Independent read-only guard (design section 12.2). Writes nothing.
 * Exit 1 on any UNACKNOWLEDGED violation. A violation with a valid, hash-bound acknowledgement is reported explicitly
 * (never silently green) and does not fail the run, but its session stays excluded from the live holdout.
 */
import { realGuardGit, runGuard } from "./ledger/guard.mts";
import { ledgerRootFrom, parseArgs, resolveRepoRoot } from "./ledger/run.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
process.chdir(repoRoot);
const r = await runGuard(realGuardGit(repoRoot), ledgerRootFrom(args));
console.log(`ledger guard: ${r.violations.length} violation(s); ${r.acknowledged.length} acknowledged historical violation(s); ${r.historyAcknowledgements.length} historical acknowledgement(s); ${r.sourceRevisionAcceptances.length} source-revision acceptance(s)`);
for (const v of r.violations) console.log(`::error file=${v.path}::${v.kind}${v.commit ? ` @ ${v.commit.slice(0, 10)}` : ""}: ${v.detail}`);
for (const v of r.acknowledged) console.log(`::warning file=${v.path}::ACKNOWLEDGED history violation @ ${v.commit?.slice(0, 10)}: ${v.detail}`);
console.log(`live-holdout eligibility: ${r.holdout.eligible.length} eligible session(s); ${r.holdout.excluded.length} excluded; ${r.r6Reviews.length} R6 review decision(s)`);
for (const s of r.holdout.excluded) console.log(`::notice::excluded from the live holdout: ${s.date} (${s.ruleVersion}) - ${s.reasons.join("; ")}`);
if (r.excludedSessions.length) console.log(`::warning::Sessions excluded from the live holdout because an immutable record of theirs was changed: ${r.excludedSessions.join(", ")}`);
process.exit(r.violations.length ? 1 : 0);
