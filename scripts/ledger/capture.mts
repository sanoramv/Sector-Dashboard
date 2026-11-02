/**
 * Daily live capture (design §6-§11). Reuses the application's own discovery - nothing here scores or classifies.
 * A date is either written completely (create-only) or not at all.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RawDataset } from "../../src/types/dataset.ts";
import type { ActivityRow } from "../../src/types/activity.ts";
import type { MomentumCandidate } from "../../src/types/momentum.ts";
import { prepareUniverse, type PreparedUniverse } from "../../src/lib/momentum/universe.ts";
import { discover, moversOn } from "../../src/lib/momentum/discovery.ts";
import { indexContextAt, marketContextAt } from "../../src/lib/momentum/market.ts";
import type { RefreshState } from "../lib/refresh-state.mts";
import { canonicalJson, sha256Canonical, sha256Hex } from "./canonical.mts";
import { buildEffectiveConfig, auditedSettings, cloneDefaultSettings, configForHash } from "./config.mts";
import { DAILY_KIND, EXPECTED_INDEX_SLUGS, LEDGER_SCHEMA_VERSION, POOL, READINESS, SOURCE_LIVE, TOKENIZER_ID, UNIVERSE_LIST_SLUGS, ledgerPaths } from "./constants.mts";
import { compareInputDigest, computeInputDigest, type DigestSource } from "./digest.mts";
import { createOnly, listFiles, readJsonIfExists } from "./files.mts";
import type { R6ReasonCode, R6UniverseEvidence } from "./state.mts";
import * as R from "./readiness.mts";
import { buildExcludedEvidence, buildPredictionRecord, type ListEntry, type PredictionRecord } from "./record.mts";
import { RULE_FILES, computeRuleVersion, hashRuleFiles, typescriptVersion, type RuleFileHash } from "./ruleVersion.mts";
import { validateDaily, validateVersionRecord } from "./validate.mts";

export interface CaptureSource {
  dataset: RawDataset;
  activity: Record<string, ActivityRow[]>;
  refreshState: RefreshState;
  files: { name: string; bytes: number; sha256: string }[];
}

export interface CaptureEnv {
  now: Date;
  /** GITHUB_* variables (undefined entries are recorded as null). */
  env: Record<string, string | undefined>;
  ledgerRoot: string;
  ruleVersion: string;
  ruleFiles: RuleFileHash[];
  enabledVersion: string | null;
  /** First session date that may be captured (from the enabling record); earlier dates are never captured. */
  enabledFrom: string | null;
}

export type SessionOutcome = "recorded" | "exists" | "waiting" | "blocked" | "anomaly" | "not-enabled";

export interface SessionResult {
  date: string;
  outcome: SessionOutcome;
  checks: R.CheckResult[];
  reasons: string[];
  file?: string;
  bytes?: number;
  warnings: string[];
  predictionCount?: number;
  /** R6 evidence for the mutable state; the daily record itself is never touched. */
  r6?: R6Evidence;
}

export interface R6Evidence {
  status: "pass" | "existing" | "existing-uncompared" | "anomaly";
  existingPredictionsSha256: string | null;
  candidatePredictionsSha256: string | null;
  detail: string;
  reasonCode?: R6ReasonCode;
  universe?: R6UniverseEvidence;
}

export type UniverseListIdentity = R6UniverseEvidence["stored"][number];

/**
 * Identity of EVERY constituent list in the dataset. The dashboard's universe code reads far more than the four main
 * lists: `prepareUniverse` loads the stock universe (nifty500, microcap250), the size segments (midcap150, smallcap250)
 * and the constituents of every sector index and context index (they decide a stock's sector index, stock-versus-sector
 * strength and sector breadth). So all keys present in `ds.constituents` are fingerprinted, in sorted key order;
 * a list that is added, removed or renamed between two evaluations changes the set of identities and is detected.
 *
 * `sha256` covers every field of each entry that can influence a prediction (the whole ConstituentRef: symbol, company
 * name, industry), with entries sorted by symbol, so key and entry order never matter. `symbolsSha256` covers the symbol
 * set alone, so a metadata-only change can be told apart from a membership change.
 */
