/**
 * Shadow evaluation (EXPERIMENTAL; docs/research/SHADOW_PREDICTIONS.md §6-§8). Derived on every run, never stored:
 * OD1 outcomes of the committed shadow files and of the mv1 benchmark (top-50 "Possible breakout setup") with the SAME
 * production engine functions on the SAME eligible sessions, plus the pre-declared contrasts and checkpoint status.
 * Writes only the dashboard summary; never touches mv1 records, outcome records or the protocol.
 */
import { readFile, writeFile, rename, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { sha256Canonical } from "../ledger/canonical.mts";
import { dateStatuses, resolveCutoff } from "../ledger/calendar.mts";
import { loadCalendarOverrides } from "../ledger/capture.mts";
import { ledgerPaths } from "../ledger/constants.mts";
import { computeLiveHoldout, type GuardGit } from "../ledger/guard.mts";
import { OD1_STORED_HORIZONS, od1Maturity, od1Outcome, populationSd } from "../ledger/od1.mts";
import { RunnerBlock, calendarInputs, evidenceFor, type RunnerMarket } from "../ledger/outcome-runner.mts";
import { loadRunnerMarket } from "../ledger/outcome-inputs.mts";
import { readPolicy } from "../ledger/outcome-process.mts";
import { outcomeStorageKey, type OutcomeRecord } from "../ledger/outcomes.mts";
import { shadowVersions, isMv1Breakout } from "./definitions.mts";
import { validateShadowFile, type ShadowFile } from "./capture.mts";

export const SHADOW_SUMMARY_KIND = "shadow.evaluation-summary";
export const BOOT = { block: 5, reps: 2000, seed: 20261124 } as const;
export const CHECKPOINTS = [20, 50, 100, 250] as const;
export const DECISION_LOOKS = [100, 250] as const;
export const COSTS_BPS = [10, 20, 40] as const;
const ADVERSE = new Set(["failed", "reversal"]);

/** One evaluated stock-day. */
export interface Obs {
  s: number; // index into the eligible sessions
  symbol: string;
  out: Record<number, { st: "complete"; cls: string; R: number; X: number; T: number | null } | { st: "unavailable" | "pending" | "blocked"; why: string }>;
}

type PredLike = { symbol: string; bar: { high: number; low: number; close: number }; price: { changePct: number; volatility20: number | null } };

/** OD1 outcome of one prediction at horizon h with the production functions (null = pending). */
export function outcomeOf(market: RunnerMarket, cal: ReturnType<typeof calendarInputs>, date: string, h: number, p: PredLike): Obs["out"][number] {
  const m = od1Maturity({ sessionDate: date, h, tradingCalendar: cal.tradingCalendar, calendarStatus: cal.calendarStatus, archives: cal.archives });
  if (m.status === "pending") return { st: "pending", why: m.reason };
  const closeT = cal.benchmark.get(date);
  const closeTh = cal.benchmark.get(m.endDate);
  if (closeT === undefined || closeTh === undefined) return { st: "blocked", why: "benchmark-missing" };
  let ev;
  try {
    ev = evidenceFor(market, cal.tradingCalendar, `shadow/${date}/h${h}`, date, m.sessions, p as Parameters<typeof evidenceFor>[5]); // reads only symbol and bar
  } catch (err) {
    if (err instanceof RunnerBlock) return { st: "blocked", why: err.code };
    throw err;
  }
  const sigma = p.price.volatility20 ?? null;
  if (sigma !== null && ev.sigmaChanges && populationSd(ev.sigmaChanges) !== sigma) return { st: "blocked", why: "source-revised" };
  const o = od1Outcome({ sessions: m.sessions, bars: ev.bars, up: p.price.changePct > 0, day: p.bar, sigma, sigmaChanges: ev.sigmaChanges, benchT: closeT, benchTh: closeTh });
  if (o.status !== "complete") return { st: "unavailable", why: o.reason };
  const first = ev.bars[0];
  const last = ev.bars[ev.bars.length - 1];
  return { st: "complete", cls: o.cls, R: o.R, X: o.X, T: first && last && first.open > 0 ? (last.close / first.open - 1) * 100 : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// Statistics: pooled shares/means per group; paired moving-block bootstrap over sessions
// ---------------------------------------------------------------------------------------------------------------------
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function bootDraws(S: number, reps = BOOT.reps, seed = BOOT.seed, block = BOOT.block): Int32Array[] {
  const rnd = mulberry32(seed);
  const b = Math.min(block, Math.max(1, S));
  const nBlocks = Math.ceil(S / b);
  const out: Int32Array[] = [];
  for (let k = 0; k < reps; k++) {
    const d = new Int32Array(nBlocks * b);
    for (let j = 0; j < nBlocks; j++) {
      const start = Math.floor(rnd() * Math.max(1, S - b + 1));
      for (let i = 0; i < b; i++) d[j * b + i] = Math.min(S - 1, start + i);
    }
    out.push(d.subarray(0, S));
  }
  return out;
}

export type Metric = (o: Obs["out"][number]) => number | null;
export const METRICS: Record<string, Metric> = {
  adverse: (o) => (o.st === "complete" ? (ADVERSE.has(o.cls) ? 100 : 0) : null),
  confirmed: (o) => (o.st === "complete" ? (o.cls === "confirmed" ? 100 : 0) : null),
  meanX: (o) => (o.st === "complete" ? o.X : null),
  meanR: (o) => (o.st === "complete" ? o.R : null),
  meanT: (o) => (o.st === "complete" ? o.T : null),
};

function perSession(obs: Obs[], S: number, h: number, m: Metric) {
  const num = new Float64Array(S);
  const den = new Float64Array(S);
  for (const r of obs) {
    const o = r.out[h];
    const x = o ? m(o) : null;
    if (x === null || !Number.isFinite(x)) continue;
    num[r.s] += x;
    den[r.s] += 1;
  }
  return { num, den };
}
const pooled = (p: { num: Float64Array; den: Float64Array }, idx?: Int32Array) => {
  let n = 0;
  let d = 0;
  const S = p.num.length;
  for (let k = 0; k < S; k++) {
    const s = idx ? idx[k] : k;
    n += p.num[s];
    d += p.den[s];
  }
  return d > 0 ? n / d : null;
};
const q = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * p;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(s.length - 1, lo + 1)] - s[lo]) * (i - lo);
};
const r3 = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

