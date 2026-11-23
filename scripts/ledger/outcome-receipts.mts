/**
 * PUBLIC outcome receipts (Phase B2a): writer, validator, tree checks and leak scan.
 *
 * Location (owner decision 2026-11-23): public/data/ledger/live/outcome-receipts/<rule version>/<date>/h<h>.json and,
 * for corrections, .../h<h>.c<n>.json. Being under live/, they are add-only for the immutability guard.
 *
 * A receipt carries ONLY: session date, horizon, end date (public calendar), prediction count, the identity of the
 * public prediction file (path + hashes), protocol and engine identifiers, the private storage key, a SALTED
 * commitment and its time. Never classes, returns, flags, per-stock values, salts, unsalted outcome hashes or any
 * aggregate. Its time is the stored record's generatedAt, so every retry produces byte-identical receipts.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalize, sha256Hex } from "./canonical.mts";
import { LEDGER_SCHEMA_VERSION } from "./constants.mts";
import { createOnly } from "./files.mts";
import { OD1_CLASSES, OD1_STORED_HORIZONS } from "./od1.mts";
import { CORRECTION_REASONS, OUTCOME_CORRECTION_KIND, OUTCOME_KIND, buildOutcomeReceipt, validateOutcomeReceipt, type OutcomeCorrection, type OutcomeReceipt, type OutcomeRecord } from "./outcomes.mts";
import { listTree, safeResolve } from "./safe-path.mts";

export const OUTCOME_RECEIPTS_DIR = "live/outcome-receipts";
export const CORRECTION_RECEIPT_KIND = "momentum-ledger.od1-outcome-correction-receipt";

export const outcomeReceiptRel = (ruleVersion: string, date: string, h: number) => `${OUTCOME_RECEIPTS_DIR}/${ruleVersion}/${date}/h${h}.json`;
export const correctionReceiptRel = (ruleVersion: string, date: string, h: number, n: number) => `${OUTCOME_RECEIPTS_DIR}/${ruleVersion}/${date}/h${h}.c${n}.json`;

/** The only receipt a record may produce: built from the STORED record, timed by its generatedAt (idempotent). */
export const receiptForStoredRecord = (r: OutcomeRecord): OutcomeReceipt => buildOutcomeReceipt(r, r.header.generatedAt);

export interface CorrectionReceipt {
  kind: typeof CORRECTION_RECEIPT_KIND;
  schemaVersion: number;
  sessionDate: string;
  ruleVersion: string;
  horizon: number;
  sequence: number;
  supersedes: string;
  replacement: string;
  reasonCode: OutcomeCorrection["reasonCode"];
  recordedAt: string;
}
/** Public form of a private correction: the chain link and reason CODE only (the free-text reason stays private). */
export const correctionReceiptOf = (c: OutcomeCorrection): CorrectionReceipt => ({ kind: CORRECTION_RECEIPT_KIND, schemaVersion: LEDGER_SCHEMA_VERSION, sessionDate: c.sessionDate, ruleVersion: c.ruleVersion, horizon: c.horizon, sequence: c.sequence, supersedes: c.supersedes, replacement: c.replacement, reasonCode: c.reasonCode, recordedAt: c.recordedAt });

const HEX64 = /^[0-9a-f]{64}$/;
export function validateCorrectionReceipt(o: any): string[] {
  const p: string[] = [];
  const keys = ["kind", "schemaVersion", "sessionDate", "ruleVersion", "horizon", "sequence", "supersedes", "replacement", "reasonCode", "recordedAt"];
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["correction receipt is not an object"];
  for (const k of Object.keys(o)) if (!keys.includes(k)) p.push(`correction receipt: unknown key ${k}`);
  for (const k of keys) if (!(k in o)) p.push(`correction receipt: missing key ${k}`);
  if (o.kind !== CORRECTION_RECEIPT_KIND || o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push("correction receipt kind/schemaVersion");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.sessionDate)) || !/^mv\d+-[0-9a-f]{8}$/.test(String(o.ruleVersion)) || !OD1_STORED_HORIZONS.includes(o.horizon)) p.push("correction receipt must identify a record");
  if (!Number.isInteger(o.sequence) || o.sequence < 1) p.push("correction receipt sequence must be a positive integer");
  if (!HEX64.test(String(o.supersedes)) || !HEX64.test(String(o.replacement)) || o.supersedes === o.replacement) p.push("correction receipt commitments must be two different 64-hex values");
  if (!(CORRECTION_REASONS as readonly string[]).includes(o.reasonCode)) p.push("correction receipt reasonCode");
  if (typeof o.recordedAt !== "string" || Number.isNaN(Date.parse(o.recordedAt))) p.push("correction receipt recordedAt");
  return p;
}