export function universeListIdentity(ds: RawDataset): UniverseListIdentity[] {
  const bySymbol = (a: { symbol: string }, b: { symbol: string }) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  return Object.keys(ds.constituents)
    .sort()
    .map((slug) => {
      const entries = (ds.constituents[slug]?.constituents ?? []).map((c) => ({ symbol: c.symbol, companyName: c.companyName, industry: c.industry })).sort(bySymbol);
      return { slug, count: entries.length, sha256: sha256Canonical(entries), symbolsSha256: sha256Canonical(entries.map((e) => e.symbol)), fetchedAt: ds.constituents[slug]?.fetchedAt ?? null };
    });
}

/** Compares the lists stored in a record with the lists now. `changedLists` = lists whose CONTENT differs. */
export function compareUniverse(stored: UniverseListIdentity[], current: UniverseListIdentity[]): R6UniverseEvidence {
  const by = new Map(stored.map((l) => [l.slug, l]));
  const changed = current.filter((c) => by.get(c.slug)?.sha256 !== c.sha256);
  const changedLists = changed.map((c) => c.slug);
  const removed = stored.filter((s) => !current.some((c) => c.slug === s.slug)).map((s) => s.slug); // a list that disappeared (or was renamed away)
  changedLists.push(...removed);
  const symbolSetChangedLists = [...changed.filter((c) => by.get(c.slug)?.symbolsSha256 !== c.symbolsSha256).map((c) => c.slug), ...removed];
  const fetchedAtChanged = current.some((c) => (by.get(c.slug)?.fetchedAt ?? null) !== c.fetchedAt);
  return { stored, current, changedLists: [...new Set(changedLists)].sort(), symbolSetChangedLists: [...new Set(symbolSetChangedLists)].sort(), fetchedAtChanged };
}

export type ExistingDaily = { kind: "none" } | { kind: "valid"; predictionsSha256: string; universeLists: UniverseListIdentity[] } | { kind: "invalid"; problems: string[] };

/** Reads an existing daily file for R6. Anything that is not a complete, valid record is reported, never repaired. */
export async function readExistingDaily(file: string, expect: { date: string; ruleVersion: string }): Promise<ExistingDaily> {
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "invalid", problems: [`unreadable: ${String(err)}`] };
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    return { kind: "invalid", problems: [`not valid JSON (truncated or corrupt): ${String(err).slice(0, 120)}`] };
  }
  const problems = validateDaily(obj, expect);
  if (problems.length) return { kind: "invalid", problems: problems.slice(0, 5) };
  const h = (obj as { header: { predictionsSha256: string; sourceData?: { universe?: { lists?: UniverseListIdentity[] } } } }).header;
  return { kind: "valid", predictionsSha256: h.predictionsSha256, universeLists: h.sourceData?.universe?.lists ?? [] };
}

/**
 * R6 comparison: canonical prediction digests, never whole-file bytes (timestamps and runtime metadata always differ).
 * If the constituent lists changed CONTENT since the record was made, a different digest is expected and proves nothing:
 * the result is `existing-uncompared` (reason `constituent-lists-refreshed`), never a "different predictions" anomaly,
 * and never counted as a successful comparison. A fetch-time change alone (identical contents) does not excuse a mismatch.
 */