export interface Contrast {
  diff: number | null;
  ci95: [number | null, number | null];
  ci975: [number | null, number | null];
  p: number | null;
  nA: number;
  nB: number;
}
export function contrast(a: Obs[], b: Obs[], S: number, h: number, m: Metric, draws: Int32Array[]): Contrast {
  const pa = perSession(a, S, h, m);
  const pb = perSession(b, S, h, m);
  const nA = pa.den.reduce((x, y) => x + y, 0);
  const nB = pb.den.reduce((x, y) => x + y, 0);
  const va = pooled(pa);
  const vb = pooled(pb);
  const diff = va === null || vb === null ? null : va - vb;
  if (diff === null || S < 2) return { diff: r3(diff), ci95: [null, null], ci975: [null, null], p: null, nA, nB };
  const ds: number[] = [];
  for (const d of draws) {
    const x = pooled(pa, d);
    const y = pooled(pb, d);
    if (x !== null && y !== null) ds.push(x - y);
  }
  const le = ds.filter((x) => x <= 0).length / ds.length;
  const ge = ds.filter((x) => x >= 0).length / ds.length;
  return { diff: r3(diff), ci95: [r3(q(ds, 0.025)), r3(q(ds, 0.975))], ci975: [r3(q(ds, 0.0125)), r3(q(ds, 0.9875))], p: r3(Math.min(1, 2 * Math.min(le, ge))), nA, nB };
}