/**
 * Confidentiality check of a receipt against the record it commits to: besides the whitelist, no value of the receipt
 * may be the salt, the unsalted outcomes hash, or any hash/number/string that only the record knows.
 */
export function receiptLeakProblems(receipt: unknown, record: OutcomeRecord): string[] {
  const p: string[] = [];
  const text = JSON.stringify(receipt);
  const h = record.header;
  if (text.includes(h.commitmentSalt)) p.push("the receipt contains the private salt");
  if (text.includes(h.outcomesSha256)) p.push("the receipt contains the unsalted outcomes hash");
  for (const c of OD1_CLASSES) if (new RegExp(`\\b${c}\\b`, "i").test(text)) p.push(`the receipt mentions the outcome class "${c}"`);
  if (/"(R|X|eps|Hstar|Lstar|gapPct|cls|outcome|outcomes|abnormalGap|volWindowOutlier|bars|sigmaChanges|status|reason)"\s*:/.test(text)) p.push("the receipt contains an outcome field");
  const numbers: number[] = [];
  const walk = (v: unknown) => (typeof v === "number" ? numbers.push(v) : v && typeof v === "object" ? Object.values(v).forEach(walk) : undefined);
  walk(receipt);
  const allowed = new Set([LEDGER_SCHEMA_VERSION, h.horizon, h.source.predictionCount]);
  for (const n of numbers) if (!allowed.has(n)) p.push(`the receipt contains an unexpected number ${n}`);
  return p;
}

export type PublishResult = "created" | "existing" | "conflict";

/** The public side of the pipeline (B2b: a commit to the public repository; B2a: a local directory). */
export interface PublicReceiptSink {
  get(rel: string): Promise<unknown | null>;
  put(rel: string, content: string): Promise<PublishResult>;
  list(): Promise<string[]>;
}

