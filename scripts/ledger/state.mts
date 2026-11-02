/** ledger-state.json: the MUTABLE operational record. It never contains or replaces a prediction. */
import { STATE_KIND, LEDGER_SCHEMA_VERSION } from "./constants.mts";
import { readJsonIfExists, replaceAtomic } from "./files.mts";

export type DateRecordStatus = "waiting" | "blocked" | "recorded" | "review-required" | "recorded-late" | "unverified" | "source-revised" | "missed" | "anomaly";
export type PublicationClass = "live" | "live-late" | "unverified" | "pending";
export type RunStatus = "ok" | "idle" | "not-enabled" | "waiting" | "blocked" | "anomaly" | "error";

/** Why an existing record could not be compared with a fresh evaluation. */
export type R6ReasonCode = "constituent-lists-refreshed" | "inputs-not-ready";

export interface R6UniverseEvidence {
  /** list identity stored in the immutable record: slug, symbol count, content hash, fetch time */
  stored: { slug: string; count: number; sha256: string; symbolsSha256?: string; fetchedAt: string | null }[];
  /** the same, computed from the lists now */
  current: { slug: string; count: number; sha256: string; symbolsSha256?: string; fetchedAt: string | null }[];
  /** lists whose prediction-relevant content (symbol, company name, industry) differs */
  changedLists: string[];
  /** the subset of `changedLists` whose set of symbols differs (the rest changed only company name / industry) */
  symbolSetChangedLists: string[];
  fetchedAtChanged: boolean;
}

/** R6 evidence kept in the MUTABLE state; the immutable daily record is never touched. `r6` is the LATEST result. */
export interface R6Record {
  status: "pass" | "existing" | "existing-uncompared" | "anomaly";
  checkedAt: string;
  existingPredictionsSha256: string | null;
  candidatePredictionsSha256: string | null;
  detail: string;
  reasonCode?: R6ReasonCode;
  universe?: R6UniverseEvidence;
  firstAnomalyAt?: string;
  /** Consecutive runs in which the record could not be compared (reset only by a real digest comparison). */
  uncomparedRuns?: number;
  firstUncomparedAt?: string;
  /** While an earlier anomaly is unresolved, `r6` keeps the anomaly evidence and later results are recorded here. */
  latestObservation?: { at: string; status: R6Record["status"]; reasonCode?: R6ReasonCode; detail: string };
}

/** Append-only audit trail of significant R6 results (never edited; the first anomaly is always retained). */
export interface R6Event {
  at: string;
  status: R6Record["status"];
  reasonCode?: R6ReasonCode;
  existingPredictionsSha256: string | null;
  candidatePredictionsSha256: string | null;
  detail: string;
}

export interface DateRecord {
  status: DateRecordStatus;
  reasons: string[];
  sourceDataDate: string | null;
  generatedAt: string | null;
  publicationClass: PublicationClass | null;
  /** Provisional earliest cut-off (09:00 IST of the first following weekday), ISO UTC. */
  earliestCutoffUtc: string | null;
  cutoffUtc: string | null;
  updatedAt: string;
  readiness?: { id: string; status: string; disposition: string }[];
  r6?: R6Record;
  r6Events?: R6Event[];
}

/**
 * Status precedence. A weaker verification result can never replace a stronger warning/review state.
 * recorded < recorded-late < unverified < review-required < source-revised < anomaly
 * (waiting / blocked / missed describe dates with no record and are outside this ordering.)
 */
export const STATUS_PRECEDENCE: Partial<Record<DateRecordStatus, number>> = { recorded: 0, "recorded-late": 1, unverified: 2, "review-required": 3, "source-revised": 4, anomaly: 5 };
export const REASON_CAP = 20;

export const strongerStatus = (a: DateRecordStatus, b: DateRecordStatus): DateRecordStatus => ((STATUS_PRECEDENCE[b] ?? -1) > (STATUS_PRECEDENCE[a] ?? -1) ? b : a);

export function appendReasons(existing: string[], add: string[], prefix = ""): string[] {
  const out = [...existing];
  for (const r of add) {
    const text = `${prefix}${r}`;
    if (!out.includes(text)) out.push(text);
  }
  return out.slice(-REASON_CAP);
}

