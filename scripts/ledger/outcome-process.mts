/**
 * Live OD1 outcome processing (continuous-monitoring policy, 2026-11-24).
 *
 * One idempotent run:
 *  1. read and validate the evaluation policy (protocol/evaluation-policy.json): reference rule version, outcomesFrom,
 *     permanently excluded sessions;
 *  2. live eligibility from the guard (`computeLiveHoldout`) minus the policy's excluded sessions;
 *  3. plan every (session, horizon) with the frozen runner (NSE calendar maturity, archives ok, frozen sigma);
 *  4. build each DUE record, write it create-only to the outcome store, read it back and compare;
 *  5. rebuild the dashboard summary from the STORED records (deterministic: identical inputs give identical bytes).
 *
 * Nothing is ever overwritten. A horizon whose evidence is unusable (stock absent, prediction-day bar revised, source
 * revision, benchmark missing) is reported as blocked and retried next run; it is never fabricated. Failures here must
 * never block prediction capture or the market-data update (the workflow step is continue-on-error).
 */
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { sha256Canonical } from "./canonical.mts";
import { computeEngine, validateEvaluationPolicy, validateOutcomeRecord, type EvaluationPolicy, type OutcomeRecord } from "./outcomes.mts";
import { od1DefinitionsSha256 } from "./protocol.mts";
import { RunnerBlock, buildDueRecord, planOutcomes, type PlanItem, type RunnerContext, type RunnerMarket, type RunnerSession } from "./outcome-runner.mts";
import { loadRunnerMarket, loadRunnerSessions } from "./outcome-inputs.mts";
import { FsOutcomeStore, type OutcomeStore } from "./outcome-store.mts";
import { computeLiveHoldout, type GuardGit } from "./guard.mts";
import { OD1_HEADLINE_HORIZONS, OD1_STORED_HORIZONS } from "./od1.mts";

export const EVALUATION_SUMMARY_KIND = "momentum-ledger.evaluation-summary";
export const POLICY_REL = "protocol/evaluation-policy.json";

export interface ProcessOptions {
  repoRoot: string;
  ledgerRoot: string;
  dataDir: string;
  storeRoot: string;
  summaryPath: string;
  git: GuardGit;
  /** provenance of the market data (the commit the run started from) */
  commit: string;
  github: { runId: string | null; runAttempt: string | null; sha: string | null };
  /** processing time recorded in NEW records only */
  now: string;
}

export interface CoreReport {
  plan: Record<string, number>;
  planItems: PlanItem[];
  created: string[];
  existing: string[];
  conflicts: string[];
  blocked: Array<{ key: string; code: string }>;
}
export interface ProcessReport extends CoreReport {
  ruleVersion: string;
  eligible: string[];
  summaryPath: string;
}

/**
 * The core loop: plan, build each DUE record, validate it against its prediction file, write it create-only, read it
 * back. Never overwrites; a conflict is reported and the original kept; a blocked horizon is reported and retried.
 */
export async function processPlanned(sessions: RunnerSession[], market: RunnerMarket, ctx: Omit<RunnerContext, "stored">, store: OutcomeStore): Promise<CoreReport> {
  const keys = new Set(await store.listKeys());
  const full = { ...ctx, stored: keys };
  const planItems = planOutcomes(sessions, market, full);
  const r: CoreReport = { plan: {}, planItems, created: [], existing: [], conflicts: [], blocked: [] };
  for (const p of planItems) r.plan[p.status] = (r.plan[p.status] ?? 0) + 1;
  const bySession = new Map(sessions.map((s) => [s.daily.header.sessionDate, s]));
  for (const item of planItems.filter((p) => p.status === "due")) {
    let record: OutcomeRecord;
    try {
      record = buildDueRecord(item, bySession.get(item.sessionDate)!, market, full);
    } catch (err) {
      if (err instanceof RunnerBlock) {
        r.blocked.push({ key: item.key, code: err.code });
        continue;
      }
      throw err;
    }
    const problems = validateOutcomeRecord(record, { definitionsSha256: ctx.definitionsSha256, daily: bySession.get(item.sessionDate)!.daily });
    if (problems.length) throw new Error(`${item.key}: built record is invalid (${problems.slice(0, 3).join("; ")}); nothing written`);
    const put = await store.putRecord(record);
    if (put.result === "conflict") {
      r.conflicts.push(item.key);
      continue;
    }
    (put.result === "created" ? r.created : r.existing).push(item.key);
    const back = await store.getRecord(item.key);
    if (!back || sha256Canonical(back) !== sha256Canonical(put.stored)) throw new Error(`${item.key}: the stored record could not be read back identically`);
  }
  return r;
}

