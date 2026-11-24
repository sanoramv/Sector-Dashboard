/**
 * Shadow capture (EXPERIMENTAL; docs/research/SHADOW_PREDICTIONS.md §5). Beside the mv1 capture, never inside it:
 *  - runs only after an owner-approved activation file (public/data/shadow/activation.json) exists;
 *  - only for sessions with a valid mv1 prediction file, at or before that session's cut-off (never backfills);
 *  - reuses the production discovery functions; nothing here scores or classifies on its own;
 *  - fails closed when the any-rank computation does not reproduce the mv1 top-50 gainer list exactly;
 *  - writes one create-only file per variant and session under public/data/shadow/<versionId>/<date>.json.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MomentumCandidate } from "../../src/types/momentum.ts";
import { prepareUniverse, type PreparedUniverse } from "../../src/lib/momentum/universe.ts";
import { buildCandidate, makeBuildContext, moversOn, rankMovers } from "../../src/lib/momentum/discovery.ts";
import { marketContextAt } from "../../src/lib/momentum/market.ts";
import { canonicalJson, sha256Canonical, sha256Hex } from "../ledger/canonical.mts";
import { cloneDefaultSettings } from "../ledger/config.mts";
import { createOnly, listFiles, readJsonIfExists } from "../ledger/files.mts";
import { ledgerPaths } from "../ledger/constants.mts";
import { dateStatuses, resolveCutoff } from "../ledger/calendar.mts";
import { computeVersion, loadCalendarOverrides, loadEnabledVersion, loadSource, type CaptureSource } from "../ledger/capture.mts";
import { MV1_POOL, SHADOW_SCHEME, isMv1Breakout, shadowVersions, type ShadowInput, type Variant } from "./definitions.mts";

export const SHADOW_FILE_KIND = "shadow.predictions";
export const SHADOW_ACTIVATION_KIND = "shadow.activation";
export const SHADOW_SCHEMA_VERSION = 1;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ShadowCandidate extends ShadowInput {
  symbol: string;
  evidence: string;
  netScore: number;
  bar: { open: number; high: number; low: number; close: number };
  volatility20: number | null;
}

export interface ShadowRow {
  predictionId: string;
  date: string;
  symbol: string;
  group: "gainer";
  rank: number;
  bar: { open: number; high: number; low: number; close: number };
  price: { changePct: number; volatility20: number | null };
  mv1: { setup: string; evidence: string; netScore: number; breakout: boolean };
  breakout: { today: boolean | null; distancePct: number | null };
  recordHash: string;
}

export interface ShadowFile {
  kind: typeof SHADOW_FILE_KIND;
  schemaVersion: number;
  header: {
    sessionDate: string;
    versionId: string;
    variant: string;
    definition: string;
    scheme: string;
    mv1RuleVersion: string;
    mv1File: { path: string; sha256: string; predictionsSha256: string };
    market: { regime: string };
    gainerCount: number;
    cutoff: string;
    data: Array<{ name: string; sha256: string }>;
    generatedAt: string;
    github: { runId: string | null; runAttempt: string | null; sha: string | null };
    predictionCount: number;
    predictionsSha256: string;
  };
  predictions: ShadowRow[];
}

export interface Activation {
  kind: typeof SHADOW_ACTIVATION_KIND;
  captureFrom: string;
  approvedAt: string;
  document: string;
}

const val = <T,>(m: { available: true; value: T } | { available: false }): T | null => (m.available ? m.value : null);

/** Every positive-change gainer of the session, any rank, with the production candidate's own labels. */
export function shadowCandidates(u: PreparedUniverse, date: string): { regime: string; candidates: ShadowCandidate[] } {
  const settings = cloneDefaultSettings();
  const day = moversOn(u, date);
  const regime = marketContextAt(u, date, settings).regime.regime;
  const ctx = makeBuildContext(u, date, settings, regime, day);
  const candidates = rankMovers(day.movers, "gainer", Number.MAX_SAFE_INTEGER).map((m, k) => {
    const c: MomentumCandidate = buildCandidate(m, "gainer", k + 1, ctx);
    const b = m.stock.bars[m.i];
    return {
      symbol: c.symbol,
      rank: k + 1,
      changePct: c.price.dailyChangePct,
      label: c.label,
      evidence: c.assessment.category,
      netScore: c.assessment.total,
      breakoutToday: c.patterns.breakoutToday,
      distancePct: c.patterns.resistance.available ? c.patterns.resistance.value.distancePct : null,
      bar: { open: b.open, high: b.high, low: b.low, close: b.close },
      volatility20: val(c.price.volatility20),
    };
  });
  return { regime, candidates };
}

