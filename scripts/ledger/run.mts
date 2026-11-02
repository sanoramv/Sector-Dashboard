/** Shared helpers for the ledger CLIs: argument parsing, state updates from a capture run, run-status derivation. */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_LEDGER_ROOT } from "./constants.mts";
import type { CaptureRunResult } from "./capture.mts";
import { earliestCutoffIso, type VerifyOutcome } from "./receipt.mts";
import { R6_UNCOMPARED_WARN_RUNS, appendR6Event, appendReasons, applyPublication, strongerStatus, type DateRecord, type DateRecordStatus, type LedgerState, type R6Record, type RunStatus } from "./state.mts";
import type { LedgerSupplement } from "../../src/lib/ledger/manifestSupplement.ts";
import { replaceAtomic } from "./files.mts";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  return out;
}

export const ledgerRootFrom = (args: Record<string, string | boolean>) => (typeof args["ledger-root"] === "string" ? (args["ledger-root"] as string) : DEFAULT_LEDGER_ROOT);

/** Folds one capture run into the mutable state. Never touches a prediction record. */
export function applyCaptureToState(state: LedgerState, run: CaptureRunResult, ctx: { now: string; slot: string | null; ruleVersion: string; enabledVersion: string | null; enabledFrom: string | null; startedAt: string; captureSeconds: number }): RunStatus {
  state.lastAttemptAt = ctx.startedAt;
  state.ruleVersion = ctx.ruleVersion;
  state.enabledVersion = ctx.enabledVersion;
  state.enabledFrom = ctx.enabledFrom;
  const failures: string[] = [];
  let status = "idle" as RunStatus;
  const rank: Record<RunStatus, number> = { idle: 0, ok: 1, "not-enabled": 2, waiting: 3, blocked: 4, anomaly: 5, error: 6 };
  const bump = (s: RunStatus) => {
    if (rank[s] > rank[status]) status = s;
  };
  for (const s of run.sessions) {
    if (s.outcome === "not-enabled") {
      bump("not-enabled");
      continue;
    }
    const prev = state.dates[s.date];
    const base = { sourceDataDate: s.date, updatedAt: ctx.now, earliestCutoffUtc: earliestCutoffIso(s.date) };
    const flags = s.checks.filter((c) => c.disposition === "flag" && c.id === "R11").length > 0;
    // R6 evidence: `r6` is the latest result; earlier evidence is preserved in the append-only `r6Events`.
    let r6: R6Record | undefined;
    let r6Events = prev?.r6Events;
    if (s.r6) {
      const p6 = prev?.r6;
      r6 = { status: s.r6.status, checkedAt: ctx.now, existingPredictionsSha256: s.r6.existingPredictionsSha256, candidatePredictionsSha256: s.r6.candidatePredictionsSha256, detail: s.r6.detail, ...(s.r6.reasonCode ? { reasonCode: s.r6.reasonCode } : {}), ...(s.r6.universe ? { universe: s.r6.universe } : {}) };
      const firstAnomalyAt = p6?.firstAnomalyAt ?? (r6.status === "anomaly" ? ctx.now : undefined);
      if (firstAnomalyAt) r6.firstAnomalyAt = firstAnomalyAt;
      if (r6.status === "existing-uncompared") {
        r6.uncomparedRuns = (p6?.status === "existing-uncompared" ? (p6.uncomparedRuns ?? 1) : 0) + 1;
        r6.firstUncomparedAt = p6?.status === "existing-uncompared" ? (p6.firstUncomparedAt ?? ctx.now) : ctx.now;
      } else if (p6?.firstUncomparedAt) r6.firstUncomparedAt = p6.firstUncomparedAt;
      if (p6?.status === "anomaly" && r6.status !== "anomaly") {
        // An earlier anomaly is not replaced by a weaker or clean-looking result; the new result is an observation.
        r6 = { ...p6, checkedAt: ctx.now, latestObservation: { at: ctx.now, status: r6.status, ...(r6.reasonCode ? { reasonCode: r6.reasonCode } : {}), detail: r6.detail } };
        r6Events = appendR6Event(r6Events, { at: ctx.now, status: s.r6.status, ...(s.r6.reasonCode ? { reasonCode: s.r6.reasonCode } : {}), existingPredictionsSha256: s.r6.existingPredictionsSha256, candidatePredictionsSha256: s.r6.candidatePredictionsSha256, detail: s.r6.detail });
      } else if (r6.status !== "pass") r6Events = appendR6Event(r6Events, { at: ctx.now, status: r6.status, ...(r6.reasonCode ? { reasonCode: r6.reasonCode } : {}), existingPredictionsSha256: r6.existingPredictionsSha256, candidatePredictionsSha256: r6.candidatePredictionsSha256, detail: r6.detail });
    }
    const withR6 = <T extends object>(rec: T): T & { r6?: R6Record; r6Events?: DateRecord["r6Events"] } => ({ ...rec, ...(r6 ? { r6 } : {}), ...(r6Events ? { r6Events } : {}) });
    if (s.outcome === "recorded") {
      const rec: DateRecord = { status: flags ? "review-required" : "recorded", reasons: s.warnings, generatedAt: ctx.now, publicationClass: "pending", cutoffUtc: null, readiness: s.checks.map((c) => ({ id: c.id, status: c.status, disposition: c.disposition })), ...(r6 ? { r6 } : {}), ...base };
      state.dates[s.date] = rec;
      state.lastSuccessfulCaptureAt = ctx.now;
      if (!state.lastSuccessfulSessionDate || s.date > state.lastSuccessfulSessionDate) state.lastSuccessfulSessionDate = s.date;
      state.recoveryRequired = state.recoveryRequired.filter((d) => d !== s.date);
      bump("ok");
    } else if (s.outcome === "exists") {
      // A duplicate attempt is NOT a new capture: it records its R6 evidence and changes nothing else.
      if (!prev) state.dates[s.date] = withR6({ status: "recorded" as DateRecordStatus, reasons: [] as string[], generatedAt: null, publicationClass: "pending" as const, cutoffUtc: null, ...base });
      else if (r6) {
        const note = r6.status === "existing-uncompared" && r6.reasonCode === "inputs-not-ready" && (r6.uncomparedRuns ?? 0) >= R6_UNCOMPARED_WARN_RUNS ? [`R6: could not compare for ${r6.uncomparedRuns} consecutive runs (since ${r6.firstUncomparedAt}); the record has not been verified against a fresh evaluation`] : [];
        state.dates[s.date] = withR6({ ...prev, reasons: appendReasons(prev.reasons, note), updatedAt: ctx.now });
      }
      bump("ok");
    } else if (s.outcome === "anomaly" && s.file) {
      // Anomaly against an existing (immutable) record: raise the status, keep publication fields, append the evidence.
      const cur: DateRecord = prev ?? { status: "recorded", reasons: [], generatedAt: null, publicationClass: null, cutoffUtc: null, ...base };
      state.dates[s.date] = withR6({ ...cur, status: strongerStatus(cur.status, "anomaly"), reasons: appendReasons(cur.reasons, s.reasons), updatedAt: ctx.now });
      failures.push(...s.reasons);
      bump("anomaly");
    } else {
      const st = s.outcome === "anomaly" ? "anomaly" : s.outcome === "blocked" ? "blocked" : "waiting";
      state.dates[s.date] = { status: st, reasons: s.reasons, generatedAt: null, publicationClass: null, cutoffUtc: null, readiness: s.checks.map((c) => ({ id: c.id, status: c.status, disposition: c.disposition })), ...base };
      if (!state.recoveryRequired.includes(s.date)) state.recoveryRequired.push(s.date);
      failures.push(...s.reasons);
      bump(s.outcome === "anomaly" ? "anomaly" : s.outcome === "blocked" ? "blocked" : "waiting");
    }
  }
  // R10: flag past sessions whose stored source digests no longer match. Never rewrites their records.
  for (const r of run.r10Sessions.filter((x) => !x.ok)) {
    const rec = state.dates[r.date] ?? { status: "recorded" as DateRecordStatus, reasons: [], generatedAt: null, publicationClass: null, cutoffUtc: null, earliestCutoffUtc: earliestCutoffIso(r.date), sourceDataDate: r.date, updatedAt: ctx.now };
    state.dates[r.date] = { ...rec, status: strongerStatus(rec.status, "source-revised"), reasons: appendReasons(rec.reasons, [`Source rows changed after capture: ${[...r.changedSymbols, ...r.changedIndices].slice(0, 20).join(", ")}`]), updatedAt: ctx.now };
  }
  // An unresolved anomaly on ANY date keeps the run from reporting a clean success, whatever this run's own sessions did.
  const unresolved = Object.entries(state.dates).filter(([, r]) => r.status === "anomaly").map(([d]) => d);
  if (unresolved.length) {
    bump("anomaly");
    const msg = `Unresolved anomaly on ${unresolved.join(", ")}: the immutable record was left untouched; see dates.<date>.r6Events in ledger-state.json`;
    if (!failures.includes(msg)) failures.push(msg);
  }
  if (failures.length) state.lastFailure = { at: ctx.now, date: run.sessions.find((s) => ["blocked", "anomaly", "waiting"].includes(s.outcome))?.date ?? null, reasons: failures.slice(0, 20) };
  if ((status as RunStatus) === "ok") state.recoveryRequired = state.recoveryRequired.filter((d) => state.dates[d]?.status === "waiting" || state.dates[d]?.status === "blocked");
  state.runStatus = status;
  state.updatedAt = ctx.now;
  state.runs = [{ startedAt: ctx.startedAt, slot: ctx.slot, status }, ...state.runs].slice(0, 20);
  state.metrics.captureSeconds = ctx.captureSeconds;
  return status;
}