export function compareR6(existing: ExistingDaily, candidateSha: string | null, candidateNote: string | null, currentLists?: UniverseListIdentity[]): R6Evidence {
  if (existing.kind === "none") return { status: "pass", existingPredictionsSha256: null, candidatePredictionsSha256: candidateSha, detail: "No existing record for this date and rule version." };
  if (existing.kind === "invalid") return { status: "anomaly", existingPredictionsSha256: null, candidatePredictionsSha256: candidateSha, detail: `Existing record is invalid and was left untouched: ${existing.problems.join("; ")}` };
  const universe = currentLists ? compareUniverse(existing.universeLists, currentLists) : undefined;
  const base = { existingPredictionsSha256: existing.predictionsSha256, ...(universe ? { universe } : {}) };
  if (candidateSha !== null && existing.predictionsSha256 === candidateSha) return { status: "existing", ...base, candidatePredictionsSha256: candidateSha, detail: "Existing record has an identical prediction digest; nothing written." };
  if (universe && universe.changedLists.length > 0) {
    return { status: "existing-uncompared", ...base, candidatePredictionsSha256: candidateSha, reasonCode: "constituent-lists-refreshed", detail: `Existing valid record left untouched. The constituent lists changed since it was made (${universe.changedLists.join(", ")}; ${universe.symbolSetChangedLists.length ? `membership changed in ${universe.symbolSetChangedLists.join(", ")}` : "company name / industry labels only, the symbols are identical"}), so a different prediction digest is expected and the two cannot be compared. This is NOT a successful comparison.` };
  }
  if (candidateSha === null) return { status: "existing-uncompared", ...base, candidatePredictionsSha256: null, reasonCode: "inputs-not-ready", detail: `Existing valid record left untouched; a fresh candidate cannot be built now so the digests were not compared (${candidateNote ?? "inputs not ready"}).` };
  return { status: "anomaly", ...base, candidatePredictionsSha256: candidateSha, detail: "A fresh evaluation produces DIFFERENT predictions from the existing record while the constituent lists are unchanged. The record is immutable and was left untouched." };
}

const hasBarOn = (bars: { date: string }[] | undefined, date: string): boolean => !!bars && bars.some((b) => b.date === date);

/** Reads the published data files plus content digests of the four inputs. */
export async function loadSource(dataDir: string): Promise<CaptureSource> {
  const read = async (name: string) => {
    const buf = await readFile(path.join(dataDir, name));
    return { name, bytes: buf.length, sha256: sha256Hex(buf), json: JSON.parse(buf.toString("utf-8")) };
  };
  const [manifest, indexSeries, constituents, stocks, activityFile, refresh] = await Promise.all(["manifest.json", "index-series.json", "constituents.json", "stocks.json", "stock-activity.json", "refresh-state.json"].map(read));
  const { decodeAllActivity } = await import("../../src/lib/activity.ts");
  return {
    dataset: { manifest: manifest.json, indexSeries: indexSeries.json, constituents: constituents.json, stocks: stocks.json },
    activity: decodeAllActivity(activityFile.json),
    refreshState: refresh.json,
    files: [stocks, indexSeries, activityFile, constituents].map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256 })),
  };
}

export async function computeVersion(repoRoot: string): Promise<{ ruleVersion: string; ruleFiles: RuleFileHash[] }> {
  const ruleFiles = await hashRuleFiles(repoRoot, RULE_FILES);
  return { ruleVersion: computeRuleVersion(ruleFiles, configForHash(buildEffectiveConfig())), ruleFiles };
}

/** The enabled version is the latest VALID create-only record under protocol/versions (by enabledFrom, then name). */
export async function loadEnabledVersion(ledgerRoot: string): Promise<{ ruleVersion: string; enabledFrom: string } | null> {
  const dir = ledgerPaths(ledgerRoot).versionsDir;
  const files = await listFiles(dir);
  const recs: { ruleVersion: string; enabledFrom: string }[] = [];
  for (const f of files) {
    let r: unknown = null;
    try {
      r = await readJsonIfExists<unknown>(path.join(dir, f));
    } catch {
      continue; // an unreadable record can never enable anything
    }
    if (validateVersionRecord(f, r).length === 0) recs.push(r as { ruleVersion: string; enabledFrom: string });
  }
  recs.sort((a, b) => a.enabledFrom.localeCompare(b.enabledFrom) || a.ruleVersion.localeCompare(b.ruleVersion));
  return recs.length ? recs[recs.length - 1] : null;
}

export async function loadCalendarOverrides(ledgerRoot: string): Promise<Set<string>> {
  const files = await listFiles(ledgerPaths(ledgerRoot).calendarDir);
  return new Set(files.map((f) => f.replace(/\.json$/, "")));
}

interface StoredDaily {
  header: { sessionDate: string; source: string; sourceData: { universe: { symbolCount: number; fetchedAt: string | null; symbols: string[] } }; inputDigest: ReturnType<typeof computeInputDigest> };
}

