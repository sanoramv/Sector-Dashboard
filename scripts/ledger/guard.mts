/**
 * Read-only immutability guard (design §12.2). Only ADDITIONS of live daily files, receipts, corrections, protocol
 * records and exemptions are ever allowed: a modification, deletion, rename or type change of any existing file in a
 * protected path is a violation. The guard never writes anything.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ledgerPaths } from "./constants.mts";
import { exemptionTypeOf, validateDaily, validateExemption, validateReceipt, validateVersionRecord } from "./validate.mts";
import { checkReceiptStateConsistency, validateState, type DateRecord, type R6Event } from "./state.mts";
import { checkHoldoutTransition, checkProtocolIntegrity, type HoldoutFile, buildOd1File, od1DefinitionsSha256 } from "./protocol.mts";
import { scanForOutcomeLeaks, scanRepositoryForOutcomeLeaks, validateOutcomeReceiptTree } from "./outcome-receipts.mts";

export interface Violation {
  kind: "history" | "file" | "holdout" | "protocol" | "partial" | "receipt" | "state" | "exemption" | "version" | "exclusion" | "outcome";
  path: string;
  commit?: string;
  detail: string;
  /** history violations only: a valid, hash-bound historical acknowledgement exists. Reported, never silently green. */
  acknowledged?: boolean;
  /** the violation code from git (M, D, R, T) for history violations */
  code?: string;
}

export interface GuardGit {
  log(args: string[]): Promise<string>;
  show(rev: string, file: string): Promise<string | null>;
  /** Resolves a revision expression such as `HEAD:path` to an object id, or null. */
  revParse(spec: string): Promise<string | null>;
  /**
   * true when the visible history may be incomplete: a shallow clone or a legacy `info/grafts` file. An error must also
   * be reported as true (fail closed). Replacement objects (`git replace --graft`) are ignored by `realGuardGit`.
   */
  isShallow(): Promise<boolean>;
}