type Mv1Daily = { header: { sessionDate: string; predictionsSha256: string; model: { ruleVersion: string }; market?: { regime?: string } }; predictions: Array<{ symbol: string; bar: { high: number; low: number; close: number }; price: { changePct: number; volatility20: number | null }; lists?: Array<{ list: string; rank: number; setup: string; evidence: string; netScore: number }> }> };

/** Fail-closed integrity check: the any-rank computation must reproduce the mv1 top-50 gainer list exactly. */
export function checkAgainstMv1(candidates: ShadowCandidate[], regime: string, mv1: Mv1Daily): string[] {
  const problems: string[] = [];
  const mine = candidates.filter((c) => c.rank <= MV1_POOL).map((c) => ({ symbol: c.symbol, rank: c.rank, setup: c.label, evidence: c.evidence, netScore: c.netScore }));
  const theirs = mv1.predictions
    .flatMap((p) => (p.lists ?? []).filter((l) => l.list === "gainer").map((l) => ({ symbol: p.symbol, rank: l.rank, setup: l.setup, evidence: l.evidence, netScore: l.netScore })))
    .sort((a, b) => a.rank - b.rank);
  if (canonicalJson(mine) !== canonicalJson(theirs)) problems.push(`the top-${MV1_POOL} gainers do not reproduce the mv1 file (${mine.length} vs ${theirs.length} rows)`);
  const byMv1 = new Map(mv1.predictions.map((p) => [p.symbol, p]));
  for (const c of candidates.filter((x) => x.rank <= MV1_POOL)) {
    const p = byMv1.get(c.symbol);
    if (p && (p.bar.high !== c.bar.high || p.bar.low !== c.bar.low || p.bar.close !== c.bar.close || p.price.volatility20 !== c.volatility20)) problems.push(`${c.symbol}: prediction-day bar or volatility20 differs from the mv1 file`);
  }
  if (mv1.header.market?.regime !== undefined && mv1.header.market.regime !== regime) problems.push(`regime ${regime} differs from the mv1 file (${mv1.header.market.regime})`);
  return problems;
}

export function buildShadowFile(a: { variant: Variant & { versionId: string }; date: string; regime: string; candidates: ShadowCandidate[]; mv1RuleVersion: string; mv1File: ShadowFile["header"]["mv1File"]; cutoffMs: number; data: ShadowFile["header"]["data"]; generatedAt: string; github: ShadowFile["header"]["github"] }): ShadowFile {
  const predictions: ShadowRow[] = a.candidates
    .filter((c) => a.variant.include(c))
    .sort((x, y) => x.symbol.localeCompare(y.symbol))
    .map((c) => {
      const row: Omit<ShadowRow, "recordHash"> = {
        predictionId: `${a.date}|${c.symbol}|${a.variant.versionId}`,
        date: a.date,
        symbol: c.symbol,
        group: "gainer",
        rank: c.rank,
        bar: c.bar,
        price: { changePct: c.changePct, volatility20: c.volatility20 },
        mv1: { setup: c.label, evidence: c.evidence, netScore: c.netScore, breakout: isMv1Breakout(c) },
        breakout: { today: c.breakoutToday, distancePct: c.distancePct },
      };
      return { ...row, recordHash: sha256Canonical(row) };
    });
  return {
    kind: SHADOW_FILE_KIND,
    schemaVersion: SHADOW_SCHEMA_VERSION,
    header: {
      sessionDate: a.date,
      versionId: a.variant.versionId,
      variant: a.variant.id,
      definition: a.variant.definition,
      scheme: SHADOW_SCHEME,
      mv1RuleVersion: a.mv1RuleVersion,
      mv1File: a.mv1File,
      market: { regime: a.regime },
      gainerCount: a.candidates.length,
      cutoff: new Date(a.cutoffMs).toISOString(),
      data: a.data,
      generatedAt: a.generatedAt,
      github: a.github,
      predictionCount: predictions.length,
      predictionsSha256: sha256Canonical(predictions),
    },
    predictions,
  };
}

