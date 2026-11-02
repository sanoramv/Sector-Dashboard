/**
 * Final ledger gate decision. It combines the ACTUAL outcomes of the workflow steps with the recorded state, so a
 * crashed step can never hide behind a stale, successful ledger-state.json.
 */
import { R6_UNCOMPARED_WARN_RUNS, type LedgerState } from "./state.mts";

export type StepOutcome = "success" | "failure" | "cancelled" | "skipped" | "unknown";
export interface GateInput {
  state: LedgerState;
  /** valid, record-bound R6 review decisions (guard.mts loadValidR6Reviews) */
  r6Reviews?: { sessionDate: string; existingPredictionsSha256: string; candidatePredictionsSha256: string }[];
  captureOutcome: StepOutcome;
  verifyOutcome: StepOutcome;
  precommitOutcome: StepOutcome;
}
export interface GateResult {
  exitCode: 0 | 1;
  errors: string[];
  warnings: string[];
  info: string[];
}

export const parseOutcome = (v: string | undefined): StepOutcome => (v === "success" || v === "failure" || v === "cancelled" || v === "skipped" ? v : "unknown");

export function evaluateGate(i: GateInput): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];
  const steps: [string, StepOutcome][] = [["capture", i.captureOutcome], ["receipt verification", i.verifyOutcome], ["pre-commit validation", i.precommitOutcome]];
  for (const [name, o] of steps) {
    if (o === "failure" || o === "cancelled") errors.push(`Ledger ${name} step ${o === "failure" ? "failed" : "was cancelled"}; the recorded ledger state may be stale and must not be trusted.`);
    else if (o === "skipped") errors.push(`Ledger ${name} step did not run (an earlier step failed); no ledger result exists for this run.`);
    else if (o === "unknown") warnings.push(`Ledger ${name} step outcome was not supplied to the gate (only expected outside the workflow).`);
  }
  // An unresolved anomaly on any date can never be hidden by a clean run status.
  const anomalies = Object.entries(i.state.dates).filter(([, r]) => r.status === "anomaly");
  let allReviewed = anomalies.length > 0;
  for (const [d, r] of anomalies) {
    // An R6 anomaly is "reviewed" only if EVERY anomaly digest pair seen for the date has a record-bound review decision.
    // A review turns the gate amber; it never clears the anomaly, its evidence, or the session's exclusion from live results.
    const pairs = new Map<string, { existing: string | null; candidate: string | null }>();
    for (const e of r.r6Events ?? []) if (e.status === "anomaly") pairs.set(`${e.existingPredictionsSha256}|${e.candidatePredictionsSha256}`, { existing: e.existingPredictionsSha256, candidate: e.candidatePredictionsSha256 });
    if (r.r6?.status === "anomaly") pairs.set(`${r.r6.existingPredictionsSha256}|${r.r6.candidatePredictionsSha256}`, { existing: r.r6.existingPredictionsSha256, candidate: r.r6.candidatePredictionsSha256 });
    const bound = [...pairs.values()].length > 0 && [...pairs.values()].every((p) => p.existing && p.candidate && (i.r6Reviews ?? []).some((v) => v.sessionDate === d && v.existingPredictionsSha256 === p.existing && v.candidatePredictionsSha256 === p.candidate));
    const text = (r.r6?.detail ?? r.reasons[r.reasons.length - 1] ?? "see ledger-state.json").slice(0, 200);
    if (!bound) allReviewed = false;
    if (bound) warnings.push(`R6 anomaly on ${d} has been reviewed (a review decision is recorded). The anomaly and its evidence remain, and the session stays excluded from live results: ${text}`);
    else errors.push(`Unresolved anomaly on ${d}: ${text}`);
  }
  for (const [d, r] of Object.entries(i.state.dates)) {
    if (r.r6?.status === "existing-uncompared") {
      if (r.r6.reasonCode === "constituent-lists-refreshed") warnings.push(`R6 ${d}: the constituent lists changed since this record was made, so it cannot be compared with a fresh evaluation (not a successful comparison).`);
      else if ((r.r6.uncomparedRuns ?? 0) >= R6_UNCOMPARED_WARN_RUNS) warnings.push(`R6 ${d}: could not be compared for ${r.r6.uncomparedRuns} consecutive runs.`);
    }
  }
  const reasons = (i.state.lastFailure?.reasons ?? []).slice(0, 5).join(" | ");
  switch (i.state.runStatus) {
    case "anomaly":
      // The run status is "anomaly" for as long as an R6 anomaly persists. If every anomalous date has a record-bound
      // review decision it was already reported above as amber; do not report it a second time as red.
      if (allReviewed) warnings.push(`Ledger run status is anomaly only because of the reviewed anomalies above. ${reasons}`);
      else errors.push(`Ledger capture status ${i.state.runStatus}: ${reasons}`);
      break;
    case "blocked":
    case "error":
      errors.push(`Ledger capture status ${i.state.runStatus}: ${reasons}`);
      break;
    case "waiting":
    case "not-enabled":
      warnings.push(`Ledger capture status ${i.state.runStatus}. ${reasons}`);
      break;
    default:
      info.push(`Ledger capture status ${i.state.runStatus}; last successful session ${i.state.lastSuccessfulSessionDate ?? "none"}.`);
  }
  return { exitCode: errors.length ? 1 : 0, errors, warnings, info };
}