export const R6_EVENT_CAP = 50;
/** Persistent inability to compare (other than an expected constituent refresh) becomes a warning after this many runs. */
export const R6_UNCOMPARED_WARN_RUNS = 12;

/** Appends an event only when the result differs from the last one. Old events are never edited; the first anomaly is never dropped. */
export function appendR6Event(events: R6Event[] | undefined, e: R6Event): R6Event[] {
  const list = [...(events ?? [])];
  const last = list[list.length - 1];
  if (last && last.status === e.status && last.reasonCode === e.reasonCode && last.candidatePredictionsSha256 === e.candidatePredictionsSha256 && last.existingPredictionsSha256 === e.existingPredictionsSha256) return list;
  list.push(e);
  while (list.length > R6_EVENT_CAP) {
    const drop = list.findIndex((x, i) => i < list.length - 1 && !(x.status === "anomaly" && list.findIndex((y) => y.status === "anomaly") === i));
    if (drop < 0) break;
    list.splice(drop, 1);
  }
  return list;
}

/**
 * Folds an authoritative publication result into a date record.
 * - `publicationClass` follows the verification result UNTIL a receipt-backed class (`live` or `live-late`) is
 *   recorded; from then on it is sticky. A later result that contradicts it is ignored (the create-only receipt is the
 *   authority) and the contradiction is written to the reasons.
 * - `status` only ever moves UP the precedence ladder. The one release: `unverified` goes back to `recorded` when
 *   evidence arrives (`live`). `recorded-late` is never released.
 * - Reasons are appended, never replaced.
 */
export function applyPublication(rec: DateRecord, cls: "live" | "live-late" | "unverified" | "pending", reasons: string[], now: string, authority: "evidence" | "receipt" = "evidence"): DateRecord {
  const stored = rec.publicationClass;
  if ((stored === "live" || stored === "live-late") && cls !== stored) {
    if (authority === "receipt" && (cls === "live" || cls === "live-late")) {
      // The result was read from a create-only receipt: the receipt is the authority and the state was WRONG (or the
      // receipt was tampered with). Either way the disagreement is an integrity event: use the more conservative class
      // (never the more favourable one) and raise the status to anomaly.
      const resolved = stored === "live-late" || cls === "live-late" ? "live-late" : "live";
      const msg = `state and receipt disagreed (state "${stored}", receipt "${cls}"); using the more conservative "${resolved}"`;
      return { ...rec, publicationClass: resolved, status: strongerStatus(rec.status, "anomaly"), reasons: appendReasons(rec.reasons, [msg], "publication: "), updatedAt: now };
    }
    return { ...rec, reasons: appendReasons(rec.reasons, [`ignored a conflicting verification result "${cls}"; the receipt-backed class is "${stored}"`], "publication: "), updatedAt: now };
  }
  const next: DateRecord = { ...rec, publicationClass: cls, updatedAt: now };
  const candidate: DateRecordStatus | null = cls === "live-late" ? "recorded-late" : cls === "unverified" ? "unverified" : null;
  let status = rec.status;
  if (cls === "live" && status === "unverified") status = "recorded";
  if (cls === "live-late" && status === "unverified") status = "recorded-late";
  if (candidate) status = strongerStatus(status, candidate);
  next.status = status;
  if (cls === "unverified" || cls === "live-late") next.reasons = appendReasons(rec.reasons, reasons, "publication: ");
  return next;
}

/**
 * Receipts are the authority for publication class. A date whose state says `live` or `live-late` must have a receipt of
 * exactly that class. (State saying unverified/pending while a receipt exists is only "not yet reflected" and is fixed by
 * the next verification.)
 */
export function checkReceiptStateConsistency(state: Pick<LedgerState, "dates">, receipts: ReadonlyMap<string, "live" | "live-late">): string[] {
  const problems: string[] = [];
  for (const [date, rec] of Object.entries(state.dates)) {
    const c = rec.publicationClass;
    if (c !== "live" && c !== "live-late") continue;
    const r = receipts.get(date);
    if (!r) problems.push(`state says ${date} is "${c}" but there is no valid receipt for it`);
    else if (r !== c) problems.push(`state says ${date} is "${c}" but its receipt says "${r}"`);
  }
  return problems;
}