export function bh(ps: Array<number | null>, qv = 0.1): boolean[] {
  const idx = ps.map((p, i) => ({ p, i })).filter((x): x is { p: number; i: number } => x.p !== null).sort((a, b) => a.p - b.p);
  let kMax = -1;
  idx.forEach((x, k) => {
    if (x.p <= ((k + 1) / idx.length) * qv) kMax = k;
  });
  const pass = ps.map(() => false);
  for (let k = 0; k <= kMax; k++) pass[idx[k].i] = true;
  return pass;
}

export function describe(obs: Obs[], S: number, h: number) {
  const n = obs.filter((r) => r.out[h]?.st === "complete").length;
  const val = (m: Metric) => r3(pooled(perSession(obs, S, h, m)));
  const meanT = pooled(perSession(obs, S, h, METRICS.meanT));
  return {
    complete: n,
    unavailable: obs.filter((r) => r.out[h]?.st === "unavailable").length,
    pending: obs.filter((r) => !r.out[h] || r.out[h].st === "pending").length,
    blocked: obs.filter((r) => r.out[h]?.st === "blocked").length,
    adverse: val(METRICS.adverse),
    confirmed: val(METRICS.confirmed),
    meanX: val(METRICS.meanX),
    meanR: val(METRICS.meanR),
    meanT: r3(meanT),
    netT: Object.fromEntries(COSTS_BPS.map((c) => [`${c}bps`, meanT === null ? null : r3(meanT - c / 100)])),
  };
}

