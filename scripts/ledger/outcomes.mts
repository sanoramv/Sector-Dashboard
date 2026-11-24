/**
 * Governed OD1 outcome records and corrections — schema, builder and validator.
 *
 * History: Phase B1 designed these records as PRIVATE (blinded holdout, salted public receipts). On 2026-11-24 the
 * owner ended strict blinding (public/data/ledger/protocol/evaluation-policy.json, docs/design/EVALUATION_POLICY.md):
 * the live mv1 ledger is now a continuously monitored prospective benchmark, and outcome records are stored openly in
 * this repository (data/outcomes/), create-only. Salts, commitments, receipts and the private-storage restriction were
 * removed; the OD1 mathematics (od1.mts) and the sealed protocol are unchanged.
 *
 *  - h = 1, 2, 5, 10 are stored (sealed protocol); h = 1 and 5 are the headline horizons.
 *  - Corrections are append-only records that supersede by the record's outcomesSha256; an original record is never
 *    overwritten (`createOnlyDecision`, `validateCorrectionChain`). Their analytical treatment is an owner decision.
 *  - Every record stores the exact inputs it was computed from, and validation re-derives each outcome from THOSE
 *    inputs (never from current, pruned data) — the lesson of the R6 retention false alarm.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Canonical, sha256Hex } from "./canonical.mts";
import { LEDGER_SCHEMA_VERSION } from "./constants.mts";
import { OD1_STORED_HORIZONS, od1Outcome, populationSd, type ArchiveStatus, type CalendarStatus, type Od1Outcome, type Od1WindowBar } from "./od1.mts";

export const OUTCOME_KIND = "momentum-ledger.od1-outcomes";
export const OUTCOME_CORRECTION_KIND = "momentum-ledger.od1-outcome-correction";
/** Source files of the outcome engine; their hashes define the engine version (like the prediction rule version). */
/** B2a: the runner (which selects each window's bars, sigma window and segment) and the shared price-break
 *  segmentation it uses are part of the engine, because they determine the stored inputs. */
export const ENGINE_FILES = ["scripts/ledger/od1.mts", "scripts/ledger/outcomes.mts", "scripts/ledger/protocol.mts", "scripts/ledger/outcome-runner.mts", "src/lib/calculations/validation.ts"] as const;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RULE = /^mv\d+-[0-9a-f]{8}$/;
const ENGINE = /^od1e-[0-9a-f]{8}$/;
const isDate = (x: unknown): x is string => typeof x === "string" && DATE.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
const isIso = (x: unknown): x is string => typeof x === "string" && !Number.isNaN(Date.parse(x)) && /T/.test(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const keysExactly = (o: Record<string, unknown>, keys: string[], where: string, p: string[]) => {
  for (const k of Object.keys(o)) if (!keys.includes(k)) p.push(`${where}: unknown key ${k}`);
  for (const k of keys) if (!(k in o)) p.push(`${where}: missing key ${k}`);
};
const obj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);

// ---------------------------------------------------------------------------------------------------------------------
// Engine version
// ---------------------------------------------------------------------------------------------------------------------
export interface EngineFileHash {
  path: string;
  sha256: string;
}
export const engineVersionOf = (files: EngineFileHash[], definitionsSha256: string): string => `od1e-${sha256Canonical({ files: [...files].sort((a, b) => a.path.localeCompare(b.path)), definitionsSha256 }).slice(0, 8)}`;
export async function computeEngine(repoRoot: string, definitionsSha256: string): Promise<{ version: string; files: EngineFileHash[] }> {
  const files: EngineFileHash[] = [];
  for (const f of ENGINE_FILES) files.push({ path: f, sha256: sha256Hex(await readFile(path.join(repoRoot, f))) });
  return { version: engineVersionOf(files, definitionsSha256), files };
}

// ---------------------------------------------------------------------------------------------------------------------
// Storage key and evaluation policy
// ---------------------------------------------------------------------------------------------------------------------
/** The logical key of a record in the outcome store: od1/<rule version>/<date>/h<h>. */
export const outcomeStorageKey = (ruleVersion: string, sessionDate: string, horizon: number) => `od1/${ruleVersion}/${sessionDate}/h${horizon}`;
/** Kept for the historical contract: true only if holdout.json itself records an unblinding (it never has). */
export function requireUnblinded(holdout: { status?: string; unblinded?: unknown } | null): void {
  if (!holdout || holdout.status !== "unblinded" || !obj(holdout.unblinded)) throw new Error("the live holdout is sealed: protected outcomes may not be analysed, summarised or displayed before the owner's explicit unblinding");
}

