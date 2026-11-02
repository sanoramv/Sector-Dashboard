/**
 * Final ledger gate: runs AFTER the market-data commit so a ledger fault never blocks data, but turns the run red.
 * It reads the real outcomes of the capture, verification and pre-commit steps (LEDGER_*_OUTCOME) as well as the state.
 */
import path from "node:path";
import { ledgerRootFrom, parseArgs, resolveRepoRoot } from "./ledger/run.mts";
import { ledgerPaths } from "./ledger/constants.mts";
import { loadLedgerState } from "./ledger/state.mts";
import { evaluateGate, parseOutcome } from "./ledger/gate.mts";
import { loadValidR6Reviews } from "./ledger/guard.mts";

const args = parseArgs(process.argv.slice(2));
const paths = ledgerPaths(path.resolve(resolveRepoRoot(args), ledgerRootFrom(args)));
let result;
try {
  const state = await loadLedgerState(paths.state, new Date().toISOString());
  result = evaluateGate({ state, r6Reviews: (await loadValidR6Reviews(path.resolve(resolveRepoRoot(args), ledgerRootFrom(args)))).valid, captureOutcome: parseOutcome(process.env.LEDGER_CAPTURE_OUTCOME), verifyOutcome: parseOutcome(process.env.LEDGER_VERIFY_OUTCOME), precommitOutcome: parseOutcome(process.env.LEDGER_PRECOMMIT_OUTCOME) });
} catch (err) {
  console.log(`::error::Ledger gate could not read ledger-state.json: ${String(err)}`);
  process.exit(1);
}
for (const m of result.info) console.log(m);
for (const m of result.warnings) console.log(`::warning::${m}`);
for (const m of result.errors) console.log(`::error::${m}`);
process.exit(result.exitCode);