/** Local public receipt directory (a temporary ledger root in tests). Create-only, link-safe. */
export class FsPublicReceiptSink implements PublicReceiptSink {
  constructor(readonly ledgerRoot: string) {}
  async get(rel: string) {
    const f = await safeResolve(this.ledgerRoot, rel);
    try {
      return JSON.parse(await readFile(f, "utf-8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }
  async put(rel: string, content: string): Promise<PublishResult> {
    if (!rel.startsWith(`${OUTCOME_RECEIPTS_DIR}/`)) throw new Error(`receipts may only be written under ${OUTCOME_RECEIPTS_DIR}/`);
    const res = await createOnly(await safeResolve(this.ledgerRoot, rel, { create: true }), content);
    return res.created ? "created" : res.existing === "identical" ? "existing" : "conflict";
  }
  async list() {
    return (await listTree(this.ledgerRoot, OUTCOME_RECEIPTS_DIR)).filter((f) => !f.endsWith(".partial"));
  }
}

export const receiptText = (r: unknown) => JSON.stringify(canonicalize(r), null, 1) + "\n";

// ---------------------------------------------------------------------------------------------------------------------
// Guard checks (public, need no secret)
// ---------------------------------------------------------------------------------------------------------------------
export interface ReceiptViolation {
  path: string;
  detail: string;
}

const FILE = /^live\/outcome-receipts\/(mv\d+-[0-9a-f]{8})\/(\d{4}-\d{2}-\d{2})\/h(1|2|5|10)(?:\.c(\d+))?\.json$/;

/**
 * Validates every public outcome receipt: file name, strict whitelist, path <-> content, binding to the public
 * prediction file (sha256, predictionsSha256, count), time after the window, an unbroken correction chain, and — when
 * `eligible` is given — that only eligible sessions have receipts (excluded sessions are not processed).
 */
export async function validateOutcomeReceiptTree(ledgerRoot: string, ctx: { definitionsSha256: string; eligible?: ReadonlySet<string> }): Promise<ReceiptViolation[]> {
  const v: ReceiptViolation[] = [];
  let files: string[];
  try {
    files = await listTree(ledgerRoot, OUTCOME_RECEIPTS_DIR);
  } catch (err) {
    return [{ path: OUTCOME_RECEIPTS_DIR, detail: String(err) }];
  }
  const base = new Map<string, OutcomeReceipt>();
  const corr = new Map<string, CorrectionReceipt[]>();
  for (const f of files) {
    const m = f.match(FILE);
    if (!m) {
      v.push({ path: f, detail: "unexpected file under live/outcome-receipts (only h<h>.json and h<h>.c<n>.json receipts are allowed)" });
      continue;
    }
    const [, rv, date, hs, cn] = m;
    const h = Number(hs);
    let o: any;
    try {
      o = JSON.parse(await readFile(path.join(ledgerRoot, f), "utf-8"));
    } catch {
      v.push({ path: f, detail: "not valid JSON" });
      continue;
    }
    const id = `${rv}/${date}/h${h}`;
    if (cn !== undefined) {
      for (const d of validateCorrectionReceipt(o)) v.push({ path: f, detail: d });
      if (o.ruleVersion !== rv || o.sessionDate !== date || o.horizon !== h || o.sequence !== Number(cn)) v.push({ path: f, detail: "the correction receipt does not match its file name" });
      corr.set(id, [...(corr.get(id) ?? []), o]);
      continue;
    }
    for (const d of validateOutcomeReceipt(o, { definitionsSha256: ctx.definitionsSha256 })) v.push({ path: f, detail: d });
    if (o.ruleVersion !== rv || o.sessionDate !== date || o.horizon !== h) v.push({ path: f, detail: "the receipt does not match its file name" });
    if (typeof o.createdAt === "string" && typeof o.endDate === "string" && o.createdAt.slice(0, 10) < o.endDate) v.push({ path: f, detail: "the receipt is dated before the end of its outcome window" });
    if (ctx.eligible && !ctx.eligible.has(date)) v.push({ path: f, detail: `session ${date} is not eligible for the live holdout; excluded sessions must not have outcome receipts` });
    const daily = path.join(ledgerRoot, "live", "predictions", rv, `${date}.json`);
    try {
      const buf = await readFile(daily);
      const hdr = (JSON.parse(buf.toString("utf-8")) as { header: { predictionsSha256: string; predictionCount: number } }).header;
      if (o.source?.dailyFileSha256 !== sha256Hex(buf) || o.source?.predictionsSha256 !== hdr.predictionsSha256 || o.source?.predictionCount !== hdr.predictionCount) v.push({ path: f, detail: "the receipt is not bound to the public prediction file (hash or count differs)" });
    } catch {
      v.push({ path: f, detail: "the receipt names a prediction file that does not exist" });
    }
    base.set(id, o);
  }
  for (const [id, list] of corr) {
    const b = base.get(id);
    if (!b) {
      v.push({ path: `${OUTCOME_RECEIPTS_DIR}/${id}`, detail: "a correction receipt exists without the original receipt" });
      continue;
    }
    let head = b.commitment?.value;
    list.sort((x, y) => x.sequence - y.sequence).forEach((c, i) => {
      if (c.sequence !== i + 1) v.push({ path: `${OUTCOME_RECEIPTS_DIR}/${id}`, detail: "correction receipts must be numbered 1..n without gaps" });
      if (c.supersedes !== head) v.push({ path: `${OUTCOME_RECEIPTS_DIR}/${id}`, detail: `correction ${c.sequence} does not supersede the current head (fork or silent replacement)` });
      head = c.replacement;
    });
  }
  return v;
}

/** Markers that only PRIVATE files contain. Receipts never contain them (their kinds differ in the closing quote). */
const PRIVATE_MARKERS = [`"${OUTCOME_KIND}"`, `"${OUTCOME_CORRECTION_KIND}"`, `"commitmentSalt"`, `"outcomesSha256"`];

/** Scans directories (e.g. public/) for any protected outcome record, private correction, salt or unsalted hash. */
export async function scanForOutcomeLeaks(dirs: string[]): Promise<ReceiptViolation[]> {
  const v: ReceiptViolation[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await listTree(dir);
    } catch (err) {
      v.push({ path: dir, detail: `cannot scan for protected outcome data: ${String(err)}` });
      continue;
    }
    for (const f of files) {
      const text = await readFile(path.join(dir, f), "utf-8");
      for (const mk of PRIVATE_MARKERS) if (text.includes(mk)) v.push({ path: path.join(dir, f), detail: `protected outcome data (${mk}) found in a public path` });
    }
  }
  return v;
}