export const EVALUATION_POLICY_KIND = "momentum-ledger.evaluation-policy";
export interface EvaluationPolicy {
  kind: typeof EVALUATION_POLICY_KIND;
  schemaVersion: number;
  mode: "continuous-monitoring";
  decidedAt: string;
  decidedBy: string;
  referenceRuleVersion: string;
  outcomesFrom: string;
  excludedSessions: Array<{ sessionDate: string; reason: string }>;
  [k: string]: unknown;
}
/** Live outcomes may be computed, stored and shown only under a valid continuous-monitoring policy. */
export function validateEvaluationPolicy(o: unknown): string[] {
  const p: string[] = [];
  if (!obj(o)) return ["evaluation policy is not an object"];
  if (o.kind !== EVALUATION_POLICY_KIND || o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push("evaluation policy kind/schemaVersion");
  if (o.mode !== "continuous-monitoring") p.push('evaluation policy mode must be "continuous-monitoring"');
  if (!isDate(o.decidedAt) || !isDate(o.outcomesFrom)) p.push("evaluation policy decidedAt and outcomesFrom must be real dates");
  if (typeof o.decidedBy !== "string" || !o.decidedBy.trim()) p.push("evaluation policy must be attributed (decidedBy)");
  if (!RULE.test(String(o.referenceRuleVersion))) p.push("evaluation policy referenceRuleVersion must be mv<N>-<8 hex>");
  if (!Array.isArray(o.excludedSessions) || o.excludedSessions.some((e: any) => !obj(e) || !isDate(e.sessionDate) || typeof e.reason !== "string")) p.push("evaluation policy excludedSessions must list {sessionDate, reason}");
  return p;
}

// ---------------------------------------------------------------------------------------------------------------------
// Outcome record
// ---------------------------------------------------------------------------------------------------------------------
export interface OutcomeEntry {
  predictionId: string;
  symbol: string;
  /** the prediction record's own recordHash (binding to the immutable prediction) */
  recordHash: string;
  group: "gainer" | "loser";
  /** frozen in the prediction record */
  frozen: { sigma: number | null; day: { high: number; low: number; close: number } };
  /** inputs read from the data at outcome time (stored so the outcome can always be re-derived) */
  sigmaChanges: number[] | null;
  bars: Array<Od1WindowBar | null>;
  outcome: Od1Outcome;
}
export interface OutcomeHeader {
  sessionDate: string;
  horizon: number;
  sessions: string[];
  endDate: string;
  ruleVersion: string;
  protocol: { id: "od1"; definitionsSha256: string };
  engine: { version: string; files: EngineFileHash[] };
  source: { dailyFile: string; dailyFileSha256: string; predictionsSha256: string; predictionCount: number; receipt: { file: string; fileSha256: string; class: "live" } };
  calendar: Record<string, CalendarStatus>;
  archives: Record<string, ArchiveStatus>;
  benchmark: { slug: "nifty500"; closeT: number; closeTh: number };
  data: { commit: string; files: Array<{ name: string; sha256: string }> };
  generatedAt: string;
  github: { runId: string | null; runAttempt: string | null; sha: string | null };
  outcomesSha256: string;
}
export interface OutcomeRecord {
  kind: typeof OUTCOME_KIND;
  schemaVersion: number;
  header: OutcomeHeader;
  outcomes: OutcomeEntry[];
}

/** What a builder needs about one prediction's window from the data at outcome time. */
export interface WindowEvidence {
  bars: Array<Od1WindowBar | null>;
  sigmaChanges: number[] | null;
}
export type DailyLike = { header: { sessionDate: string; predictionsSha256: string; predictionCount: number; model: { ruleVersion: string } }; predictions: Array<{ predictionId: string; symbol: string; recordHash: string; bar: { high: number; low: number; close: number }; price: { changePct: number; volatility20: number | null } }> };

const inputsOf = (h: OutcomeHeader, e: Pick<OutcomeEntry, "group" | "frozen" | "sigmaChanges" | "bars">) => ({ sessions: h.sessions, bars: e.bars, up: e.group === "gainer", day: e.frozen.day, sigma: e.frozen.sigma, sigmaChanges: e.sigmaChanges, benchT: h.benchmark.closeT, benchTh: h.benchmark.closeTh });

/**
 * Builds an outcome record from an immutable prediction file and already-checked window evidence. Pure: the caller
 * supplies the maturity result, the evidence, provenance and time. Fails closed on any inconsistency.
 */
export function buildOutcomeRecord(a: {
  daily: DailyLike;
  dailyFile: string;
  dailyFileSha256: string;
  receipt: { file: string; fileSha256: string; class: string };
  horizon: number;
  sessions: string[];
  calendar: Record<string, CalendarStatus>;
  archives: Record<string, ArchiveStatus>;
  benchmark: { closeT: number; closeTh: number };
  evidence: (symbol: string) => WindowEvidence;
  definitionsSha256: string;
  engine: { version: string; files: EngineFileHash[] };
  data: { commit: string; files: Array<{ name: string; sha256: string }> };
  generatedAt: string;
  github: { runId: string | null; runAttempt: string | null; sha: string | null };
}): OutcomeRecord {
  if (a.receipt.class !== "live") throw new Error(`outcomes are only built for live sessions (receipt class ${a.receipt.class})`);
  const d = a.daily;
  if (sha256Canonical(d.predictions) !== d.header.predictionsSha256) throw new Error("the prediction file's predictions do not match its predictionsSha256");
  const outcomes: OutcomeEntry[] = [...d.predictions]
    .sort((x, y) => x.symbol.localeCompare(y.symbol))
    .map((p) => {
      const { recordHash, ...rest } = p as typeof p & Record<string, unknown>;
      if (recordHash !== sha256Canonical(rest)) throw new Error(`${p.symbol}: the prediction recordHash does not match its record`);
      if (!(p.price.changePct !== 0)) throw new Error(`${p.symbol}: an unchanged stock has no OD1 group`);
      const ev = a.evidence(p.symbol);
      const sigma = p.price.volatility20 ?? null;
      if (sigma !== null && ev.sigmaChanges && populationSd(ev.sigmaChanges) !== sigma) throw new Error(`${p.symbol}: the sigma-window data no longer reproduces the frozen volatility20 (source revision); use the correction procedure`);
      const base = { predictionId: p.predictionId, symbol: p.symbol, recordHash, group: (p.price.changePct > 0 ? "gainer" : "loser") as OutcomeEntry["group"], frozen: { sigma, day: { high: p.bar.high, low: p.bar.low, close: p.bar.close } }, sigmaChanges: ev.sigmaChanges, bars: ev.bars };
      const header = { sessions: a.sessions, benchmark: { slug: "nifty500" as const, ...a.benchmark } } as OutcomeHeader;
      return { ...base, outcome: od1Outcome(inputsOf(header, base)) };
    });
  const header: OutcomeHeader = {
    sessionDate: d.header.sessionDate,
    horizon: a.horizon,
    sessions: a.sessions,
    endDate: a.sessions[a.sessions.length - 1],
    ruleVersion: d.header.model.ruleVersion,
    protocol: { id: "od1", definitionsSha256: a.definitionsSha256 },
    engine: a.engine,
    source: { dailyFile: a.dailyFile, dailyFileSha256: a.dailyFileSha256, predictionsSha256: d.header.predictionsSha256, predictionCount: d.predictions.length, receipt: { file: a.receipt.file, fileSha256: a.receipt.fileSha256, class: "live" } },
    calendar: a.calendar,
    archives: a.archives,
    benchmark: { slug: "nifty500", ...a.benchmark },
    data: a.data,
    generatedAt: a.generatedAt,
    github: a.github,
    outcomesSha256: sha256Canonical(outcomes),
  };
  return { kind: OUTCOME_KIND, schemaVersion: LEDGER_SCHEMA_VERSION, header, outcomes };
}

/**
 * Validates an outcome record: structure, provenance, hashes, and that EVERY stored outcome re-derives exactly
 * from its stored inputs with the shared engine (tamper detection). With `daily` it also binds the record to the
 * immutable prediction file (identity, recordHash, frozen sigma and day bar, group, completeness, duplicates).
 */
export function validateOutcomeRecord(o: unknown, ctx: { definitionsSha256: string; daily?: DailyLike }): string[] {
  const p: string[] = [];
  if (!obj(o)) return ["outcome record is not an object"];
  keysExactly(o, ["kind", "schemaVersion", "header", "outcomes"], "record", p);
  if (o.kind !== OUTCOME_KIND) p.push(`kind must be ${OUTCOME_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  const h = o.header;
  if (!obj(h) || !Array.isArray(o.outcomes)) return [...p, "header must be an object and outcomes an array"];
  keysExactly(h, ["sessionDate", "horizon", "sessions", "endDate", "ruleVersion", "protocol", "engine", "source", "calendar", "archives", "benchmark", "data", "generatedAt", "github", "outcomesSha256"], "header", p);
  if (!isDate(h.sessionDate)) p.push("header.sessionDate must be a real date");
  if (!Number.isInteger(h.horizon) || !OD1_STORED_HORIZONS.includes(h.horizon)) p.push(`header.horizon must be one of the sealed stored horizons ${OD1_STORED_HORIZONS.join(", ")}`);
  const sessions: unknown[] = Array.isArray(h.sessions) ? h.sessions : [];
  if (sessions.length !== h.horizon || !sessions.every(isDate) || sessions.some((s, i) => i > 0 && !((s as string) > (sessions[i - 1] as string))) || !((sessions[0] as string) > h.sessionDate)) p.push("header.sessions must be the h ascending trading sessions after the session date");
  if (h.endDate !== sessions[sessions.length - 1]) p.push("header.endDate must be the last session");
  if (!RULE.test(String(h.ruleVersion))) p.push("header.ruleVersion must be mv<N>-<8 hex>");
  if (!obj(h.protocol) || h.protocol.id !== "od1" || h.protocol.definitionsSha256 !== ctx.definitionsSha256) p.push("header.protocol must be od1 with the sealed definitionsSha256");
  if (!obj(h.engine) || !ENGINE.test(String(h.engine.version)) || !Array.isArray(h.engine.files) || h.engine.files.some((f: any) => !obj(f) || typeof f.path !== "string" || !HEX64.test(String(f.sha256)))) p.push("header.engine must name an od1e-<8 hex> version and its file hashes");
  else if (engineVersionOf(h.engine.files, ctx.definitionsSha256) !== h.engine.version) p.push("header.engine.version does not match its file hashes and protocol");
  const s = h.source;
  if (!obj(s) || typeof s.dailyFile !== "string" || !HEX64.test(String(s.dailyFileSha256)) || !HEX64.test(String(s.predictionsSha256)) || !Number.isInteger(s.predictionCount) || !obj(s.receipt) || s.receipt.class !== "live" || !HEX64.test(String(s.receipt.fileSha256)) || typeof s.receipt.file !== "string") p.push("header.source provenance is incomplete (daily file + hashes, prediction count, live receipt + hash)");
  else if (!s.dailyFile.endsWith(`/${h.ruleVersion}/${h.sessionDate}.json`)) p.push("header.source.dailyFile does not name this session and rule version");
  if (!obj(h.calendar) || !obj(h.archives)) p.push("header.calendar and header.archives must be objects");
  else
    for (const d of sessions as string[]) {
      if (h.calendar[d] !== "trading") p.push(`header.calendar: session ${d} is not recorded as trading`);
      if (!obj(h.archives[d]) || h.archives[d].index !== "ok" || h.archives[d].stocks !== "ok") p.push(`header.archives: session ${d} archives are not recorded as ok`);
    }
  if (!obj(h.benchmark) || h.benchmark.slug !== "nifty500" || !isNum(h.benchmark.closeT) || !isNum(h.benchmark.closeTh) || h.benchmark.closeT <= 0 || h.benchmark.closeTh <= 0) p.push("header.benchmark must hold positive NIFTY 500 closes at t and t+h");
  if (!obj(h.data) || !HEX40.test(String(h.data.commit)) || !Array.isArray(h.data.files) || h.data.files.length === 0 || h.data.files.some((f: any) => !obj(f) || typeof f.name !== "string" || !HEX64.test(String(f.sha256)))) p.push("header.data provenance must name the data commit (40 hex) and file hashes");
  if (!isIso(h.generatedAt)) p.push("header.generatedAt must be an ISO time");
  if (!obj(h.github) || !["runId", "runAttempt", "sha"].every((k) => k in h.github)) p.push("header.github must record runId, runAttempt and sha (null allowed)");
  if (h.outcomesSha256 !== sha256Canonical(o.outcomes)) p.push("header.outcomesSha256 does not match the outcomes");
  if (obj(s) && s.predictionCount !== o.outcomes.length) p.push(`header.source.predictionCount ${s?.predictionCount} != ${o.outcomes.length} outcomes`);
  const seen = new Set<string>();
  let prev = "";
  for (const e of o.outcomes as any[]) {
    const id = obj(e) ? e.predictionId : undefined;
    if (!obj(e)) {
      p.push("an outcome entry is not an object");
      continue;
    }
    keysExactly(e, ["predictionId", "symbol", "recordHash", "group", "frozen", "sigmaChanges", "bars", "outcome"], `outcome ${String(id)}`, p);
    if (seen.has(id)) p.push(`duplicate outcome for ${id}`);
    seen.add(id);
    if (id !== `${h.sessionDate}|${e.symbol}|${h.ruleVersion}`) p.push(`${e.symbol}: predictionId does not match the session, symbol and rule version`);
    if (typeof e.symbol === "string" && e.symbol.localeCompare(prev) < 0) p.push(`${e.symbol}: outcomes must be sorted by symbol`);
    prev = typeof e.symbol === "string" ? e.symbol : prev;
    if (!HEX64.test(String(e.recordHash))) p.push(`${e.symbol}: recordHash must be 64 hex`);
    if (e.group !== "gainer" && e.group !== "loser") p.push(`${e.symbol}: group must be gainer or loser`);
    if (!Array.isArray(e.bars) || e.bars.length !== h.horizon) {
      p.push(`${e.symbol}: bars must hold exactly ${h.horizon} entries (one per session, null = no bar)`);
      continue;
    }
    if (e.frozen?.sigma !== null && e.sigmaChanges && populationSd(e.sigmaChanges) !== e.frozen?.sigma) p.push(`${e.symbol}: the stored sigma window does not reproduce the frozen volatility20`);
    try {
      const again = od1Outcome(inputsOf(h as OutcomeHeader, e as OutcomeEntry));
      if (sha256Canonical(again) !== sha256Canonical(e.outcome)) p.push(`${e.symbol}: the stored outcome does not re-derive from its stored inputs (tampered or wrong engine)`);
    } catch (err) {
      p.push(`${e.symbol}: the stored inputs are invalid: ${String(err).slice(0, 120)}`);
    }
  }
  if (ctx.daily) {
    const d = ctx.daily;
    if (obj(s) && d.header.predictionsSha256 !== s.predictionsSha256) p.push("the record is not bound to this prediction file (predictionsSha256 differs)");
    if (d.header.sessionDate !== h.sessionDate || d.header.model.ruleVersion !== h.ruleVersion) p.push("the record's session or rule version differs from the prediction file");
    const byId = new Map((o.outcomes as any[]).filter(obj).map((e) => [e.predictionId, e]));
    for (const pr of d.predictions) {
      const e = byId.get(pr.predictionId);
      if (!e) {
        p.push(`${pr.symbol}: prediction has no outcome entry`);
        continue;
      }
      if (e.recordHash !== pr.recordHash) p.push(`${pr.symbol}: recordHash differs from the prediction record`);
      if (e.frozen?.sigma !== (pr.price.volatility20 ?? null)) p.push(`${pr.symbol}: frozen sigma differs from the prediction's volatility20`);
      if (e.frozen?.day?.high !== pr.bar.high || e.frozen?.day?.low !== pr.bar.low || e.frozen?.day?.close !== pr.bar.close) p.push(`${pr.symbol}: frozen day bar differs from the prediction record`);
      if (e.group !== (pr.price.changePct > 0 ? "gainer" : "loser")) p.push(`${pr.symbol}: group differs from the sign of the day's change`);
    }
    if (byId.size !== d.predictions.length) p.push("the record holds outcomes for predictions that are not in the prediction file");
  }
  return p;
}