/** Folds receipt verification results into the mutable state using the ACTUAL classes; never downgrades a stronger status. */
export function applyVerificationToState(state: LedgerState, outcomes: VerifyOutcome[], now: string): void {
  for (const o of outcomes) {
    const rec = state.dates[o.date];
    if (!rec) continue;
    state.dates[o.date] = applyPublication(rec, o.class, o.reasons, now, o.result === "receipt-exists" || o.result === "receipt-written" ? "receipt" : "evidence");
    if (o.result === "receipt-invalid") state.dates[o.date].status = strongerStatus(state.dates[o.date].status, "anomaly");
  }
  for (const [d, rec] of Object.entries(state.dates)) {
    if (rec.publicationClass === "pending" || rec.publicationClass === "unverified") {
      if (!state.recoveryRequired.includes(d)) state.recoveryRequired.push(d);
    } else state.recoveryRequired = state.recoveryRequired.filter((x) => x !== d);
  }
}

/** Summary written to manifest.json -> supplements.ledger from the mutable state (counts use the ACTUAL receipt classes). */
export function ledgerSupplementFrom(state: LedgerState): LedgerSupplement {
  const dates = Object.values(state.dates);
  return {
    status: state.runStatus,
    lastSuccessfulSessionDate: state.lastSuccessfulSessionDate,
    lastAttemptAt: state.lastAttemptAt,
    recoveryRequired: state.recoveryRequired.length,
    capturedSessions: dates.filter((d) => ["recorded", "review-required", "recorded-late", "unverified", "source-revised"].includes(d.status)).length,
    liveReceipts: dates.filter((d) => d.publicationClass === "live").length,
    liveLateReceipts: dates.filter((d) => d.publicationClass === "live-late").length,
    updatedAt: state.updatedAt,
  };
}

/** Additive manifest supplement; never touches `refresh`. */
export async function writeManifestSupplement(manifestFile: string, state: LedgerState): Promise<void> {
  const manifest = JSON.parse(await readFile(manifestFile, "utf-8"));
  manifest.supplements = { ...(manifest.supplements ?? {}), ledger: ledgerSupplementFrom(state) };
  await replaceAtomic(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
}

export const fileExists = (p: string) => stat(p).then(() => true, () => false);
export const resolveRepoRoot = (args: Record<string, string | boolean>) => path.resolve(typeof args["repo-root"] === "string" ? (args["repo-root"] as string) : ".");