/** Structural and hash validation of a stored shadow file. */
export function validateShadowFile(o: unknown, expect: { date: string; versionId: string }): string[] {
  const p: string[] = [];
  const f = o as ShadowFile;
  if (!f || typeof f !== "object" || f.kind !== SHADOW_FILE_KIND || f.schemaVersion !== SHADOW_SCHEMA_VERSION || !f.header || !Array.isArray(f.predictions)) return ["not a shadow predictions file"];
  if (f.header.sessionDate !== expect.date) p.push(`sessionDate ${f.header.sessionDate} is not ${expect.date}`);
  if (f.header.versionId !== expect.versionId) p.push(`versionId ${f.header.versionId} is not ${expect.versionId}`);
  if (f.header.predictionCount !== f.predictions.length) p.push("predictionCount does not match");
  if (sha256Canonical(f.predictions) !== f.header.predictionsSha256) p.push("predictionsSha256 does not match");
  for (const r of f.predictions) {
    const { recordHash, ...rest } = r;
    if (recordHash !== sha256Canonical(rest)) p.push(`${r.symbol}: recordHash does not match`);
    if (r.date !== expect.date || r.predictionId !== `${expect.date}|${r.symbol}|${expect.versionId}`) p.push(`${r.symbol}: identity does not match the file`);
  }
  return p;
}

export function validateActivation(o: unknown): string[] {
  const a = o as Activation;
  if (!a || a.kind !== SHADOW_ACTIVATION_KIND) return ["not a shadow activation record"];
  const p: string[] = [];
  if (!DATE.test(a.captureFrom ?? "")) p.push("captureFrom must be YYYY-MM-DD");
  if (typeof a.approvedAt !== "string" || Number.isNaN(Date.parse(a.approvedAt))) p.push("approvedAt must be a timestamp");
  if (a.document !== "docs/research/SHADOW_PREDICTIONS.md") p.push("document must be docs/research/SHADOW_PREDICTIONS.md");
  return p;
}

/** 15:30 IST (NSE close) on the session date, epoch ms. */
export const sessionCloseMs = (date: string) => Date.parse(`${date}T10:00:00Z`);

export const shadowFilePath =(shadowRoot: string, versionId: string, date: string) => path.join(shadowRoot, versionId, `${date}.json`);

export interface ShadowSessionResult {
  date: string;
  outcome: "recorded" | "exists" | "conflict" | "late" | "waiting" | "blocked";
  detail: string;
  files?: Array<{ versionId: string; result: string; count: number }>;
}
export interface ShadowCaptureReport {
  status: "not-activated" | "ran";
  detail: string;
  sessions: ShadowSessionResult[];
}

export interface ShadowCaptureOptions {
  repoRoot: string;
  dataDir: string;
  ledgerRoot: string;
  shadowRoot: string;
  now: Date;
  github: ShadowFile["header"]["github"];
  /** sessions examined (newest mv1 files first); default 5 */
  window?: number;
  /** for tests: a preloaded source */
  source?: CaptureSource;
}