const execFileAsync = promisify(execFile);
/** Every guard git call ignores replacement objects, so `git replace --graft` cannot hide or rewrite history. */
const run = (cmd: string, args: string[], opts: { cwd: string; maxBuffer?: number }) => execFileAsync(cmd, args, { ...opts, env: { ...process.env, GIT_NO_REPLACE_OBJECTS: "1" } });
export function realGuardGit(cwd: string): GuardGit {
  return {
    async log(args) {
      return (await run("git", ["log", ...args], { cwd, maxBuffer: 256 * 1024 * 1024 })).stdout;
    },
    async show(rev, file) {
      try {
        const rel = path.isAbsolute(file) ? path.relative(cwd, file) : file;
        return (await run("git", ["show", `${rev}:${rel.split(path.sep).join("/")}`], { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
      } catch {
        return null;
      }
    },
    async revParse(spec) {
      try {
        return (await run("git", ["rev-parse", "--verify", "--quiet", spec], { cwd })).stdout.trim() || null;
      } catch {
        return null;
      }
    },
    async isShallow() {
      try {
        if ((await run("git", ["rev-parse", "--is-shallow-repository"], { cwd })).stdout.trim() !== "false") return true;
        const grafts = path.resolve(cwd, (await run("git", ["rev-parse", "--git-path", "info/grafts"], { cwd })).stdout.trim());
        return await exists(grafts); // a legacy grafts file can cut history and cannot be disabled per command
      } catch {
        return true; // cannot tell: fail closed
      }
    },
  };
}

const protectedDirs = (root: string) => [`${root}/live`, `${root}/protocol`, `${root}/exemptions`];

/**
 * Paths whose records are immutable. No acknowledgement can ever make a change to one of these acceptable; at most it
 * records that the violation was seen (see `scanHistory`).
 */
export const isImmutablePath = (p: string, _root?: string): boolean => /(^|[\\/])(live|protocol|exemptions)[\\/]/.test(p) || /(^|[\\/])holdout\.json$/.test(p);

export interface HistoryAck {
  commit: string;
  items: { path: string; violation: string; beforeBlob: string | null; afterBlob: string | null }[];
}

/** A session (date) touched by a violation of its prediction, receipt or correction file. */
export function sessionOfPath(p: string): string | null {
  const m = p.replace(/\\/g, "/").match(/\/live\/(?:predictions\/[^/]+|receipts|corrections\/[^/]+)\/(\d{4}-\d{2}-\d{2})(?:\.v\d+)?\.json$/);
  return m ? m[1] : null;
}

/**
 * Every commit in the full history that modified, deleted, renamed or retyped a file under a protected path.
 * A violation is "acknowledged" ONLY by a valid historical acknowledgement that names the same commit and path and
 * whose recorded before/after blob hashes match the real history AND the file as it is now. That reports it without
 * silently greening it, and it never authorises a later change, never repairs anything, and never restores the session
 * to the live holdout (`excludedSessions`).
 */
export async function scanHistory(git: GuardGit, ledgerRoot: string, acks: ReadonlyMap<string, HistoryAck> = new Map()): Promise<Violation[]> {
  const out = await git.log(["--diff-filter=MDRT", "--name-status", "--format=@@%H", "--", ...protectedDirs(ledgerRoot)]);
  const violations: Violation[] = [];
  let sha = "";
  for (const line of out.split("\n")) {
    if (line.startsWith("@@")) sha = line.slice(2).trim();
    else if (line.trim()) {
      const [status, ...files] = line.split("\t");
      const code = status[0];
      const target = files[0] ?? "";
      const v: Violation = { kind: "history", commit: sha, path: files.join(" -> "), code, detail: `status ${status}: protected ledger files may only be added` };
      const item = acks.get(sha)?.items.find((i) => i.path === target && i.violation === code);
      if (item) {
        const before = await git.revParse(`${sha}^:${target}`);
        const after = code === "D" || code === "R" ? null : await git.revParse(`${sha}:${target}`);
        const now = await git.revParse(`HEAD:${target}`);
        const matches = before === item.beforeBlob && after === item.afterBlob && now === (code === "D" || code === "R" ? null : item.afterBlob);
        if (matches) {
          v.acknowledged = true;
          v.detail += " - ACKNOWLEDGED by an exemption record (reported, not repaired; the session stays excluded from the live holdout)";
        } else v.detail += " (an acknowledgement exists for this commit but its recorded hashes do not match the real history or the current file)";
      }
      violations.push(v);
    }
  }
  return violations;
}

export async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const norm = (f: string) => f.split(path.sep).join("/");

export async function validateDailyFile(f: string): Promise<Violation[]> {
  const m = norm(f).match(/predictions\/([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (!m) return [{ kind: "file", path: f, detail: "unexpected file name under live/predictions" }];
  try {
    return validateDaily(JSON.parse(await readFile(f, "utf-8")), { date: m[2], ruleVersion: m[1] }).map((detail) => ({ kind: "file" as const, path: f, detail }));
  } catch (err) {
    return [{ kind: "file", path: f, detail: `not valid JSON: ${String(err)}` }];
  }
}

export async function validateReceiptFile(f: string, ledgerRoot: string): Promise<Violation[]> {
  const m = norm(f).match(/receipts\/(\d{4}-\d{2}-\d{2})\.json$/);
  if (!m) return [{ kind: "receipt", path: f, detail: "unexpected file name under live/receipts" }];
  try {
    const r = JSON.parse(await readFile(f, "utf-8")) as { ruleVersion?: string };
    const dailyText = typeof r.ruleVersion === "string" && /^mv\d+-[0-9a-f]{8}$/.test(r.ruleVersion) ? await readFile(ledgerPaths(ledgerRoot).dailyFile(r.ruleVersion, m[1]), "utf-8").catch(() => null) : null;
    return validateReceipt(r, { date: m[1], dailyText }).map((detail) => ({ kind: "receipt" as const, path: f, detail }));
  } catch (err) {
    return [{ kind: "receipt", path: f, detail: `not valid JSON: ${String(err)}` }];
  }
}

/** Class of every parseable receipt in the tree (invalid receipts are reported by validateReceiptFile). */
async function readReceiptClasses(ledgerRoot: string): Promise<Map<string, "live" | "live-late">> {
  const out = new Map<string, "live" | "live-late">();
  for (const f of (await walk(`${ledgerRoot}/live/receipts`)).filter((x) => x.endsWith(".json"))) {
    const m = norm(f).match(/receipts\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    try {
      const r = JSON.parse(await readFile(f, "utf-8")) as { class?: string };
      if (r.class === "live" || r.class === "live-late") out.set(m[1], r.class);
    } catch {
      /* reported elsewhere */
    }
  }
  return out;
}

export async function validateStateFile(f: string): Promise<Violation[]> {
  let text: string;
  try {
    text = await readFile(f, "utf-8");
  } catch {
    return []; // no state file yet
  }
  try {
    const obj = JSON.parse(text);
    const problems = validateState(obj, Buffer.byteLength(text));
    if (problems.length === 0) problems.push(...checkReceiptStateConsistency(obj, await readReceiptClasses(path.dirname(f))));
    return problems.map((detail) => ({ kind: "state" as const, path: f, detail }));
  } catch (err) {
    return [{ kind: "state", path: f, detail: `not valid JSON: ${String(err)}` }];
  }
}

/** Validates every file currently in the tree: daily schema/hashes, receipts, state, no leftover partials, protocol integrity. */
export async function validateTree(ledgerRoot: string): Promise<Violation[]> {
  const v: Violation[] = [];
  const paths = ledgerPaths(ledgerRoot);
  for (const f of await walk(ledgerRoot)) if (f.endsWith(".partial")) v.push({ kind: "partial", path: f, detail: "leftover partial file" });
  for (const f of (await walk(`${ledgerRoot}/live/predictions`)).filter((x) => x.endsWith(".json"))) v.push(...(await validateDailyFile(f)));
  for (const f of (await walk(`${ledgerRoot}/live/receipts`)).filter((x) => x.endsWith(".json"))) v.push(...(await validateReceiptFile(f, ledgerRoot)));
  v.push(...(await validateStateFile(paths.state)));
  let od1: ReturnType<typeof buildOd1File> | null = null;
  let holdout: HoldoutFile | null = null;
  try {
    od1 = JSON.parse(await readFile(paths.protocolOd1, "utf-8"));
  } catch {
    /* reported below */
  }
  try {
    holdout = JSON.parse(await readFile(paths.holdout, "utf-8"));
  } catch {
    /* reported below */
  }
  for (const p of checkProtocolIntegrity(od1, holdout)) v.push({ kind: "protocol", path: paths.protocolOd1, detail: p });
  v.push(...(await checkOutcomeConfidentiality(ledgerRoot)));
  return v;
}

/**
 * Phase B2a (erratum 22): public outcome receipts are hash-only and add-only (they live under live/), and no protected
 * outcome record, private correction, salt or unsalted outcome hash may exist anywhere in the public tree. With
 * `eligible`, a receipt for a session that is not eligible for the live holdout is a violation.
 */
export async function checkOutcomeConfidentiality(ledgerRoot: string, eligible?: ReadonlySet<string>): Promise<Violation[]> {
  const abs = path.resolve(ledgerRoot);
  const v: Violation[] = (await validateOutcomeReceiptTree(abs, { definitionsSha256: od1DefinitionsSha256(), eligible })).map((x) => ({ kind: "outcome" as const, path: path.join(ledgerRoot, x.path), detail: x.detail }));
  if (eligible) return v;
  // The real ledger: scan the WHOLE repository (index + working tree), since anything committed anywhere is public.
  // Any other root (test fixtures): scan that directory tree.
  const leaks = abs.endsWith(path.join("public", "data", "ledger")) ? await scanRepositoryForOutcomeLeaks(path.dirname(path.dirname(path.dirname(abs)))) : await scanForOutcomeLeaks([abs]);
  for (const x of leaks) v.push({ kind: "outcome", path: x.path, detail: x.detail });
  return v;
}

/** holdout.json may only change by the sealed -> unblinded transition. */
export async function checkHoldoutHistory(git: GuardGit, ledgerRoot: string): Promise<Violation[]> {
  const file = ledgerPaths(ledgerRoot).holdout;
  const shas = (await git.log(["--reverse", "--format=%H", "--", file])).split("\n").filter(Boolean);
  const v: Violation[] = [];
  let prev: HoldoutFile | null = null;
  for (const sha of shas) {
    const text = await git.show(sha, file);
    if (text === null) {
      v.push({ kind: "holdout", path: file, commit: sha, detail: "holdout.json deleted" });
      continue;
    }
    const next = JSON.parse(text) as HoldoutFile;
    for (const d of checkHoldoutTransition(prev, next)) v.push({ kind: "holdout", path: file, commit: sha, detail: d });
    prev = next;
  }
  return v;
}

export interface ExemptionLoad {
  history: Map<string, HistoryAck>;
  sourceRevision: { sessionDate: string; ruleVersion: string; predictionsSha256: string; file: string }[];
  r6Reviews: R6Review[];
  problems: Violation[];
}

/** A create-only decision that an R6 anomaly was looked at. It is bound to ONE anomaly (both digests). */
export interface R6Review {
  sessionDate: string;
  ruleVersion: string;
  existingPredictionsSha256: string;
  candidatePredictionsSha256: string;
  file: string;
}

export async function loadExemptions(ledgerRoot: string): Promise<ExemptionLoad> {
  const dir = `${ledgerRoot}/exemptions`;
  const out: ExemptionLoad = { history: new Map(), sourceRevision: [], r6Reviews: [], problems: [] };
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    const file = path.join(dir, name);
    let obj: any = null;
    try {
      obj = JSON.parse(await readFile(file, "utf-8"));
    } catch (err) {
      out.problems.push({ kind: "exemption", path: file, detail: `not valid JSON: ${String(err)}` });
      continue;
    }
    const errs = validateExemption(name, obj);
    if (errs.length) {
      for (const e of errs) out.problems.push({ kind: "exemption", path: file, detail: e });
      continue;
    }
    const type = exemptionTypeOf(name);
    if (type === "history") out.history.set(obj.commit, { commit: obj.commit, items: obj.items });
    else if (type === "r6-review") out.r6Reviews.push({ sessionDate: obj.sessionDate, ruleVersion: obj.ruleVersion, existingPredictionsSha256: obj.existingPredictionsSha256, candidatePredictionsSha256: obj.candidatePredictionsSha256, file });
    else out.sourceRevision.push({ sessionDate: obj.sessionDate, ruleVersion: obj.ruleVersion, predictionsSha256: obj.predictionsSha256, file });
  }
  return out;
}

/** Version (enable) records: strict schema, and enabledFrom later than the latest market date in the commit that introduced the record. */
export async function validateVersionRecords(git: GuardGit, ledgerRoot: string): Promise<Violation[]> {
  const v: Violation[] = [];
  const paths = ledgerPaths(ledgerRoot);
  let names: string[] = [];
  try {
    names = (await readdir(paths.versionsDir)).filter((n) => !n.endsWith(".partial"));
  } catch {
    return v;
  }
  const manifestFile = `${path.posix.dirname(ledgerRoot.split(path.sep).join("/"))}/manifest.json`;
  for (const name of names.sort()) {
    const file = path.join(paths.versionsDir, name);
    let obj: any;
    try {
      obj = JSON.parse(await readFile(file, "utf-8"));
    } catch (err) {
      v.push({ kind: "version", path: file, detail: `not valid JSON: ${String(err)}` });
      continue;
    }
    const errs = validateVersionRecord(name, obj);
    for (const e of errs) v.push({ kind: "version", path: file, detail: e });
    if (errs.length) continue;
    const adding = (await git.log(["--diff-filter=A", "--format=%H", "--", file])).split("\n").filter(Boolean);
    const commit = adding[adding.length - 1];
    if (!commit) {
      v.push({ kind: "version", path: file, detail: "the version record is not in Git history, so the market data it was enabled against cannot be established" });
      continue;
    }
    const text = await git.show(commit, manifestFile);
    let latest: string | null = null;
    try {
      latest = text ? (JSON.parse(text) as { latestMarketDate?: string }).latestMarketDate ?? null : null;
    } catch {
      latest = null;
    }
    // The PARENT commit's manifest counts too: a record cannot be validated by rewinding the manifest in the same commit.
    let parentLatest: string | null = null;
    try {
      const pt = await git.show(`${commit}^`, manifestFile);
      parentLatest = pt ? (JSON.parse(pt) as { latestMarketDate?: string }).latestMarketDate ?? null : null;
    } catch {
      parentLatest = null;
    }
    if (!latest) v.push({ kind: "version", path: file, commit, detail: `the latest market date at the commit that introduced this record cannot be established (${manifestFile} missing or unreadable)` });
    else {
      const newest = parentLatest && parentLatest > latest ? parentLatest : latest;
      if (!(obj.enabledFrom > newest)) v.push({ kind: "version", path: file, commit, detail: `enabledFrom ${obj.enabledFrom} is not later than the latest market date ${newest} (${newest === latest ? "in the commit that introduced the record" : "in the parent commit, i.e. before the record's own commit rewound the manifest"}); backdated, would back-capture history` });
    }
  }
  return v;
}

/** R6 review decisions that are valid AND bound to the real prediction record on disk. Used by the gate and the guard. */
export async function loadValidR6Reviews(ledgerRoot: string): Promise<{ valid: R6Review[]; problems: Violation[] }> {
  const ex = await loadExemptions(ledgerRoot);
  const valid: R6Review[] = [];
  const problems: Violation[] = []; // schema problems are reported by runGuard from loadExemptions; these are binding problems
  for (const r of ex.r6Reviews) {
    let sha: string | null = null;
    try {
      sha = (JSON.parse(await readFile(ledgerPaths(ledgerRoot).dailyFile(r.ruleVersion, r.sessionDate), "utf-8")) as { header: { predictionsSha256: string } }).header.predictionsSha256;
    } catch {
      sha = null;
    }
    if (sha === null) problems.push({ kind: "exemption", path: r.file, detail: "the prediction record this review decision names does not exist or is unreadable" });
    else if (sha !== r.existingPredictionsSha256) problems.push({ kind: "exemption", path: r.file, detail: "existingPredictionsSha256 does not match the prediction record: a review decision cannot refer to a different record" });
    else valid.push(r);
  }
  return { valid, problems };
}

export interface SessionEligibility {
  date: string;
  ruleVersion: string;
  eligible: boolean;
  reasons: string[];
}

/**
 * THE rule for which sessions may enter live-holdout evaluation. A session is eligible only if:
 *  - its daily record and its receipt are valid and the receipt class is `live`;
 *  - none of its immutable files (prediction, receipt, correction) was ever modified, deleted or renamed - whether or not
 *    a historical acknowledgement exists;
 *  - its state record is not in `anomaly` (a review decision does not change this) and is not `source-revised`
 *    unless a valid source-revision acceptance is bound to the record.
 * Acknowledging a violation or reviewing an anomaly changes how loudly it is reported, never eligibility.
 */
export async function computeLiveHoldout(git: GuardGit, ledgerRoot: string, history?: ExclusionHistory): Promise<{ sessions: SessionEligibility[]; eligible: string[] }> {
  const paths = ledgerPaths(ledgerRoot);
  const hist = history ?? (await loadExclusionHistory(git, ledgerRoot));
  const touched = new Set((await scanHistory(git, ledgerRoot)).map((h) => sessionOfPath(h.path.split(" -> ")[0])).filter((x): x is string => !!x));
  const ex = await loadExemptions(ledgerRoot);
  let state: { dates?: Record<string, { status?: string; r6Events?: { status: string }[] }> } = {};
  try {
    state = JSON.parse(await readFile(paths.state, "utf-8"));
  } catch {
    state = {};
  }
  const sessions: SessionEligibility[] = [];
  for (const f of (await walk(`${ledgerRoot}/live/predictions`)).filter((x) => x.endsWith(".json"))) {
    const m = norm(f).match(/predictions\/([^/]+)\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const [, ruleVersion, date] = m;
    const reasons: string[] = [];
    if ((await validateDailyFile(f)).length) reasons.push("the prediction record is invalid");
    const receiptFile = paths.receiptFile(date);
    let cls: string | null = null;
    try {
      cls = (JSON.parse(await readFile(receiptFile, "utf-8")) as { class?: string }).class ?? null;
    } catch {
      cls = null;
    }
    if (cls === null) reasons.push("no receipt, so the record is not proven live");
    else if ((await validateReceiptFile(receiptFile, ledgerRoot)).length) reasons.push("the receipt is invalid");
    else if (cls !== "live") reasons.push(`the receipt class is "${cls}", not "live"`);
    if (touched.has(date)) reasons.push("an immutable record of this session was modified, deleted or renamed (acknowledged or not)");
    const rec = state.dates?.[date];
    if (rec?.status === "anomaly" || rec?.r6Events?.some((e) => e.status === "anomaly")) reasons.push("the session has an R6 anomaly (a review decision does not restore it)");
    // Durable exclusion (erratum 20): an anomaly in ANY committed ledger-state.json excludes the session for good, even
    // if the current file no longer shows it. Without complete history no exclusion can be ruled out: nothing is eligible.
    if (hist.anomalies.has(date)) reasons.push("the session was recorded as an anomaly in the committed history of ledger-state.json (permanent)");
    if (!hist.complete) reasons.push("the committed history of ledger-state.json is incomplete or invalid, so historical exclusions cannot be ruled out");
    if (rec?.status === "source-revised") {
      const sha = (() => {
        try {
          return (JSON.parse(readFileSync(f, "utf-8")) as { header: { predictionsSha256: string } }).header.predictionsSha256;
        } catch {
          return null;
        }
      })();
      if (!ex.sourceRevision.some((a) => a.sessionDate === date && a.ruleVersion === ruleVersion && a.predictionsSha256 === sha)) reasons.push("source data changed after capture and no valid source-revision acceptance exists");
    }
    sessions.push({ date, ruleVersion, eligible: reasons.length === 0, reasons });
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.ruleVersion.localeCompare(b.ruleVersion));
  return { sessions, eligible: sessions.filter((s) => s.eligible).map((s) => s.date) };
}

// ---------------------------------------------------------------------------------------------------------------
// Durable exclusions (design erratum 20). ledger-state.json is mutable, so the guard does not trust its CURRENT content
// alone: it reads EVERY committed version of the file (path-limited history, merges included), validates each one
// structurally and collects every date that was ever anomalous. The current file must still show each of those dates as
// anomalous, with its first anomaly event unchanged. Shallow, missing, unreadable or invalid history fails closed.
// ---------------------------------------------------------------------------------------------------------------

export interface HistoricalAnomaly {
  date: string;
  /** first commit (in history order) whose ledger-state.json shows the date as anomalous */
  firstSeenCommit: string;
  /** the earliest anomaly event recorded for the date in any committed version (null when only the status says anomaly) */
  firstAnomalyEvent: R6Event | null;
}

export interface ExclusionHistory {
  /** false when the history could not be read completely and validly: no exclusion can then be ruled out */
  complete: boolean;
  problems: Violation[];
  anomalies: Map<string, HistoricalAnomaly>;
  versionsChecked: number;
}

type StateDates = Record<string, Partial<DateRecord>>;
const isAnomalous = (r: Partial<DateRecord> | undefined): boolean => !!r && (r.status === "anomaly" || r.r6?.status === "anomaly" || (r.r6Events ?? []).some((e) => e.status === "anomaly"));
const firstAnomalyEventOf = (r: Partial<DateRecord> | undefined): R6Event | null => (r?.r6Events ?? []).find((e) => e.status === "anomaly") ?? null;
const sameEvent = (a: R6Event, b: R6Event) => canonicalEvent(a) === canonicalEvent(b);
const canonicalEvent = (e: R6Event) => JSON.stringify([e.at, e.status, e.reasonCode ?? null, e.existingPredictionsSha256, e.candidatePredictionsSha256, e.detail]);

/** Reads and validates every committed version of ledger-state.json and collects every date that was ever anomalous. */
export async function loadExclusionHistory(git: GuardGit, ledgerRoot: string): Promise<ExclusionHistory> {
  const paths = ledgerPaths(ledgerRoot);
  const problems: Violation[] = [];
  const anomalies = new Map<string, HistoricalAnomaly>();
  const fail = (detail: string, commit?: string) => problems.push({ kind: "exclusion", path: paths.state, ...(commit ? { commit } : {}), detail });
  let shallow = true;
  try {
    shallow = await git.isShallow();
  } catch {
    shallow = true;
  }
  if (shallow) fail("the Git history is shallow (or its depth cannot be determined): committed ledger states cannot all be checked, so historical exclusions cannot be ruled out");
  // Every version, oldest first. -m lists a merge once per parent (deduplicated below); --full-history keeps all of them.
  let log = "";
  try {
    log = await git.log(["--format=@@%H", "-m", "--full-history", "--reverse", "--", paths.state]);
  } catch (err) {
    fail(`the history of ledger-state.json cannot be read: ${String(err).slice(0, 160)}`);
  }
  const shas = [...new Set(log.split("\n").filter((l) => l.startsWith("@@")).map((l) => l.slice(2).trim()))];
  for (const sha of shas) {
    const text = await git.show(sha, paths.state);
    if (text === null) {
      fail("a committed version of ledger-state.json is missing or was deleted; the history is incomplete", sha);
      continue;
    }
    let obj: { dates?: StateDates };
    try {
      obj = JSON.parse(text);
    } catch (err) {
      fail(`a committed version of ledger-state.json is not valid JSON: ${String(err).slice(0, 120)}`, sha);
      continue;
    }
    const invalid = validateState(obj, Buffer.byteLength(text));
    if (invalid.length) {
      fail(`a committed version of ledger-state.json is invalid: ${invalid.slice(0, 3).join("; ")}`, sha);
      continue;
    }
    for (const [date, rec] of Object.entries(obj.dates ?? {})) {
      if (!isAnomalous(rec)) continue;
      const ev = firstAnomalyEventOf(rec);
      const known = anomalies.get(date);
      if (!known) anomalies.set(date, { date, firstSeenCommit: sha, firstAnomalyEvent: ev });
      else if (ev && (!known.firstAnomalyEvent || ev.at < known.firstAnomalyEvent.at)) known.firstAnomalyEvent = ev;
    }
  }
  // The history must reach back past every enabling record (a truncated or grafted history would not).
  let versionFiles: string[] = [];
  try {
    versionFiles = (await readdir(paths.versionsDir)).filter((n) => n.endsWith(".json"));
  } catch {
    versionFiles = [];
  }
  for (const name of versionFiles) {
    const file = path.join(paths.versionsDir, name);
    let added = "";
    try {
      added = (await git.log(["--diff-filter=A", "--format=%H", "--", file])).trim();
    } catch {
      added = "";
    }
    if (!added) fail(`the Git history does not contain the commit that added the enabling record ${name}; the history is truncated or unavailable`);
  }
  if (versionFiles.length > 0 && shas.length === 0 && (await exists(paths.state))) fail("a rule version is enabled and ledger-state.json exists, but it has no committed history");
  return { complete: problems.length === 0, problems, anomalies, versionsChecked: shas.length };
}

/** Compares a ledger-state.json (the current file, or a pending one) with the anomalies recorded in committed history. */
export function compareWithExclusionHistory(hist: ExclusionHistory, current: { dates?: StateDates } | null, file: string): Violation[] {
  const v: Violation[] = [];
  if (hist.anomalies.size === 0) return v;
  if (!current) return [{ kind: "exclusion", path: file, detail: `ledger-state.json is missing or unreadable although committed history records anomalies for ${[...hist.anomalies.keys()].sort().join(", ")}; a reset cannot restore eligibility` }];
  for (const a of [...hist.anomalies.values()].sort((x, y) => x.date.localeCompare(y.date))) {
    const rec = current.dates?.[a.date];
    if (!rec) v.push({ kind: "exclusion", path: file, detail: `${a.date}: the date was anomalous in committed history (${a.firstSeenCommit.slice(0, 10)}) but is missing from ledger-state.json` });
    else if (rec.status !== "anomaly") v.push({ kind: "exclusion", path: file, detail: `${a.date}: the date was anomalous in committed history (${a.firstSeenCommit.slice(0, 10)}) but its status is now "${String(rec.status)}"; an anomaly can never be downgraded` });
    if (rec && a.firstAnomalyEvent && !(rec.r6Events ?? []).some((e) => sameEvent(e, a.firstAnomalyEvent!))) v.push({ kind: "exclusion", path: file, detail: `${a.date}: the first anomaly event (${a.firstAnomalyEvent.at}) recorded in committed history is missing or was rewritten in r6Events` });
  }
  return v;
}

/** Guard check: the committed history is complete and the current state still shows every historical anomaly. */
export async function checkExclusionHistory(git: GuardGit, ledgerRoot: string, history?: ExclusionHistory): Promise<Violation[]> {
  const hist = history ?? (await loadExclusionHistory(git, ledgerRoot));
  const file = ledgerPaths(ledgerRoot).state;
  let current: { dates?: StateDates } | null = null;
  try {
    current = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    current = null;
  }
  return [...hist.problems, ...compareWithExclusionHistory(hist, current, file)];
}

export interface GuardResult {
  /** red: unacknowledged or non-history violations */
  violations: Violation[];
  /** history violations with a matching, hash-bound acknowledgement: reported, not red */
  acknowledged: Violation[];
  historyAcknowledgements: string[];
  sourceRevisionAcceptances: string[];
  /** sessions that can never count as live because an immutable record of theirs was changed (acknowledged or not) */
  excludedSessions: string[];
  r6Reviews: string[];
  /** the live-holdout eligibility of every captured session */
  holdout: { eligible: string[]; excluded: SessionEligibility[] };
}

export async function runGuard(git: GuardGit, ledgerRoot: string): Promise<GuardResult> {
  const ex = await loadExemptions(ledgerRoot);
  const history = await scanHistory(git, ledgerRoot, ex.history);
  const excluded = new Set(history.map((h) => sessionOfPath(h.path.split(" -> ")[0])).filter((x): x is string => !!x));
  // A source-revision acceptance must match the record it names and can never cover a session whose record was changed.
  const accepted: string[] = [];
  const srProblems: Violation[] = [];
  for (const a of ex.sourceRevision) {
    const file = ledgerPaths(ledgerRoot).dailyFile(a.ruleVersion, a.sessionDate);
    let sha: string | null = null;
    try {
      sha = (JSON.parse(await readFile(file, "utf-8")) as { header: { predictionsSha256: string } }).header.predictionsSha256;
    } catch {
      sha = null;
    }
    if (sha === null) srProblems.push({ kind: "exemption", path: a.file, detail: "the prediction record this source-revision acceptance names does not exist or is unreadable" });
    else if (sha !== a.predictionsSha256) srProblems.push({ kind: "exemption", path: a.file, detail: "predictionsSha256 does not match the prediction record: an acceptance cannot conceal a modification" });
    else if (excluded.has(a.sessionDate)) srProblems.push({ kind: "exemption", path: a.file, detail: `session ${a.sessionDate} has a violation of its immutable records; a source-revision acceptance cannot restore it` });
    else accepted.push(`${a.sessionDate}:${a.ruleVersion}`);
  }
  const reviews = await loadValidR6Reviews(ledgerRoot);
  const exclusionHistory = await loadExclusionHistory(git, ledgerRoot);
  const holdout = await computeLiveHoldout(git, ledgerRoot, exclusionHistory);
  const holdoutProblems: Violation[] = [];
  try {
    const h = JSON.parse(await readFile(ledgerPaths(ledgerRoot).holdout, "utf-8")) as { status?: string; unblinded?: { completedLiveSessions?: number } | null };
    if (h.status === "unblinded" && (h.unblinded?.completedLiveSessions ?? 0) > holdout.eligible.length) holdoutProblems.push({ kind: "holdout", path: ledgerPaths(ledgerRoot).holdout, detail: `unblinding claims ${h.unblinded?.completedLiveSessions} completed live sessions but only ${holdout.eligible.length} sessions are eligible (sessions with integrity violations, anomalies or non-live receipts can never count)` });
  } catch {
    /* holdout.json problems are reported by validateTree / checkHoldoutHistory */
  }
  const rest = [...ex.problems, ...srProblems, ...reviews.problems, ...holdoutProblems, ...(await validateTree(ledgerRoot)), ...(await validateVersionRecords(git, ledgerRoot)), ...(await checkHoldoutHistory(git, ledgerRoot)), ...(await checkExclusionHistory(git, ledgerRoot, exclusionHistory)), ...(await checkOutcomeConfidentiality(ledgerRoot, new Set(holdout.eligible))).filter((x) => /not eligible/.test(x.detail))];
  return {
    violations: [...history.filter((h) => !h.acknowledged), ...rest],
    acknowledged: history.filter((h) => h.acknowledged),
    historyAcknowledgements: [...ex.history.keys()].sort(),
    sourceRevisionAcceptances: accepted.sort(),
    excludedSessions: [...excluded].sort(),
    r6Reviews: reviews.valid.map((r) => `${r.sessionDate}:${r.ruleVersion}:${r.candidatePredictionsSha256.slice(0, 12)}`).sort(),
    holdout: { eligible: holdout.eligible, excluded: holdout.sessions.filter((s) => !s.eligible) },
  };
}

export const exists = async (p: string): Promise<boolean> => stat(p).then(() => true, () => false);