async function readDailyDates(ledgerRoot: string, ruleVersion: string): Promise<string[]> {
  return (await listFiles(ledgerPaths(ledgerRoot).predictionsDir(ruleVersion))).map((f) => f.replace(/\.json$/, "")).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

/** Previous LIVE-capture snapshot of the same rule version (never replay). */
export async function loadPreviousSnapshot(ledgerRoot: string, ruleVersion: string, date: string): Promise<R.PreviousSnapshot | null> {
  const dates = (await readDailyDates(ledgerRoot, ruleVersion)).filter((d) => d < date);
  const prev = dates[dates.length - 1];
  if (!prev) return null;
  try {
    const d = JSON.parse(await readFile(ledgerPaths(ledgerRoot).dailyFile(ruleVersion, prev), "utf-8")) as StoredDaily;
    if (d.header.source !== SOURCE_LIVE) return { source: String(d.header.source), symbolCount: 0, constituentsFetchedAt: "", readable: false };
    return { source: d.header.source, symbolCount: d.header.sourceData.universe.symbolCount, constituentsFetchedAt: d.header.sourceData.universe.fetchedAt ?? "", readable: true };
  } catch {
    return { source: "unknown", symbolCount: 0, constituentsFetchedAt: "", readable: false };
  }
}

/** R10 over the last ten captured sessions: recompute their stored digests against the current data. */
export async function checkSourceRevisions(ledgerRoot: string, ruleVersion: string, before: string, src: CaptureSource): Promise<R.R10Session[]> {
  const dates = (await readDailyDates(ledgerRoot, ruleVersion)).filter((d) => d < before).slice(-READINESS.R10.checkedSessions);
  const ds: DigestSource = { stocks: src.dataset.stocks, activity: src.activity, indexSeries: src.dataset.indexSeries };
  const out: R.R10Session[] = [];
  for (const date of dates) {
    try {
      const d = JSON.parse(await readFile(ledgerPaths(ledgerRoot).dailyFile(ruleVersion, date), "utf-8")) as StoredDaily;
      if (d.header.source !== SOURCE_LIVE) continue; // R10 is advisory and only about live captures
      const cmp = compareInputDigest({ symbols: d.header.sourceData.universe.symbols, digest: d.header.inputDigest }, ds, date);
      out.push({ date, ...cmp });
    } catch {
      continue; // unreadable files are reported by ledger:verify and the guard, not by this advisory check
    }
  }
  return out;
}

const universeFetchedAt = (ds: RawDataset): string | null => {
  const ts = UNIVERSE_LIST_SLUGS.map((s) => ds.constituents[s]?.fetchedAt).filter((x): x is string => !!x);
  return ts.length ? [...ts].sort()[ts.length - 1] : null;
};

/** Evaluates one session; writes nothing. Returns the checks and, when ready, the complete daily object. */
export function evaluateSession(src: CaptureSource, u: PreparedUniverse, date: string, env: CaptureEnv, previous: R.PreviousSnapshot | null, r10?: R.CheckResult): { checks: R.CheckResult[]; daily: Record<string, unknown> | null; warnings: string[] } {
  const ds = src.dataset;
  const ci = u.calendarIndex.get(date);
  const checks: R.CheckResult[] = [];
  const hasBar = Object.fromEntries(EXPECTED_INDEX_SLUGS.map((s) => [s, hasBarOn(ds.indexSeries[s]?.bars, date)]));
  const r1 = R.checkR1(date, src.refreshState.archives.index[date], src.refreshState.archives.stocks[date]);
  checks.push(r1, R.checkR2(date, hasBar));
  if (ci === undefined) {
    checks.push({ id: "R2b", name: "date in the NIFTY 500 calendar", status: "fail", disposition: "waiting", observed: { date }, threshold: {}, reason: `${date} is not in the NIFTY 500 calendar.` });
    return { checks, daily: null, warnings: [] };
  }

  // Universe statistics (comparable-bar rules are the application's own).
  const withBar = u.stocks.filter((s) => s.indexByDate.has(date));
  const volumeMissing = withBar.filter((s) => !s.activityByDate.has(date)).map((s) => s.symbol).sort();
  checks.push(R.checkR3(withBar.length, withBar.length - volumeMissing.length, volumeMissing));
  const day = moversOn(u, date);
  const preceding = Array.from({ length: READINESS.R4.baselineSessions }, (_, k) => ci - READINESS.R4.baselineSessions + k).filter((j) => j >= 0);
  checks.push(R.checkR4(day.movers.length, preceding.map((j) => moversOn(u, u.calendar[j]).movers.length)));

  const lists = Object.fromEntries(Object.keys(READINESS.R5.nominal).map((slug) => [slug, { present: !!ds.constituents[slug], count: ds.constituents[slug]?.constituents.length ?? 0 }]));
  const symbols = [...new Set(UNIVERSE_LIST_SLUGS.flatMap((s) => ds.constituents[s]?.constituents.map((c) => c.symbol) ?? []))].sort();
  const fetchedAt = universeFetchedAt(ds);
  checks.push(R.checkR5(lists, symbols.length, fetchedAt, previous));
  checks.push(R.checkR7(date, ds.manifest, r1.status === "pass"));

  // R9 inputs
  const barAt = (j: number, s: (typeof u.stocks)[number]) => s.indexByDate.has(u.calendar[j]);
  const missingOn = (j: number) => (j < 1 ? [] : u.stocks.filter((s) => barAt(j - 1, s) && !barAt(j, s)).map((s) => s.symbol).sort());
  const noBarToday = missingOn(ci);
  checks.push(R.checkR9(noBarToday, preceding.filter((j) => j >= 1).map((j) => missingOn(j).length)));

  // Run the application's own discovery with audited defaults.
  const baseSettings = cloneDefaultSettings();
  const audit = auditedSettings(baseSettings);
  const market = marketContextAt(u, date, audit.settings);
  const discovery = discover(u, date, audit.settings, market.regime.regime, POOL.gainers);
  checks.push(R.checkR8(env.ruleVersion, env.enabledVersion, [...audit.reads]));

  const excluded = buildExcludedEvidence(u, discovery.excluded, date);
  checks.push(R.checkR11(excluded));
  if (r10) checks.push(r10);

  if (R.anyBlocking(checks).length > 0 || R.anyWaiting(checks).length > 0) return { checks, daily: null, warnings: [] };

  // ---- build the complete daily object ----
  const byRank = new Map<string, { c: MomentumCandidate; lists: ListEntry[] }>();
  const add = (c: MomentumCandidate, list: ListEntry["list"], rank: number) => {
    const e = byRank.get(c.symbol) ?? { c, lists: [] };
    e.lists.push({ list, rank, setup: c.label, evidence: c.assessment.category, netScore: c.assessment.total });
    byRank.set(c.symbol, e);
  };
  discovery.gainers.forEach((c, i) => add(c, "gainer", i + 1));
  discovery.losers.forEach((c, i) => add(c, "loser", i + 1));
  discovery.volumeMovers.forEach((c, i) => add(c, "volume", i + 1));
  const predictions: PredictionRecord[] = [...byRank.values()]
    .map(({ c, lists: l }) => {
      const st = u.bySymbol.get(c.symbol)!;
      return buildPredictionRecord(c, l, date, st.bars[st.indexByDate.get(date)!], env.ruleVersion);
    })
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  const warnings: string[] = checks.filter((c) => c.status === "warn").map((c) => `${c.id}: ${c.reason}`);
  const positive = day.movers.filter((m) => m.changePct > 0).length;
  const negative = day.movers.filter((m) => m.changePct < 0).length;
  const shortfalls = (
    [
      ["gainer", POOL.gainers, discovery.gainers.length, `${positive} stock(s) had a positive change`],
      ["loser", POOL.losers, discovery.losers.length, `${negative} stock(s) had a negative change`],
      ["volume", POOL.volume, discovery.volumeMovers.length, "stocks need a non-zero change and a complete volume baseline"],
    ] as const
  )
    .filter(([, want, got]) => got < want)
    .map(([list, want, got, why]) => ({ list, expected: want, actual: got, reason: `Only ${got} eligible stock(s): ${why}.` }));

  const nifty50 = u.indices.get("nifty50");
  const n50 = nifty50 ? indexContextAt(u, nifty50, date) : null;
  const config = buildEffectiveConfig(baseSettings);
  const digest = computeInputDigest(symbols, EXPECTED_INDEX_SLUGS, { stocks: ds.stocks, activity: src.activity, indexSeries: ds.indexSeries }, date);
  const e = env.env;
  const header = {
    sessionDate: date,
    source: SOURCE_LIVE,
    generatedAt: env.now.toISOString(),
    github: { repository: e.GITHUB_REPOSITORY ?? null, workflow: e.GITHUB_WORKFLOW ?? null, runId: e.GITHUB_RUN_ID ?? null, runAttempt: e.GITHUB_RUN_ATTEMPT ?? null, runNumber: e.GITHUB_RUN_NUMBER ?? null, sha: e.GITHUB_SHA ?? null, ref: e.GITHUB_REF ?? null },
    runtime: { node: process.version, typescript: typescriptVersion() },
    model: { ruleVersion: env.ruleVersion, tokenizer: TOKENIZER_ID, ruleFiles: env.ruleFiles },
    config,
    sourceData: {
      manifest: {
        schemaVersion: ds.manifest.schemaVersion,
        generatedAt: ds.manifest.generatedAt,
        latestMarketDate: ds.manifest.latestMarketDate,
        refresh: ds.manifest.refresh ?? null,
        supplements: ds.manifest.supplements ?? null,
        warningsCount: ds.manifest.warnings.length,
        warningsSha256: sha256Canonical(ds.manifest.warnings),
      },
      refreshState: { index: src.refreshState.archives.index[date] ?? null, stocks: src.refreshState.archives.stocks[date] ?? null },
      files: src.files,
      universe: {
        lists: universeListIdentity(ds),
        symbolCount: symbols.length,
        fetchedAt,
        symbols,
      },
      calendar: { firstDate: u.calendar[0] ?? null, lastDate: u.calendar[u.calendar.length - 1] ?? null, sessions: u.calendar.length },
    },
    inputDigest: digest,
    market: {
      regime: market.regime.regime,
      benchmarkChangePct: market.benchmarkReturns.d1.available ? market.benchmarkReturns.d1.value : null,
      nifty50ChangePct: n50 && n50.changePct.available ? n50.changePct.value : null,
      breadth50: { pct: market.breadth.above50dma.pct.available ? market.breadth.above50dma.pct.value : null, eligible: market.breadth.above50dma.eligible, total: market.breadth.above50dma.total },
      counts: { universe: discovery.universeSize, eligible: discovery.eligibleCount, unchanged: discovery.unchangedCount, noSession: discovery.noSessionCount },
      excluded,
      noBarToday,
      volumeRowsMissing: volumeMissing,
      poolShortfalls: shortfalls,
    },
    lists: { gainer: discovery.gainers.map((c) => c.symbol), loser: discovery.losers.map((c) => c.symbol), volume: discovery.volumeMovers.map((c) => c.symbol) },
    readiness: { passed: true, warnings, checks },
    predictionCount: predictions.length,
    predictionsSha256: sha256Canonical(predictions),
    filings: null,
  };
  return { checks, daily: { kind: DAILY_KIND, schemaVersion: LEDGER_SCHEMA_VERSION, header, predictions }, warnings };
}

export interface CaptureRunResult {
  sessions: SessionResult[];
  r10: R.CheckResult;
  r10Sessions: R.R10Session[];
}

/** Captures every eligible, not-yet-captured session in the last ten calendar sessions, oldest first. */
export async function runCapture(src: CaptureSource, env: CaptureEnv, opts: { sessionsWindow?: number } = {}): Promise<CaptureRunResult> {
  const u = prepareUniverse(src.dataset, src.activity);
  const window = opts.sessionsWindow ?? READINESS.R10.checkedSessions;
  const candidates = u.calendar.slice(-window).filter((d) => env.enabledFrom !== null && d >= env.enabledFrom);
  const sessions: SessionResult[] = [];
  // R10 looks at the last ten sessions captured by EARLIER runs (evaluated before this run writes anything).
  const r10Sessions = env.enabledVersion ? await checkSourceRevisions(env.ledgerRoot, env.ruleVersion, "9999-12-31", src) : [];
  const r10 = R.summariseR10(r10Sessions);
  if (!env.enabledVersion || env.enabledFrom === null) {
    return { sessions: [{ date: u.calendar[u.calendar.length - 1] ?? "", outcome: "not-enabled", checks: [], reasons: ["No rule version is enabled; nothing is captured."], warnings: [] }], r10, r10Sessions };
  }
  const paths = ledgerPaths(env.ledgerRoot);
  for (const date of candidates) {
    const file = paths.dailyFile(env.ruleVersion, date);
    // R6 - never short-circuit on file existence: the candidate is evaluated so its prediction digest can be compared.
    const existing = await readExistingDaily(file, { date, ruleVersion: env.ruleVersion });
    const previous = await loadPreviousSnapshot(env.ledgerRoot, env.ruleVersion, date);
    const ev = evaluateSession(src, u, date, env, previous, r10);
    const blocking = R.anyBlocking(ev.checks);
    const waiting = R.anyWaiting(ev.checks);
    const r6check = (r: R6Evidence): R.CheckResult => ({ id: "R6", name: "no conflicting existing record", status: r.status === "anomaly" ? "fail" : r.status === "existing-uncompared" ? "warn" : "pass", disposition: r.status === "anomaly" ? "blocked" : "ok", observed: { existing: r.existingPredictionsSha256, candidate: r.candidatePredictionsSha256 }, threshold: { compares: "canonical predictionsSha256" }, reason: r.detail });
    if (existing.kind !== "none") {
      const candidateSha = ev.daily ? ((ev.daily.header as { predictionsSha256: string }).predictionsSha256) : null;
      const note = ev.daily ? null : [...blocking, ...waiting].map((c) => `${c.id}: ${c.reason}`).join(" | ") || null;
      const r6 = compareR6(existing, candidateSha, note, universeListIdentity(src.dataset));
      const checks = [...ev.checks, r6check(r6)];
      if (r6.status === "anomaly") sessions.push({ date, outcome: "anomaly", checks, reasons: [`R6: ${r6.detail}`], file, warnings: [], r6 });
      else sessions.push({ date, outcome: "exists", checks, reasons: [r6.detail], file, warnings: [], r6 });
      continue;
    }
    if (!ev.daily) {
      sessions.push({ date, outcome: blocking.length ? "blocked" : "waiting", checks: ev.checks, reasons: [...blocking, ...waiting].map((c) => `${c.id}: ${c.reason}`), warnings: [] });
      continue;
    }
    // New record: R6 passes and is part of the record's own readiness report.
    const r6pass = compareR6(existing, (ev.daily.header as { predictionsSha256: string }).predictionsSha256, null);
    (ev.daily.header as { readiness: { checks: R.CheckResult[] } }).readiness.checks.push(r6check(r6pass));
    const problems = validateDaily(ev.daily, { date, ruleVersion: env.ruleVersion });
    if (problems.length) {
      sessions.push({ date, outcome: "blocked", checks: ev.checks, reasons: problems.map((p) => `validation: ${p}`), warnings: [] });
      continue;
    }
    const content = JSON.stringify(ev.daily) + "\n";
    const res = await createOnly(file, content);
    if (res.created) {
      sessions.push({ date, outcome: "recorded", checks: [...ev.checks, r6check(r6pass)], reasons: [], file, bytes: Buffer.byteLength(content), warnings: ev.warnings, predictionCount: (ev.daily.predictions as unknown[]).length, r6: r6pass });
    } else {
      // Lost a race: compare canonical prediction digests with whatever the winner wrote.
      const winner = await readExistingDaily(file, { date, ruleVersion: env.ruleVersion });
      const r6 = compareR6(winner, (ev.daily.header as { predictionsSha256: string }).predictionsSha256, null, universeListIdentity(src.dataset));
      if (r6.status === "anomaly") sessions.push({ date, outcome: "anomaly", checks: [...ev.checks, r6check(r6)], reasons: [`R6: ${r6.detail}`], file, warnings: [], r6 });
      else sessions.push({ date, outcome: "exists", checks: [...ev.checks, r6check(r6)], reasons: ["Another run created the file first; its prediction digest is identical."], file, warnings: [], r6 });
    }
  }
  return { sessions, r10, r10Sessions };
}

export async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await directorySize(p) : (await stat(p)).size;
  }
  return total;
}

export { canonicalJson };