export async function readPolicy(ledgerRoot: string): Promise<EvaluationPolicy> {
  const policy = JSON.parse(await readFile(path.join(ledgerRoot, POLICY_REL), "utf-8"));
  const p = validateEvaluationPolicy(policy);
  if (p.length) throw new Error(`invalid evaluation policy: ${p.join("; ")}`);
  return policy as EvaluationPolicy;
}

export async function processOutcomes(o: ProcessOptions): Promise<ProcessReport> {
  const policy = await readPolicy(o.ledgerRoot);
  const rv = policy.referenceRuleVersion;
  const excluded = new Set(policy.excludedSessions.map((e) => e.sessionDate));
  const live = await computeLiveHoldout(o.git, o.ledgerRoot);
  const eligible = live.eligible.filter((d) => !excluded.has(d));
  const sessions = await loadRunnerSessions(o.ledgerRoot, rv);
  const market = await loadRunnerMarket(o.dataDir, { commit: o.commit });
  await mkdir(o.storeRoot, { recursive: true });
  const DEFS = od1DefinitionsSha256();
  const store = await FsOutcomeStore.open(path.resolve(o.storeRoot), { definitionsSha256: DEFS });
  const ctx = { ruleVersion: rv, activation: { outcomesFrom: policy.outcomesFrom }, eligibleSessions: new Set(eligible), definitionsSha256: DEFS, engine: await computeEngine(o.repoRoot, DEFS), generatedAt: o.now, github: o.github };
  const core = await processPlanned(sessions, market, ctx, store);
  const report: ProcessReport = { ruleVersion: rv, eligible, ...core, summaryPath: o.summaryPath };
  const records: OutcomeRecord[] = [];
  for (const k of await store.listKeys()) {
    const r = await store.getRecord(k);
    if (r && r.header.ruleVersion === rv) records.push(r);
  }
  const summary = buildEvaluationSummary({ policy, sessions, records, plan: core.planItems, blocked: report.blocked, eligible });
  await mkdir(path.dirname(o.summaryPath), { recursive: true });
  const tmp = `${o.summaryPath}.partial`;
  await writeFile(tmp, JSON.stringify(summary) + "\n");
  await rename(tmp, o.summaryPath);
  return report;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dashboard summary (derived, deterministic, rebuilt every run from the stored records)
// ---------------------------------------------------------------------------------------------------------------------
type Daily = RunnerSession["daily"] & { header: RunnerSession["daily"]["header"] & { market?: { regime?: string; benchmarkChangePct?: number } }; predictions: Array<RunnerSession["daily"]["predictions"][number] & Record<string, any>> };

export interface SummaryOutcome {
  /** complete | unavailable | pending | blocked */
  s: string;
  /** OD1 class (complete only) */
  c?: string;
  /** close-to-close return t -> t+h, % */
  R?: number;
  /** benchmark-relative return, pp */
  X?: number;
  /** tradable gross: open(t+1) -> close(t+h), % (subtract costs separately) */
  T?: number;
  /** best high / worst low in the window vs the prediction-day close, % */
  mfe?: number;
  mae?: number;
  /** unavailable or pending reason, or the block code */
  why?: string;
  // maturity (end) date and processing date are per session and horizon: sessions[].horizons[h].end / processedAt
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const pct = (a: number, b: number) => (a / b - 1) * 100;

export function buildEvaluationSummary(a: { policy: EvaluationPolicy; sessions: RunnerSession[]; records: OutcomeRecord[]; plan: PlanItem[]; blocked: Array<{ key: string; code: string }>; eligible: string[] }) {
  const byKey = new Map(a.records.map((r) => [`${r.header.sessionDate}|${r.header.horizon}`, r]));
  const planBy = new Map(a.plan.map((p) => [`${p.sessionDate}|${p.horizon}`, p]));
  const blockedBy = new Map(a.blocked.map((b) => [b.key, b.code]));
  const excluded = new Map(a.policy.excludedSessions.map((e) => [e.sessionDate, e.reason]));
  const sessions = [...a.sessions].sort((x, y) => x.daily.header.sessionDate.localeCompare(y.daily.header.sessionDate)).map((s) => {
    const d = s.daily as Daily;
    const date = d.header.sessionDate;
    const horizons: Record<string, { status: string; reason?: string; end?: string; processedAt?: string }> = {};
    for (const h of OD1_STORED_HORIZONS) {
      const r = byKey.get(`${date}|${h}`);
      const p = planBy.get(`${date}|${h}`);
      horizons[`h${h}`] = r ? { status: "stored", end: r.header.endDate, processedAt: r.header.generatedAt } : blockedBy.has(`od1/${a.policy.referenceRuleVersion}/${date}/h${h}`) ? { status: "blocked", reason: blockedBy.get(`od1/${a.policy.referenceRuleVersion}/${date}/h${h}`) } : { status: p?.status ?? "not-planned", reason: p?.reason };
    }
    const entries = new Map<number, Map<string, OutcomeRecord["outcomes"][number]>>();
    for (const h of OD1_STORED_HORIZONS) {
      const r = byKey.get(`${date}|${h}`);
      if (r) entries.set(h, new Map(r.outcomes.map((e) => [e.predictionId, e])));
    }
    const predictions = [...d.predictions]
      .sort((x, y) => x.symbol.localeCompare(y.symbol))
      .map((p) => {
        const out: Record<string, SummaryOutcome> = {};
        for (const h of OD1_STORED_HORIZONS) {
          const e = entries.get(h)?.get(p.predictionId);
          if (!e) continue; // not stored yet: the session-level horizon status says why (pending, blocked, ...)
          const r = byKey.get(`${date}|${h}`)!;
          if (e.outcome.status === "complete") {
            const m = e.outcome as unknown as { cls: string; R: number; X: number; Hstar: number; Lstar: number };
            const first = e.bars[0];
            const last = e.bars[e.bars.length - 1];
            out[`h${h}`] = {
              s: "complete",
              c: m.cls,
              R: round(m.R),
              X: round(m.X),
              T: first && last && first.open > 0 ? round(pct(last.close, first.open)) : undefined,
              mfe: round(pct(m.Hstar, e.frozen.day.close)),
              mae: round(pct(m.Lstar, e.frozen.day.close)),
            };
          } else out[`h${h}`] = { s: "unavailable", why: (e.outcome as { reason: string }).reason };
          void r;
        }
        return {
          id: p.predictionId,
          symbol: p.symbol,
          name: p.companyName,
          industry: p.industry,
          segment: p.sizeSegment ?? null,
          sector: p.sectorIndex ?? null,
          group: p.group,
          lists: (p.lists ?? []).map((l: { list: string; rank: number }) => [l.list, l.rank]),
          setup: p.classification?.setup ?? null,
          evidence: p.classification?.evidence ?? null,
          netScore: p.classification?.netScore ?? null,
          changePct: round(p.price.changePct),
          out,
        };
      });
    return { date, eligible: a.eligible.includes(date), excluded: excluded.get(date) ?? null, regime: d.header.market?.regime ?? null, benchmarkChangePct: d.header.market?.benchmarkChangePct ?? null, receipt: s.receipt?.class ?? null, horizons, predictions };
  });
  return {
    kind: EVALUATION_SUMMARY_KIND,
    schemaVersion: 1,
    ruleVersion: a.policy.referenceRuleVersion,
    policy: { decidedAt: a.policy.decidedAt, outcomesFrom: a.policy.outcomesFrom, excludedSessions: a.policy.excludedSessions, file: `public/data/ledger/${POLICY_REL}` },
    horizons: { stored: [...OD1_STORED_HORIZONS], headline: [...OD1_HEADLINE_HORIZONS] },
    note: "Research measurement of a frozen prediction rule. Close-to-close and benchmark-relative returns are not tradable; T is open(t+1) -> close(t+h) before costs. No figure here is a probability or a trading recommendation.",
    sessions,
  };
}
