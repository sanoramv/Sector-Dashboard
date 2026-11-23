/**
 * Cross-repository outcome pipeline (Phase B2a, LOCAL simulation only). Order of operations for every due horizon:
 *
 *   1. private storage must be reachable (listKeys) — otherwise nothing is computed (fail closed);
 *   2. reconcile: every public receipt must have its private record and commit to it exactly; a stored record without
 *      a receipt gets its receipt published from the STORED record (idempotent recovery); a receipt without a record
 *      or with a different commitment is reported and NEVER repaired;
 *   3. build the record (pure runner) -> create-only write to private storage -> read back and verify;
 *   4. only then publish the hash-only receipt, built from the stored record (byte-identical on every retry).
 *
 * The report and the alerts carry storage keys, counts of public plan statuses and fixed codes only — never a class,
 * return, flag, availability count, salt or outcome hash. Nothing here creates or applies corrections.
 */
import { sha256Canonical } from "./canonical.mts";
import type { OutcomeRecord } from "./outcomes.mts";
import { RunnerBlock, SYNTHETIC_ONLY, assertSyntheticSession, buildDueRecord, planOutcomes, type PlanStatus, type RunnerContext, type RunnerMarket, type RunnerSession } from "./outcome-runner.mts";
import { OUTCOME_RECEIPTS_DIR, outcomeReceiptRel, receiptForStoredRecord, receiptLeakProblems, receiptText, type PublicReceiptSink } from "./outcome-receipts.mts";
import { parseStorageKey, type PrivateStore } from "./private-store.mts";

export const PUBLIC_REPOSITORY = "sanoramv/Sector-Dashboard";

/**
 * Execution-context TRIPWIRE (defense in depth, NOT authentication): environment variables can be set by anyone who
 * runs the code, so this only catches accidental invocation. The real boundary is that no governed artifact can be
 * built for a real date (SYNTHETIC_ONLY), no workflow or CLI calls the pipeline, no activation record exists and the
 * public repository holds no credential for private storage (see docs/design/OD1_PRIVATE_PIPELINE.md §1a).
 *
 * The declared context must be the private outcome repository, and the public repository may never be named, whether
 * or not GITHUB_ACTIONS is set.
 */
export function assertProtectedExecutionContext(env: Record<string, string | undefined>): void {
  if (env.OD1_PROTECTED_CONTEXT !== "private-outcome-repository") throw new Error("protected OD1 outcomes may only be computed in the private outcome repository (OD1_PROTECTED_CONTEXT is not set)");
  const repo = (env.GITHUB_REPOSITORY ?? "").trim().toLowerCase();
  if (repo === PUBLIC_REPOSITORY.toLowerCase()) throw new Error("protected OD1 outcomes are never computed in the public repository");
  if (env.GITHUB_ACTIONS !== undefined && env.GITHUB_ACTIONS !== "") {
    if (!repo) throw new Error("GitHub Actions without GITHUB_REPOSITORY: refusing to compute protected outcomes");
  }
}

/**
 * The environment the context check uses. While SYNTHETIC_ONLY (tests), a caller-injected environment is allowed so the
 * check itself can be tested. Once real dates are allowed (B2b), an injected environment is IGNORED and the real
 * process environment is checked, so a caller cannot pass a forged one.
 */
export function effectiveEnv(injected: Record<string, string | undefined>, syntheticOnly: boolean = SYNTHETIC_ONLY): Record<string, string | undefined> {
  return syntheticOnly ? injected : process.env;
}

export type AlertCode =
  | "private-storage-unavailable"
  | "record-conflict"
  | "record-verify-mismatch"
  | "missing-private-evidence"
  | "receipt-mismatch"
  | "receipt-conflict"
  | "receipt-publish-error"
  | "receipt-confidentiality"
  | "blocked-stock-absent"
  | "blocked-prediction-day-missing"
  | "blocked-source-revised"
  | "blocked-benchmark-missing";

/** Fixed, outcome-free explanations used for GitHub issues. */
export const ALERT_TEXT: Record<AlertCode, string> = {
  "private-storage-unavailable": "Private outcome storage could not be reached; nothing was computed or published. The run will retry.",
  "record-conflict": "A different outcome record already exists for this key. Nothing was overwritten; owner review is needed.",
  "record-verify-mismatch": "The private record could not be read back identically after writing; no receipt was published.",
  "missing-private-evidence": "A public outcome receipt has no private record. Nothing was repaired; owner review is needed.",
  "receipt-mismatch": "A public outcome receipt does not commit to the stored private record. Nothing was repaired; owner review is needed.",
  "receipt-conflict": "A different public receipt already exists for this key. Nothing was overwritten; owner review is needed.",
  "receipt-publish-error": "The private record is stored but its public receipt could not be published; the next run retries.",
  "receipt-confidentiality": "A receipt did not pass the confidentiality check and was not published.",
  "blocked-stock-absent": "A predicted stock is absent from the market data; the horizon is blocked pending owner review.",
  "blocked-prediction-day-missing": "A prediction-day bar is missing from the market data; the horizon is blocked pending owner review.",
  "blocked-source-revised": "The market data no longer matches the frozen prediction record (source revision); use the correction procedure.",
  "blocked-benchmark-missing": "The NIFTY 500 close needed for the window is missing; the horizon is blocked.",
};

export interface Alert {
  code: AlertCode;
  /** storage key `od1/<rule version>/<date>/h<h>` (or "*" for the store) */
  key: string;
}

export interface RunReport {
  ok: boolean;
  /** counts of PUBLIC plan statuses (calendar, eligibility, activation) */
  plan: Partial<Record<PlanStatus, number>>;
  recordsCreated: string[];
  recordsExisting: string[];
  receiptsPublished: string[];
  receiptsExisting: string[];
  recovered: string[];
  alerts: Alert[];
}