export async function runShadowCapture(o: ShadowCaptureOptions): Promise<ShadowCaptureReport> {
  const activation = await readJsonIfExists<unknown>(path.join(o.shadowRoot, "activation.json"));
  if (activation === null) return { status: "not-activated", detail: "no public/data/shadow/activation.json: shadow capture is not activated; nothing written", sessions: [] };
  const ap = validateActivation(activation);
  if (ap.length) throw new Error(`invalid shadow activation record: ${ap.join("; ")}`);
  const { captureFrom } = activation as Activation;

  const enabled = await loadEnabledVersion(o.ledgerRoot);
  if (!enabled) return { status: "not-activated", detail: "no mv1 version is enabled; nothing written", sessions: [] };
  const { ruleVersion } = await computeVersion(o.repoRoot);
  if (ruleVersion !== enabled.ruleVersion) throw new Error(`the code's rule version ${ruleVersion} is not the enabled ${enabled.ruleVersion}; refusing to capture shadow rules against it`);
  const variants = await shadowVersions(o.repoRoot, ruleVersion);

  const paths = ledgerPaths(o.ledgerRoot);
  const mv1Dates = (await listFiles(paths.predictionsDir(ruleVersion))).map((f) => f.replace(/\.json$/, "")).filter((d) => DATE.test(d) && d >= captureFrom).sort().slice(-(o.window ?? 5));
  const report: ShadowCaptureReport = { status: "ran", detail: `versions ${variants.map((v) => v.versionId).join(", ")}; captureFrom ${captureFrom}`, sessions: [] };
  if (!mv1Dates.length) return report;

  const src = o.source ?? (await loadSource(o.dataDir));
  const statuses = dateStatuses(src.refreshState, (src.dataset.manifest as { refresh?: { latestDueDate?: string } })?.refresh?.latestDueDate ?? null);
  const overrides = await loadCalendarOverrides(o.ledgerRoot);
  let u: PreparedUniverse | null = null;

  for (const date of mv1Dates) {
    const existing = await Promise.all(variants.map((v) => readJsonIfExists<ShadowFile>(shadowFilePath(o.shadowRoot, v.versionId, date))));
    if (existing.every((e) => e !== null)) {
      report.sessions.push({ date, outcome: "exists", detail: "all shadow files exist" });
      continue;
    }
    if (o.now.getTime() < sessionCloseMs(date)) {
      report.sessions.push({ date, outcome: "waiting", detail: "the session has not closed yet" });
      continue;
    }
    const cut = resolveCutoff(date, o.now.getTime(), statuses, overrides);
    if (cut.kind === "pending") {
      report.sessions.push({ date, outcome: "waiting", detail: `cut-off unresolved (waiting for ${cut.waitingFor})` });
      continue;
    }
    if (o.now.getTime() > cut.cutoffMs) {
      report.sessions.push({ date, outcome: "late", detail: `after the cut-off ${new Date(cut.cutoffMs).toISOString()}: never backfilled` });
      continue;
    }
    const mv1Path = paths.dailyFile(ruleVersion, date);
    const mv1Buf = await readFile(mv1Path);
    const mv1 = JSON.parse(mv1Buf.toString("utf-8")) as Mv1Daily;
    if (mv1.header.model.ruleVersion !== ruleVersion || sha256Canonical(mv1.predictions) !== mv1.header.predictionsSha256) {
      report.sessions.push({ date, outcome: "blocked", detail: "the mv1 file is not a valid record of the enabled version" });
      continue;
    }
    u ??= prepareUniverse(src.dataset, src.activity);
    if (!u.calendarIndex.has(date)) {
      report.sessions.push({ date, outcome: "blocked", detail: "the session is not in the current market data" });
      continue;
    }
    const { regime, candidates } = shadowCandidates(u, date);
    const problems = checkAgainstMv1(candidates, regime, mv1);
    if (problems.length) {
      report.sessions.push({ date, outcome: "blocked", detail: `integrity check failed: ${problems.slice(0, 3).join("; ")}` });
      continue;
    }
    const mv1File = { path: path.relative(o.repoRoot, mv1Path).split(path.sep).join("/"), sha256: sha256Hex(mv1Buf), predictionsSha256: mv1.header.predictionsSha256 };
    const files: NonNullable<ShadowSessionResult["files"]> = [];
    let conflict = false;
    for (const v of variants) {
      const file = buildShadowFile({ variant: v, date, regime, candidates, mv1RuleVersion: ruleVersion, mv1File, cutoffMs: cut.cutoffMs, data: src.files.map((f) => ({ name: f.name, sha256: f.sha256 })), generatedAt: o.now.toISOString(), github: o.github });
      const vp = validateShadowFile(file, { date, versionId: v.versionId });
      if (vp.length) throw new Error(`${v.versionId} ${date}: built file is invalid (${vp.join("; ")})`);
      const target = shadowFilePath(o.shadowRoot, v.versionId, date);
      const prior = await readJsonIfExists<ShadowFile>(target);
      if (prior) {
        const same = prior.header?.predictionsSha256 === file.header.predictionsSha256;
        conflict ||= !same;
        files.push({ versionId: v.versionId, result: same ? "exists" : "conflict", count: file.predictions.length });
        continue;
      }
      const res = await createOnly(target, JSON.stringify(file) + "\n");
      files.push({ versionId: v.versionId, result: res.created ? "created" : "exists", count: file.predictions.length });
    }
    report.sessions.push({ date, outcome: conflict ? "conflict" : "recorded", detail: conflict ? "an existing shadow file has different predictions; nothing overwritten" : `${candidates.length} gainers`, files });
  }
  return report;
}