/** Pre-declared checkpoint state (§8): report-only below 100; decision looks at 100 and 250. */
export function checkpointState(sessions: number): { reached: number | null; next: number | null; decisionLook: boolean } {
  const reached = [...CHECKPOINTS].filter((c) => sessions >= c).pop() ?? null;
  const next = CHECKPOINTS.find((c) => sessions < c) ?? null;
  return { reached, next, decisionLook: reached !== null && (DECISION_LOOKS as readonly number[]).includes(reached) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Loading and eligibility
// ---------------------------------------------------------------------------------------------------------------------
export interface ShadowEvalOptions {
  repoRoot: string;
  ledgerRoot: string;
  dataDir: string;
  shadowRoot: string;
  storeRoot: string;
  summaryPath: string;
  git: GuardGit;
  commit: string;
  now: string;
}

/** Committer time of the commit that first added `rel` (null = not committed). */
export async function firstAddedAt(git: GuardGit, rel: string): Promise<number | null> {
  const out = (await git.log(["--diff-filter=A", "--format=%cI", "--", rel])).trim();
  if (!out) return null;
  const lines = out.split("\n").filter(Boolean);
  return Date.parse(lines[lines.length - 1]);
}

export async function evaluateShadow(o: ShadowEvalOptions) {
  const policy = await readPolicy(o.ledgerRoot);
  const rv = policy.referenceRuleVersion;
  const excluded = new Set(policy.excludedSessions.map((e) => e.sessionDate));
  const live = await computeLiveHoldout(o.git, o.ledgerRoot);
  const mv1Eligible = new Set(live.eligible.filter((d) => !excluded.has(d) && d >= policy.outcomesFrom));
  const market = await loadRunnerMarket(o.dataDir, { commit: o.commit });
  const cal = calendarInputs(market);
  const statuses = dateStatuses(market.refreshState, market.latestDueDate);
  const overrides = await loadCalendarOverrides(o.ledgerRoot);
  const variants = await shadowVersions(o.repoRoot, rv);
  const H = [...OD1_STORED_HORIZONS];
  const paths = ledgerPaths(o.ledgerRoot);

  const result = [];
  for (const v of variants) {
    const dir = path.join(o.shadowRoot, v.versionId);
    let dates: string[] = [];
    try {
      dates = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, 10)).sort();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const sessionInfo: Array<{ date: string; eligible: boolean; reason: string | null; regime: string | null; signals: number; mv1Signals: number }> = [];
    const files: Array<{ date: string; file: ShadowFile; mv1: Array<PredLike & { lists?: Array<{ list: string; rank: number; setup: string }> }> }> = [];
    for (const date of dates) {
      const abs = path.join(dir, `${date}.json`);
      const file = JSON.parse(await readFile(abs, "utf-8")) as ShadowFile;
      const problems = validateShadowFile(file, { date, versionId: v.versionId });
      const rel = path.relative(o.repoRoot, abs).split(path.sep).join("/");
      let reason: string | null = problems.length ? `invalid file: ${problems[0]}` : null;
      if (!reason && !mv1Eligible.has(date)) reason = "the mv1 session is not eligible under the evaluation policy";
      const t = reason ? null : await firstAddedAt(o.git, rel);
      if (!reason && t === null) reason = "not committed yet";
      if (!reason && t !== null) {
        const cut = resolveCutoff(date, t, statuses, overrides);
        if (cut.kind === "pending") reason = "cut-off unresolved";
        else if (t > cut.cutoffMs) reason = `committed after the cut-off (${new Date(cut.cutoffMs).toISOString()})`;
      }
      let mv1: (typeof files)[number]["mv1"] = [];
      if (!reason) {
        const daily = JSON.parse(await readFile(paths.dailyFile(rv, date), "utf-8"));
        if (sha256Canonical(daily.predictions) !== file.header.mv1File.predictionsSha256) reason = "the mv1 file no longer matches the one the shadow file was built from";
        else mv1 = daily.predictions.filter((p: { lists?: Array<{ list: string; rank: number; setup: string }> }) => (p.lists ?? []).some((l) => l.list === "gainer" && isMv1Breakout({ rank: l.rank, label: l.setup })));
      }
      sessionInfo.push({ date, eligible: !reason, reason, regime: file.header?.market?.regime ?? null, signals: file.predictions?.length ?? 0, mv1Signals: mv1.length });
      if (!reason) files.push({ date, file, mv1 });
    }

    const S = files.length;
    const A: Obs[] = [];
    const B: Obs[] = [];
    const mismatches: string[] = [];
    for (const [s, f] of files.entries()) {
      for (const p of f.file.predictions) A.push({ s, symbol: p.symbol, out: Object.fromEntries(H.map((h) => [h, outcomeOf(market, cal, f.date, h, p)])) });
      for (const p of f.mv1) {
        const out = Object.fromEntries(H.map((h) => [h, outcomeOf(market, cal, f.date, h, p)]));
        B.push({ s, symbol: p.symbol, out });
        // cross-check against the stored mv1 outcome records
        for (const h of H) {
          const rec = await readStored(o.storeRoot, outcomeStorageKey(rv, f.date, h));
          const e = rec?.outcomes.find((x) => x.symbol === p.symbol);
          const mine = out[h];
          if (!e || mine.st === "pending") continue;
          const theirs = e.outcome.status === "complete" ? `complete:${(e.outcome as { cls: string }).cls}:${r3((e.outcome as { X: number }).X)}` : `unavailable:${(e.outcome as { reason: string }).reason}`;
          const ours = mine.st === "complete" ? `complete:${mine.cls}:${r3(mine.X)}` : `${mine.st}:${mine.why}`;
          if (theirs !== ours) mismatches.push(`${f.date} h${h} ${p.symbol}: stored ${theirs}, recomputed ${ours}`);
        }
      }
    }
    const draws = bootDraws(S);
    const regimes = [...new Set(files.map((f) => f.file.header.market.regime))].sort();
    const half = Math.floor(S / 2);
    const sub = (obs: Obs[], keep: (s: number) => boolean) => obs.filter((r) => keep(r.s));
    const mv1Set = new Set(B.map((r) => `${r.s}|${r.symbol}`));
    const aSet = new Set(A.map((r) => `${r.s}|${r.symbol}`));
    const primary = {
      P1: contrast(A, B, S, 1, METRICS.adverse, draws),
      P2: contrast(A, B, S, 5, METRICS.adverse, draws),
      P3: contrast(A, B, S, 10, METRICS.meanX, draws),
    };
    result.push({
      variant: v.id,
      versionId: v.versionId,
      definition: v.definition,
      sessions: { files: dates.length, eligible: S, list: sessionInfo },
      checkpoint: checkpointState(S),
      signalsPerSession: S ? r3(A.length / S) : null,
      mv1SignalsPerSession: S ? r3(B.length / S) : null,
      horizons: Object.fromEntries(H.map((h) => [`h${h}`, { variant: describe(A, S, h), mv1: describe(B, S, h), variantOnly: describe(A.filter((r) => !mv1Set.has(`${r.s}|${r.symbol}`)), S, h), mv1Only: describe(B.filter((r) => !aSet.has(`${r.s}|${r.symbol}`)), S, h) }])),
      primary,
      byRegime: Object.fromEntries(regimes.map((g) => {
        const keep = (s: number) => files[s].file.header.market.regime === g;
        return [g, { sessions: files.filter((f) => f.file.header.market.regime === g).length, h1: { variant: describe(sub(A, keep), S, 1), mv1: describe(sub(B, keep), S, 1) }, h5: { variant: describe(sub(A, keep), S, 5), mv1: describe(sub(B, keep), S, 5) } }];
      })),
      halves: S >= 2 ? { first: { P1: contrast(sub(A, (s) => s < half), sub(B, (s) => s < half), S, 1, METRICS.adverse, []).diff, P2: contrast(sub(A, (s) => s < half), sub(B, (s) => s < half), S, 5, METRICS.adverse, []).diff, P3: contrast(sub(A, (s) => s < half), sub(B, (s) => s < half), S, 10, METRICS.meanX, []).diff }, second: { P1: contrast(sub(A, (s) => s >= half), sub(B, (s) => s >= half), S, 1, METRICS.adverse, []).diff, P2: contrast(sub(A, (s) => s >= half), sub(B, (s) => s >= half), S, 5, METRICS.adverse, []).diff, P3: contrast(sub(A, (s) => s >= half), sub(B, (s) => s >= half), S, 10, METRICS.meanX, []).diff } } : null,
      crossCheck: { mismatches: mismatches.slice(0, 20), count: mismatches.length },
    });
  }
  // BH over the 9 primary contrasts (meaningful only at a decision look; always reported)
  const ps = result.flatMap((r) => [r.primary.P1.p, r.primary.P2.p, r.primary.P3.p]);
  const pass = bh(ps, 0.1);
  result.forEach((r, i) => Object.assign(r, { bhPass: { P1: pass[i * 3], P2: pass[i * 3 + 1], P3: pass[i * 3 + 2] } }));

  const summary = {
    kind: SHADOW_SUMMARY_KIND,
    schemaVersion: 1,
    experimental: true,
    benchmark: { ruleVersion: rv, cohort: "mv1 top-50 gainers labelled possible-breakout" },
    document: "docs/research/SHADOW_PREDICTIONS.md",
    generatedFrom: { commit: o.commit },
    bootstrap: BOOT,
    checkpoints: CHECKPOINTS,
    decisionLooks: DECISION_LOOKS,
    note: "EXPERIMENTAL shadow rules, evaluated prospectively beside the production benchmark. Not production labels, not a probability, not a trading recommendation. Decisions only at 100 and 250 eligible sessions under the pre-declared criteria.",
    variants: result,
  };
  await mkdir(path.dirname(o.summaryPath), { recursive: true });
  const tmp = `${o.summaryPath}.partial`;
  await writeFile(tmp, JSON.stringify(summary) + "\n");
  await rename(tmp, o.summaryPath);
  return summary;
}

async function readStored(storeRoot: string, key: string): Promise<OutcomeRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(storeRoot, `${key}.json`), "utf-8")) as OutcomeRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