/** Create-only at the schema level: identical content is `existing`, different content is a `conflict` (never overwrite). */
export function createOnlyDecision(existing: Pick<OutcomeRecord, "header"> | null, candidate: Pick<OutcomeRecord, "header">): "create" | "existing" | "conflict" {
  if (!existing) return "create";
  const same = (["sessionDate", "ruleVersion", "horizon"] as const).every((k) => existing.header[k] === candidate.header[k]);
  if (!same) throw new Error("createOnlyDecision: the two records are for different sessions, rule versions or horizons");
  return existing.header.outcomesSha256 === candidate.header.outcomesSha256 ? "existing" : "conflict";
}

// ---------------------------------------------------------------------------------------------------------------------
// Corrections (append-only; records are identified by their outcomesSha256)
// ---------------------------------------------------------------------------------------------------------------------
export const CORRECTION_REASONS = ["source-revised", "calendar-revised", "engine-defect", "other"] as const;
export interface OutcomeCorrection {
  kind: typeof OUTCOME_CORRECTION_KIND;
  schemaVersion: number;
  sessionDate: string;
  ruleVersion: string;
  horizon: number;
  /** 1 for the first correction of a record, then 2, 3, ... */
  sequence: number;
  /** outcomesSha256 of the record being superseded (the original, or the previous correction's replacement) */
  supersedes: string;
  /** outcomesSha256 of the new, separately stored record; the superseded record is never changed */
  replacement: string;
  reasonCode: (typeof CORRECTION_REASONS)[number];
  reason: string;
  recordedAt: string;
  recordedBy: string;
  /** how analysis treats a corrected session is an owner decision; nothing else is accepted in Phase B1 */
  analyticalTreatment: "pending-owner-decision";
}

