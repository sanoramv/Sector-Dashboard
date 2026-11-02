/** Structural and integrity validation of a daily file. Used by capture (before publication), the guard and the tests. */
import { sha256Canonical, sha256Hex } from "./canonical.mts";
import { DAILY_KIND, LEDGER_SCHEMA_VERSION, RECEIPT_KIND, SOURCE_LIVE } from "./constants.mts";

/** Outcome and filing fields are not part of the A1 schema (header.filings must be exactly null). */
const FORBIDDEN_KEYS = ["filings", "outcome", "outcomes", "forwardReturn", "mfe", "mae"];
const FORBIDDEN_IN_HEADER = FORBIDDEN_KEYS.filter((k) => k !== "filings");

export function validateDaily(obj: unknown, expect: { date?: string; ruleVersion?: string } = {}): string[] {
  const problems: string[] = [];
  const o = obj as { kind?: string; schemaVersion?: number; header?: Record<string, any>; predictions?: any[] } | null;
  if (!o || typeof o !== "object") return ["not an object"];
  if (o.kind !== DAILY_KIND) problems.push(`kind must be ${DAILY_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) problems.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  const h = o.header;
  if (!h || typeof h !== "object") return [...problems, "missing header"];
  if (!Array.isArray(o.predictions)) return [...problems, "predictions must be an array"];
  if (h.source !== SOURCE_LIVE) problems.push(`header.source must be ${SOURCE_LIVE}`);
  if (expect.date && h.sessionDate !== expect.date) problems.push(`header.sessionDate ${h.sessionDate} does not match ${expect.date}`);
  if (expect.ruleVersion && h.model?.ruleVersion !== expect.ruleVersion) problems.push(`header.model.ruleVersion ${h.model?.ruleVersion} does not match directory ${expect.ruleVersion}`);
  if (h.predictionCount !== o.predictions.length) problems.push(`predictionCount ${h.predictionCount} != ${o.predictions.length} predictions`);
  if (h.predictionsSha256 !== sha256Canonical(o.predictions)) problems.push("predictionsSha256 does not match the predictions");
  if (h.filings !== null && h.filings !== undefined) problems.push("filings must be null in A1");
  for (const k of FORBIDDEN_IN_HEADER) if (k in h) problems.push(`forbidden header key ${k}`);
  for (const k of FORBIDDEN_KEYS) if (o.predictions.some((p) => k in p)) problems.push(`forbidden prediction key ${k}`);
  for (const k of ["config", "sourceData", "inputDigest", "market", "lists", "readiness", "model", "generatedAt"]) if (!(k in h)) problems.push(`header.${k} is missing`);
  const seen = new Set<string>();
  const byList: Record<string, Map<number, string>> = { gainer: new Map(), loser: new Map(), volume: new Map() };
  for (const p of o.predictions) {
    if (seen.has(p.symbol)) problems.push(`duplicate symbol ${p.symbol}`);
    seen.add(p.symbol);
    if (p.date !== h.sessionDate) problems.push(`${p.symbol}: date mismatch`);
    if (p.predictionId !== `${h.sessionDate}|${p.symbol}|${h.model?.ruleVersion}`) problems.push(`${p.symbol}: bad predictionId`);
    const { recordHash, ...rest } = p;
    if (recordHash !== sha256Canonical(rest)) problems.push(`${p.symbol}: recordHash mismatch`);
    if (!Array.isArray(p.lists) || p.lists.length === 0) problems.push(`${p.symbol}: no list membership`);
    for (const l of p.lists ?? []) {
      if (!byList[l.list]) problems.push(`${p.symbol}: unknown list ${l.list}`);
      else byList[l.list].set(l.rank, p.symbol);
    }
  }
  for (const list of ["gainer", "loser", "volume"] as const) {
    const declared: string[] = h.lists?.[list] ?? [];
    declared.forEach((sym, i) => {
      if (byList[list].get(i + 1) !== sym) problems.push(`list ${list} rank ${i + 1} should be ${sym}`);
    });
    if (byList[list].size !== declared.length) problems.push(`list ${list} has ${byList[list].size} ranked records but header declares ${declared.length}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------------------------
// Receipts and exemptions
// ---------------------------------------------------------------------------------------------------------------

const HEX40 = /^[0-9a-f]{40}$/;
const iso = (x: unknown): number => (typeof x === "string" ? Date.parse(x) : NaN);

/** A receipt is valid only if it is complete, consistent with itself, and describes exactly the daily file it names. */
export function validateReceipt(r: unknown, ctx: { date: string; dailyText: string | null; ruleVersion?: string }): string[] {
  const p: string[] = [];
  const o = r as Record<string, any> | null;
  if (!o || typeof o !== "object") return ["receipt is not an object"];
  if (o.kind !== RECEIPT_KIND) p.push(`kind must be ${RECEIPT_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  if (o.sessionDate !== ctx.date) p.push(`sessionDate ${String(o.sessionDate)} does not match the file name ${ctx.date}`);
  if (typeof o.ruleVersion !== "string" || !/^mv\d+-[0-9a-f]{8}$/.test(o.ruleVersion)) p.push("ruleVersion is missing or malformed");
  if (o.class !== "live" && o.class !== "live-late") p.push(`class ${String(o.class)} is not live or live-late`);
  const expectedSuffix = `live/predictions/${String(o.ruleVersion)}/${ctx.date}.json`;
  if (typeof o.file !== "string" || !o.file.endsWith(expectedSuffix)) p.push(`file must end with ${expectedSuffix}`);
  if (typeof o.fileSha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.fileSha256)) p.push("fileSha256 is missing or malformed");
  const ev = o.evidence;
  const cutoff = iso(o.cutoff?.utc);
  if (Number.isNaN(cutoff)) p.push("cutoff.utc is missing or not a time");
  if (!ev || typeof ev !== "object") p.push("evidence is missing");
  else {
    const tPub = iso(ev.tPub);
    const tGen = iso(ev.tGen);
    const tCommit = iso(ev.tCommit);
    if (!ev.push || typeof ev.push !== "object") p.push("evidence.push (the activity event) is missing");
    else {
      if (iso(ev.push.timestamp) !== tPub) p.push("evidence.tPub does not equal the push event timestamp");
      for (const k of ["before", "after"]) if (typeof ev.push[k] !== "string" || !HEX40.test(ev.push[k])) p.push(`evidence.push.${k} is not a commit hash`);
      if (ev.push.id === undefined || ev.push.id === null || ev.push.id === "") p.push("evidence.push.id is missing");
    }
    if (typeof ev.commit !== "string" || !HEX40.test(ev.commit)) p.push("evidence.commit is not a commit hash");
    if (Number.isNaN(tPub) || Number.isNaN(tGen) || Number.isNaN(tCommit)) p.push("evidence times (tGen, tCommit, tPub) must all be present");
    else {
      if (tGen > tPub) p.push("contradictory evidence: tGen is after tPub");
      if (tCommit > tPub) p.push("contradictory evidence: tCommit is after tPub");
      if (!Number.isNaN(cutoff) && (o.class === "live") !== (tPub <= cutoff)) p.push(`class ${String(o.class)} contradicts tPub ${ev.tPub} against the cut-off ${o.cutoff?.utc}`);
    }
  }
  if (ctx.dailyText === null) p.push("the referenced daily prediction file does not exist");
  else {
    if (typeof o.fileSha256 === "string" && o.fileSha256 !== sha256Hex(ctx.dailyText)) p.push("fileSha256 does not match the referenced daily file");
    try {
      const d = JSON.parse(ctx.dailyText) as { header?: { sessionDate?: string; generatedAt?: string; model?: { ruleVersion?: string } } };
      if (d.header?.sessionDate !== ctx.date) p.push("the daily file's sessionDate differs from the receipt");
      if (d.header?.model?.ruleVersion !== o.ruleVersion) p.push("the daily file's ruleVersion differs from the receipt");
      if (ev && iso(d.header?.generatedAt) !== iso(ev.tGen)) p.push("evidence.tGen differs from the daily file's generatedAt");
    } catch {
      p.push("the referenced daily file is not valid JSON");
    }
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Acknowledgements (formerly "exemptions"). Two distinct types; neither can authorise changing an immutable record.
//   A. historical immutability acknowledgement   exemptions/<40-hex commit>.json
//   B. source-revision acceptance                exemptions/source-revision-<date>-<ruleVersion>.json
// ---------------------------------------------------------------------------------------------------------------
export const EXEMPTION_HISTORY_KIND = "momentum-ledger.exemption.history";
export const EXEMPTION_SOURCE_REVISION_KIND = "momentum-ledger.exemption.source-revision";
export const VERSION_KIND = "momentum-ledger.version";
const PLACEHOLDER = /^(n\/?a|none|todo|tbd|test|ok|fix|fixed|exempt|exemption|reason|-+|\.+)$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RV = /^mv\d+-[0-9a-f]{8}$/;
const realDate = (d: unknown): boolean => typeof d === "string" && DATE.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

function checkReason(o: Record<string, any>, p: string[]) {
  const reason = typeof o.reason === "string" ? o.reason.trim() : "";
  if (reason.length < 20 || reason.split(/\s+/).length < 4 || PLACEHOLDER.test(reason)) p.push("reason must be a meaningful explanation (at least 20 characters and 4 words)");
  if (Number.isNaN(iso(o.recordedAt))) p.push("recordedAt must be an ISO time");
}

export const R6_REVIEW_KIND = "momentum-ledger.r6-review";
export type ExemptionType = "history" | "source-revision" | "r6-review" | "invalid";
export const exemptionTypeOf = (name: string): ExemptionType =>
  HEX40.test(name.replace(/\.json$/, "")) && name.endsWith(".json")
    ? "history"
    : /^source-revision-\d{4}-\d{2}-\d{2}-mv\d+-[0-9a-f]{8}\.json$/.test(name)
      ? "source-revision"
      : /^r6-review-\d{4}-\d{2}-\d{2}-mv\d+-[0-9a-f]{8}-[0-9a-f]{12}\.json$/.test(name)
        ? "r6-review"
        : "invalid";

export function validateExemption(name: string, obj: unknown): string[] {
  const p: string[] = [];
  const type = exemptionTypeOf(name);
  if (type === "invalid") p.push(`file name must be <40-hex commit>.json (historical acknowledgement), source-revision-<date>-<ruleVersion>.json (source-revision acceptance) or r6-review-<date>-<ruleVersion>-<12 hex of the candidate digest>.json (R6 review decision); got ${name}`);
  const o = obj as Record<string, any> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return [...p, "acknowledgement must be a JSON object"];
  if (type === "history") {
    const sha = name.replace(/\.json$/, "");
    const allowed = ["kind", "schemaVersion", "commit", "items", "reason", "recordedAt", "recordedBy"];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`unknown key ${k}`);
    if (o.kind !== EXEMPTION_HISTORY_KIND) p.push(`kind must be ${EXEMPTION_HISTORY_KIND}`);
    if (o.commit !== sha) p.push("commit must equal the commit hash in the file name (an acknowledgement applies to exactly one commit)");
    if (!Array.isArray(o.items) || o.items.length === 0) p.push("items must list each affected path");
    else
      for (const it of o.items) {
        const keys = Object.keys(it ?? {}).sort().join(",");
        if (keys !== "afterBlob,beforeBlob,path,violation") p.push("each item needs exactly path, violation, beforeBlob, afterBlob");
        else {
          if (typeof it.path !== "string" || it.path.length === 0) p.push("item path is empty");
          if (!["M", "D", "R", "T"].includes(it.violation)) p.push(`item violation ${String(it.violation)} must be M, D, R or T`);
          for (const k of ["beforeBlob", "afterBlob"]) if (it[k] !== null && !HEX40.test(it[k])) p.push(`item ${k} must be a 40-hex blob hash or null`);
          if (["D", "R"].includes(it.violation) && it.afterBlob !== null) p.push("a deletion or rename has no afterBlob at the path");
          if (["M", "T"].includes(it.violation) && it.afterBlob === null) p.push("a modification needs the afterBlob");
          if (it.beforeBlob === null) p.push("beforeBlob (the record as it was) is required");
        }
      }
  } else if (type === "r6-review") {
    const m = name.match(/^r6-review-(\d{4}-\d{2}-\d{2})-(mv\d+-[0-9a-f]{8})-([0-9a-f]{12})\.json$/)!;
    const allowed = ["kind", "schemaVersion", "sessionDate", "ruleVersion", "existingPredictionsSha256", "candidatePredictionsSha256", "reason", "recordedAt", "recordedBy"];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`unknown key ${k}`);
    if (o.kind !== R6_REVIEW_KIND) p.push(`kind must be ${R6_REVIEW_KIND}`);
    if (o.sessionDate !== m[1] || !realDate(o.sessionDate)) p.push("sessionDate must equal the date in the file name");
    if (o.ruleVersion !== m[2]) p.push("ruleVersion must equal the rule version in the file name");
    for (const k of ["existingPredictionsSha256", "candidatePredictionsSha256"]) if (typeof o[k] !== "string" || !/^[0-9a-f]{64}$/.test(o[k])) p.push(`${k} must be a 64-hex digest (a review decision is bound to one specific anomaly)`);
    if (typeof o.candidatePredictionsSha256 === "string" && !o.candidatePredictionsSha256.startsWith(m[3])) p.push("the file name must carry the first 12 hex characters of candidatePredictionsSha256");
    if (o.existingPredictionsSha256 === o.candidatePredictionsSha256) p.push("a review decision is for a DIFFERENCE: the two digests are identical");
  } else if (type === "source-revision") {
    const m = name.match(/^source-revision-(\d{4}-\d{2}-\d{2})-(mv\d+-[0-9a-f]{8})\.json$/)!;
    const allowed = ["kind", "schemaVersion", "sessionDate", "ruleVersion", "predictionsSha256", "reason", "recordedAt", "recordedBy"];
    for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`unknown key ${k}`);
    if (o.kind !== EXEMPTION_SOURCE_REVISION_KIND) p.push(`kind must be ${EXEMPTION_SOURCE_REVISION_KIND}`);
    if (o.sessionDate !== m[1] || !realDate(o.sessionDate)) p.push("sessionDate must equal the date in the file name");
    if (o.ruleVersion !== m[2]) p.push("ruleVersion must equal the rule version in the file name");
    if (typeof o.predictionsSha256 !== "string" || !/^[0-9a-f]{64}$/.test(o.predictionsSha256)) p.push("predictionsSha256 must bind the acceptance to the prediction record (64 hex)");
  }
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  checkReason(o, p);
  return p;
}

/** Version (enable) record. `latestMarketDateAtEnable` is what the enabling tool saw; enabledFrom must be strictly later. */
export function validateVersionRecord(name: string, obj: unknown): string[] {
  const p: string[] = [];
  const o = obj as Record<string, any> | null;
  if (!o || typeof o !== "object" || Array.isArray(o)) return ["version record must be a JSON object"];
  const allowed = ["kind", "schemaVersion", "ruleVersion", "enabledFrom", "latestMarketDateAtEnable", "reason"];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) p.push(`unknown key ${k}`);
  for (const k of allowed) if (!(k in o)) p.push(`missing key ${k}`);
  if (o.kind !== VERSION_KIND) p.push(`kind must be ${VERSION_KIND}`);
  if (o.schemaVersion !== LEDGER_SCHEMA_VERSION) p.push(`schemaVersion must be ${LEDGER_SCHEMA_VERSION}`);
  if (typeof o.ruleVersion !== "string" || !RV.test(o.ruleVersion)) p.push("ruleVersion must look like mv<N>-<8 hex>");
  else if (name !== `${o.ruleVersion}.json`) p.push(`file name must be ${o.ruleVersion}.json`);
  if (!realDate(o.enabledFrom)) p.push("enabledFrom must be a real YYYY-MM-DD date");
  if (!realDate(o.latestMarketDateAtEnable)) p.push("latestMarketDateAtEnable must be a real YYYY-MM-DD date");
  if (realDate(o.enabledFrom) && realDate(o.latestMarketDateAtEnable) && !(o.enabledFrom > o.latestMarketDateAtEnable)) p.push(`enabledFrom ${o.enabledFrom} is not later than the latest market date ${o.latestMarketDateAtEnable} seen when it was enabled (backdated)`);
  if (typeof o.reason !== "string" || o.reason.trim().length === 0) p.push("reason must be a non-empty string");
  return p;
}