export interface PipelineDeps {
  store: PrivateStore;
  sink: PublicReceiptSink;
  env: Record<string, string | undefined>;
}

/** Plain-text issue body: keys and fixed explanations only. */
export function alertIssueText(alerts: Alert[]): string {
  return ["OD1 outcome pipeline: operational alert (no outcome information is included).", "", ...alerts.map((a) => `- ${a.key} - ${a.code}: ${ALERT_TEXT[a.code]}`)].join("\n");
}

const keyFromReceiptRel = (rel: string): string | null => {
  const m = rel.match(/^live\/outcome-receipts\/([^/]+)\/(\d{4}-\d{2}-\d{2})\/h(\d+)\.json$/);
  return m ? `od1/${m[1]}/${m[2]}/h${m[3]}` : null;
};

/** Publishes the receipt of a STORED record (create-only, confidentiality-checked). */
async function publishFor(record: OutcomeRecord, key: string, sink: PublicReceiptSink, report: RunReport): Promise<void> {
  const receipt = receiptForStoredRecord(record);
  const leaks = receiptLeakProblems(receipt, record);
  if (leaks.length) {
    report.alerts.push({ code: "receipt-confidentiality", key });
    return;
  }
  const h = record.header;
  const rel = outcomeReceiptRel(h.ruleVersion, h.sessionDate, h.horizon);
  let res;
  try {
    res = await sink.put(rel, receiptText(receipt));
  } catch {
    report.alerts.push({ code: "receipt-publish-error", key });
    return;
  }
  if (res === "created") report.receiptsPublished.push(key);
  else if (res === "existing") report.receiptsExisting.push(key);
  else report.alerts.push({ code: "receipt-conflict", key });
}

/** Step 2: receipts <-> records. Never repairs conflicting evidence. */
export async function reconcile(store: PrivateStore, sink: PublicReceiptSink, keys: string[], report: RunReport): Promise<void> {
  const receiptRels = (await sink.list()).filter((r) => r.startsWith(`${OUTCOME_RECEIPTS_DIR}/`));
  const withReceipt = new Set<string>();
  for (const rel of receiptRels) {
    const key = keyFromReceiptRel(rel);
    if (!key) continue; // correction receipts are checked by the guard's chain validation
    withReceipt.add(key);
    const record = await store.getRecord(key);
    if (!record) {
      report.alerts.push({ code: "missing-private-evidence", key });
      continue;
    }
    const want = receiptForStoredRecord(record);
    if (sha256Canonical(await sink.get(rel)) !== sha256Canonical(want)) report.alerts.push({ code: "receipt-mismatch", key });
  }
  for (const key of keys)
    if (!withReceipt.has(key)) {
      const record = await store.getRecord(key);
      if (record) {
        await publishFor(record, key, sink, report);
        if (report.receiptsPublished.includes(key)) report.recovered.push(key);
      }
    }
}

/** One pipeline run. Idempotent: any number of repeated or concurrent runs converge on the same records and receipts. */
export async function runOutcomePipeline(sessions: RunnerSession[], market: RunnerMarket, ctx: Omit<RunnerContext, "stored">, deps: PipelineDeps): Promise<RunReport> {
  assertProtectedExecutionContext(effectiveEnv(deps.env));
  for (const s of sessions) assertSyntheticSession(s.daily.header.sessionDate);
  const report: RunReport = { ok: true, plan: {}, recordsCreated: [], recordsExisting: [], receiptsPublished: [], receiptsExisting: [], recovered: [], alerts: [] };
  const finish = () => ((report.ok = report.alerts.length === 0), report);
  let keys: string[];
  try {
    keys = await deps.store.listKeys();
  } catch {
    report.alerts.push({ code: "private-storage-unavailable", key: "*" });
    return finish();
  }
  try {
    await reconcile(deps.store, deps.sink, keys, report);
  } catch {
    report.alerts.push({ code: "private-storage-unavailable", key: "*" });
    return finish();
  }
  // Conflicting evidence between the repositories stops the run: nothing new is computed until the owner has reviewed it.
  if (report.alerts.some((a) => a.code === "missing-private-evidence" || a.code === "receipt-mismatch")) return finish();
  const plan = planOutcomes(sessions, market, { ...ctx, stored: new Set(keys) });
  for (const p of plan) report.plan[p.status] = (report.plan[p.status] ?? 0) + 1;
  const bySession = new Map(sessions.map((s) => [s.daily.header.sessionDate, s]));
  for (const item of plan.filter((p) => p.status === "due")) {
    parseStorageKey(item.key);
    let record: OutcomeRecord;
    try {
      record = buildDueRecord(item, bySession.get(item.sessionDate)!, market, { ...ctx, stored: new Set(keys) });
    } catch (err) {
      if (err instanceof RunnerBlock) {
        report.alerts.push({ code: `blocked-${err.code}` as AlertCode, key: item.key });
        continue;
      }
      throw err;
    }
    let stored: OutcomeRecord;
    try {
      const put = await deps.store.putRecord(record);
      if (put.result === "conflict") {
        report.alerts.push({ code: "record-conflict", key: item.key });
        continue;
      }
      (put.result === "created" ? report.recordsCreated : report.recordsExisting).push(item.key);
      stored = put.stored;
      const back = await deps.store.getRecord(item.key);
      if (!back || sha256Canonical(back) !== sha256Canonical(stored)) {
        report.alerts.push({ code: "record-verify-mismatch", key: item.key });
        continue;
      }
    } catch {
      report.alerts.push({ code: "private-storage-unavailable", key: item.key });
      return finish(); // stop: never publish anything whose private copy is not confirmed
    }
    await publishFor(stored, item.key, deps.sink, report);
  }
  return finish();
}