export function validateOutcomeCorrection(o: unknown): string[] {
  const p: string[] = [];
  if (!obj(o)) return ["correction is not an object"];
  keysExactly(o, ["kind", "schemaVersion", "sessionDate", "ruleVersion", "horizon", "sequence", "supersedes", "replacement", "reasonCode", "reason", "recordedAt", "recordedBy", "analyticalTreatment"], "correction", p);
  if (o.kind !== OUTCOME_CORRECTION_KIND) p.push(`kind must be ${OUTCOME_CORRECTION_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  if (!isDate(o.sessionDate) || !RULE.test(String(o.ruleVersion)) || !OD1_STORED_HORIZONS.includes(o.horizon)) p.push("sessionDate, ruleVersion and horizon must identify a record");
  if (!Number.isInteger(o.sequence) || o.sequence < 1) p.push("sequence must be a positive integer");
  if (!HEX64.test(String(o.supersedes)) || !HEX64.test(String(o.replacement))) p.push("supersedes and replacement must be 64-hex outcome hashes");
  if (o.supersedes === o.replacement) p.push("a correction must replace a record with a DIFFERENT record");
  if (!CORRECTION_REASONS.includes(o.reasonCode)) p.push(`reasonCode must be one of ${CORRECTION_REASONS.join(", ")}`);
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (reason.length < 20 || reason.split(/\s+/).length < 4) p.push("reason must be a meaningful explanation (at least 20 characters and 4 words)");
  if (!isIso(o.recordedAt)) p.push("recordedAt must be an ISO time");
  if (typeof o.recordedBy !== "string" || o.recordedBy.trim().length < 2) p.push("recordedBy must attribute the correction");
  if (o.analyticalTreatment !== "pending-owner-decision") p.push('analyticalTreatment must be "pending-owner-decision" until the owner decides how corrections are analysed');
  return p;
}

/** The corrections of ONE record form a single unbroken chain starting at the original record's outcomesSha256. */
export function validateCorrectionChain(original: { sessionDate: string; ruleVersion: string; horizon: number; outcomesSha256: string }, corrections: OutcomeCorrection[]): string[] {
  const p: string[] = [];
  const sorted = [...corrections].sort((a, b) => a.sequence - b.sequence);
  let head = original.outcomesSha256;
  const seen = new Set<string>([head]);
  sorted.forEach((c, i) => {
    p.push(...validateOutcomeCorrection(c).map((x) => `correction ${c.sequence}: ${x}`));
    if (c.sessionDate !== original.sessionDate || c.ruleVersion !== original.ruleVersion || c.horizon !== original.horizon) p.push(`correction ${c.sequence}: names a different record`);
    if (c.sequence !== i + 1) p.push(`correction sequence must be 1..n without gaps or duplicates (found ${c.sequence} at position ${i + 1})`);
    if (c.supersedes !== head) p.push(`correction ${c.sequence}: supersedes ${c.supersedes.slice(0, 12)} but the current record is ${head.slice(0, 12)} (a fork or a silent replacement)`);
    if (seen.has(c.replacement)) p.push(`correction ${c.sequence}: replacement ${c.replacement.slice(0, 12)} was already used (a correction cannot restore an earlier record)`);
    seen.add(c.replacement);
    head = c.replacement;
  });
  return p;
}