export interface LedgerState {
  kind: typeof STATE_KIND;
  schemaVersion: number;
  updatedAt: string;
  lastAttemptAt: string | null;
  lastSuccessfulCaptureAt: string | null;
  lastSuccessfulSessionDate: string | null;
  runStatus: RunStatus;
  lastFailure: { at: string; date: string | null; reasons: string[] } | null;
  /** Session dates that still need a capture or a publication decision. */
  recoveryRequired: string[];
  ruleVersion: string | null;
  enabledVersion: string | null;
  enabledFrom: string | null;
  dates: Record<string, DateRecord>;
  /** Exchange-calendar classification written from the pipeline's own reconcileDate. */
  calendar: Record<string, string>;
  runs: { startedAt: string; slot: string | null; status: RunStatus }[];
  metrics: { dailyFileBytes: number | null; ledgerBytes: number | null; publicDataBytes: number | null; captureSeconds: number | null };
}

export function emptyState(now: string): LedgerState {
  return {
    kind: STATE_KIND,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    updatedAt: now,
    lastAttemptAt: null,
    lastSuccessfulCaptureAt: null,
    lastSuccessfulSessionDate: null,
    runStatus: "idle",
    lastFailure: null,
    recoveryRequired: [],
    ruleVersion: null,
    enabledVersion: null,
    enabledFrom: null,
    dates: {},
    calendar: {},
    runs: [],
    metrics: { dailyFileBytes: null, ledgerBytes: null, publicDataBytes: null, captureSeconds: null },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["waiting", "blocked", "recorded", "review-required", "recorded-late", "unverified", "source-revised", "missed", "anomaly"];
const RUN_STATUSES = ["ok", "idle", "not-enabled", "waiting", "blocked", "anomaly", "error"];
const PUB_CLASSES = ["live", "live-late", "unverified", "pending"];
const CAL_STATUSES = ["trading", "non-trading", "pending-publication", "unresolved"];
const TOP_KEYS = ["kind", "schemaVersion", "updatedAt", "lastAttemptAt", "lastSuccessfulCaptureAt", "lastSuccessfulSessionDate", "runStatus", "lastFailure", "recoveryRequired", "ruleVersion", "enabledVersion", "enabledFrom", "dates", "calendar", "runs", "metrics"];
const DATE_KEYS = ["status", "reasons", "sourceDataDate", "generatedAt", "publicationClass", "earliestCutoffUtc", "cutoffUtc", "updatedAt", "readiness", "r6", "r6Events"];
const FORBIDDEN = new Set(["predictions", "predictionId", "recordHash", "header", "classification", "lists", "inputDigest"]);
export const MAX_STATE_BYTES = 2_000_000;

const isIso = (x: unknown) => typeof x === "string" && !Number.isNaN(Date.parse(x));
const isNullOr = (x: unknown, f: (v: unknown) => boolean) => x === null || f(x);

/** Structural validation of ledger-state.json: known keys/values only, and never an alternative prediction store. */
export function validateState(obj: unknown, sizeBytes?: number): string[] {
  const p: string[] = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return ["state is not an object"];
  const o = obj as Record<string, any>;
  if (sizeBytes !== undefined && sizeBytes > MAX_STATE_BYTES) p.push(`state is ${sizeBytes} bytes, above ${MAX_STATE_BYTES}`);
  if (o.kind !== STATE_KIND) p.push(`kind must be ${STATE_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  for (const k of Object.keys(o)) if (!TOP_KEYS.includes(k)) p.push(`unknown top-level key ${k}`);
  for (const k of TOP_KEYS) if (!(k in o)) p.push(`missing key ${k}`);
  if (!isIso(o.updatedAt)) p.push("updatedAt must be an ISO time");
  for (const k of ["lastAttemptAt", "lastSuccessfulCaptureAt"]) if (!isNullOr(o[k], isIso)) p.push(`${k} must be null or an ISO time`);
  if (!isNullOr(o.lastSuccessfulSessionDate, (v) => typeof v === "string" && DATE_RE.test(v))) p.push("lastSuccessfulSessionDate must be null or a date");
  if (!RUN_STATUSES.includes(o.runStatus)) p.push(`runStatus ${String(o.runStatus)} is not permitted`);
  if (!isNullOr(o.enabledFrom, (v) => typeof v === "string" && DATE_RE.test(v))) p.push("enabledFrom must be null or a date");
  for (const k of ["ruleVersion", "enabledVersion"]) if (!isNullOr(o[k], (v) => typeof v === "string" && /^mv\d+-[0-9a-f]{8}$/.test(v))) p.push(`${k} must be null or mv<N>-<8 hex>`);
  if (!Array.isArray(o.recoveryRequired) || !o.recoveryRequired.every((d: unknown) => typeof d === "string" && DATE_RE.test(d))) p.push("recoveryRequired must be a list of dates");
  if (o.lastFailure !== null && !(o.lastFailure && isIso(o.lastFailure.at) && Array.isArray(o.lastFailure.reasons) && o.lastFailure.reasons.every((r: unknown) => typeof r === "string"))) p.push("lastFailure is malformed");
  if (!o.dates || typeof o.dates !== "object" || Array.isArray(o.dates)) p.push("dates must be an object");
  else {
    for (const [d, r] of Object.entries<any>(o.dates)) {
      if (!DATE_RE.test(d)) p.push(`dates key ${d} is not a date`);
      if (!r || typeof r !== "object") {
        p.push(`dates.${d} is not an object`);
        continue;
      }
      for (const k of Object.keys(r)) if (!DATE_KEYS.includes(k)) p.push(`dates.${d}: unknown key ${k}`);
      if (!STATUSES.includes(r.status)) p.push(`dates.${d}: status ${String(r.status)} is not permitted`);
      if (!isNullOr(r.publicationClass, (v) => PUB_CLASSES.includes(v as string))) p.push(`dates.${d}: publicationClass ${String(r.publicationClass)} is not permitted`);
      if (!Array.isArray(r.reasons) || !r.reasons.every((x: unknown) => typeof x === "string")) p.push(`dates.${d}: reasons must be strings`);
      if (!isIso(r.updatedAt)) p.push(`dates.${d}: updatedAt must be an ISO time`);
      if (r.r6 !== undefined && !(r.r6 && ["pass", "existing", "existing-uncompared", "anomaly"].includes(r.r6.status))) p.push(`dates.${d}: r6 is malformed`);
      if (r.r6Events !== undefined && !(Array.isArray(r.r6Events) && r.r6Events.length <= 60 && r.r6Events.every((e: any) => e && isIso(e.at) && ["pass", "existing", "existing-uncompared", "anomaly"].includes(e.status)))) p.push(`dates.${d}: r6Events is malformed`);
    }
  }
  if (!o.calendar || typeof o.calendar !== "object" || Array.isArray(o.calendar)) p.push("calendar must be an object");
  else for (const [d, v] of Object.entries<any>(o.calendar)) if (!DATE_RE.test(d) || !CAL_STATUSES.includes(v)) p.push(`calendar ${d}=${String(v)} is not permitted`);
  if (!Array.isArray(o.runs)) p.push("runs must be a list");
  else for (const r of o.runs) if (!r || !isIso(r.startedAt) || !RUN_STATUSES.includes(r.status)) p.push("runs entry is malformed");
  if (!o.metrics || typeof o.metrics !== "object") p.push("metrics must be an object");
  else for (const [k, v] of Object.entries(o.metrics)) if (v !== null && typeof v !== "number") p.push(`metrics.${k} must be a number or null`);
  const scan = (x: unknown, at: string, depth = 0): void => {
    if (depth > 8 || x === null || typeof x !== "object") return;
    for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
      if (FORBIDDEN.has(k)) p.push(`${at}.${k}: prediction payload keys are not allowed in the state`);
      scan(v, `${at}.${k}`, depth + 1);
    }
  };
  scan(o, "state");
  return p;
}

export async function loadLedgerState(file: string, now: string): Promise<LedgerState> {
  const s = await readJsonIfExists<LedgerState>(file);
  return s && s.kind === STATE_KIND ? s : emptyState(now);
}

export async function saveLedgerState(file: string, state: LedgerState): Promise<void> {
  await replaceAtomic(file, JSON.stringify(state, null, 1) + "\n");
}
