/**
 * OD1 outcome runner — deterministic planning and record building (Phase B2a). PURE: it reads no files, writes nothing
 * and makes no network call; the caller supplies the immutable prediction files, the public market data, the public
 * holdout eligibility and the keys already in private storage. It is designed to run ONLY in the private outcome
 * repository's workflow (see outcome-pipeline.mts `assertProtectedExecutionContext`); B2a exercises it on synthetic
 * 2031 fixtures only and no entry point, workflow or activation record exists.
 *
 * Rules (sealed OD1, design §15 + erratum 22):
 *  - every stored horizon 1, 2, 5, 10 is processed; only 1 and 5 are marked `headline` (completion counts those);
 *  - maturity uses the NIFTY 500 trading calendar via `od1Maturity`: an unresolved weekday or a non-ok archive keeps
 *    the horizon pending — a session is never skipped;
 *  - sigma is the prediction record's FROZEN volatility20; the data only supplies the descriptive sigma window, which
 *    must reproduce it exactly (otherwise the source changed: blocked, never silently recomputed);
 *  - sessions that are not eligible for the live holdout (excluded, non-live) are rejected, and sessions before the
 *    owner's activation date are never processed (no automatic backfill);
 *  - nothing here ever creates or applies a correction.
 */
import { BENCHMARK } from "../../src/config/sectorUniverse.ts";
import { splitAtPriceBreaks, validateBars } from "../../src/lib/calculations/validation.ts";
import type { DailyBar } from "../../src/types/market.ts";
import type { RefreshState } from "../lib/refresh-state.mts";
import { dateStatuses } from "./calendar.mts";
import { OD1_HEADLINE_HORIZONS, OD1_STORED_HORIZONS, od1Maturity, od1SigmaWindow, type ArchiveStatus, type CalendarStatus, type Od1WindowBar } from "./od1.mts";
import { assertSyntheticSession, buildOutcomeRecord, outcomeStorageKey, type DailyLike, type OutcomeRecord, type WindowEvidence } from "./outcomes.mts";

export interface RunnerSession {
  daily: DailyLike & { predictions: Array<DailyLike["predictions"][number] & { bar: { open?: number; high: number; low: number; close: number } }> };
  /** public path of the immutable prediction file and its sha256 */
  dailyFile: string;
  dailyFileSha256: string;
  /** the session's public prediction receipt (null = none) */
  receipt: { file: string; fileSha256: string; class: string } | null;
}

export interface RunnerMarket {
  indexSeries: Record<string, { bars: DailyBar[] } | undefined>;
  stocks: Record<string, { bars: DailyBar[] } | undefined>;
  refreshState: RefreshState;
  latestDueDate: string | null;
  /** provenance of the public data the evidence was read from */
  data: { commit: string; files: Array<{ name: string; sha256: string }> };
}

export interface RunnerContext {
  ruleVersion: string;
  /** owner-approved, create-only activation (null = none: the runner refuses to plan anything) */
  activation: { outcomesFrom: string } | null;
  /** live-holdout eligibility computed by the PUBLIC guard (`computeLiveHoldout`): only these sessions are processed */
  eligibleSessions: ReadonlySet<string>;
  definitionsSha256: string;
  engine: { version: string; files: Array<{ path: string; sha256: string }> };
  generatedAt: string;
  github: { runId: string | null; runAttempt: string | null; sha: string | null };
  /** fresh 256-bit secret per record (crypto randomness in production; injected for determinism in tests) */
  newSalt: () => string;
  /** keys already present in private storage */
  stored: ReadonlySet<string>;
}

export type PlanStatus = "due" | "stored" | "pending" | "excluded" | "before-activation" | "not-live";
export interface PlanItem {
  key: string;
  sessionDate: string;
  horizon: number;
  /** true for the headline horizons (1, 5) that determine completed-session maturity */
  headline: boolean;
  status: PlanStatus;
  /** public, non-outcome reason (calendar, eligibility, activation); never anything derived from prices after t */
  reason: string;
  sessions?: string[];
}

/** Why a due horizon could not be built. Codes only: they carry no outcome information. */
export type BlockCode = "stock-absent" | "prediction-day-missing" | "source-revised" | "benchmark-missing";
export class RunnerBlock extends Error {
  constructor(
    readonly code: BlockCode,
    readonly key: string,
  ) {
    super(`${key}: ${code}`);
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The synthetic-only lock lives in outcomes.mts (it guards every artifact builder); re-exported for callers. */
export { SYNTHETIC_FROM, SYNTHETIC_ONLY, assertSyntheticSession } from "./outcomes.mts";

/** The NIFTY 500 trading calendar, calendar statuses and archive statuses from the public data. */
export function calendarInputs(market: RunnerMarket): { tradingCalendar: string[]; calendarStatus: Record<string, CalendarStatus>; archives: Record<string, ArchiveStatus>; benchmark: Map<string, number> } {
  const { bars } = validateBars(market.indexSeries[BENCHMARK.slug]?.bars ?? []);
  const calendarStatus = dateStatuses(market.refreshState, market.latestDueDate) as Record<string, CalendarStatus>;
  const archives: Record<string, ArchiveStatus> = {};
  for (const d of new Set([...Object.keys(market.refreshState.archives.index), ...Object.keys(market.refreshState.archives.stocks)])) archives[d] = { index: market.refreshState.archives.index[d]?.status ?? null, stocks: market.refreshState.archives.stocks[d]?.status ?? null };
  return { tradingCalendar: bars.map((b) => b.date), calendarStatus, archives, benchmark: new Map(bars.map((b) => [b.date, b.close])) };
}

/** Plans every (session, horizon) pair. Throws (fail closed) without an activation record or on a foreign rule version. */
export function planOutcomes(sessions: RunnerSession[], market: RunnerMarket, ctx: Pick<RunnerContext, "ruleVersion" | "activation" | "eligibleSessions" | "stored">): PlanItem[] {
  if (!ctx.activation || !DATE.test(ctx.activation.outcomesFrom)) throw new Error("no owner-approved outcome activation record: the runner refuses to process any session");
  const cal = calendarInputs(market);
  const out: PlanItem[] = [];
  for (const s of [...sessions].sort((a, b) => a.daily.header.sessionDate.localeCompare(b.daily.header.sessionDate))) {
    const date = s.daily.header.sessionDate;
    assertSyntheticSession(date);
    if (s.daily.header.model.ruleVersion !== ctx.ruleVersion) throw new Error(`${date}: prediction file has rule version ${s.daily.header.model.ruleVersion}, the runner is configured for ${ctx.ruleVersion}`);
    for (const h of OD1_STORED_HORIZONS) {
      const base = { key: outcomeStorageKey(ctx.ruleVersion, date, h), sessionDate: date, horizon: h, headline: OD1_HEADLINE_HORIZONS.includes(h) };
      if (date < ctx.activation.outcomesFrom) out.push({ ...base, status: "before-activation", reason: `before the activation date ${ctx.activation.outcomesFrom}; earlier sessions need a separate, explicitly approved catch-up` });
      else if (!ctx.eligibleSessions.has(date)) out.push({ ...base, status: "excluded", reason: "the session is not eligible for the live holdout (excluded sessions are not processed)" });
      else if (!s.receipt || s.receipt.class !== "live") out.push({ ...base, status: "not-live", reason: `the prediction receipt is ${s.receipt ? `class ${s.receipt.class}` : "missing"}` });
      else if (ctx.stored.has(base.key)) out.push({ ...base, status: "stored", reason: "already in private storage" });
      else {
        const m = od1Maturity({ sessionDate: date, h, tradingCalendar: cal.tradingCalendar, calendarStatus: cal.calendarStatus, archives: cal.archives });
        if (m.status === "pending") out.push({ ...base, status: "pending", reason: m.reason });
        else out.push({ ...base, status: "due", reason: `mature at ${m.endDate}`, sessions: m.sessions });
      }
    }
  }
  return out;
}

/** Window evidence for one prediction from the public data, with the prediction day checked against the frozen record. */
export function evidenceFor(market: RunnerMarket, calendar: string[], key: string, sessionDate: string, sessions: string[], p: RunnerSession["daily"]["predictions"][number]): WindowEvidence {
  assertSyntheticSession(sessionDate);
  const raw = market.stocks[p.symbol]?.bars;
  if (!raw || raw.length === 0) throw new RunnerBlock("stock-absent", key);
  const { bars } = validateBars(raw, { splitAtBreaks: false });
  const { segments } = splitAtPriceBreaks(bars, calendar);
  const segOf: number[] = [];
  const posInSeg: number[] = [];
  segments.forEach((seg, si) => seg.forEach((_b, pi) => (segOf.push(si), posInSeg.push(pi))));
  const at = new Map(bars.map((b, i) => [b.date, i]));
  const i = at.get(sessionDate);
  if (i === undefined) throw new RunnerBlock("prediction-day-missing", key);
  const b = bars[i];
  if (b.high !== p.bar.high || b.low !== p.bar.low || b.close !== p.bar.close) throw new RunnerBlock("source-revised", key);
  const comparable = segments[segOf[i]].slice(0, posInSeg[i] + 1);
  const window: Array<Od1WindowBar | null> = sessions.map((d) => {
    const j = at.get(d);
    if (j === undefined) return null;
    const w = bars[j];
    return { date: d, open: w.open, high: w.high, low: w.low, close: w.close, sameSegmentAsT: segOf[j] === segOf[i] };
  });
  return { bars: window, sigmaChanges: od1SigmaWindow(comparable) };
}

/** Builds the private record of one DUE plan item. Throws RunnerBlock (code only) when the evidence is not usable. */
export function buildDueRecord(item: PlanItem, session: RunnerSession, market: RunnerMarket, ctx: RunnerContext): OutcomeRecord {
  assertSyntheticSession(item.sessionDate);
  assertSyntheticSession(session.daily.header.sessionDate);
  if (item.status !== "due" || !item.sessions) throw new Error(`${item.key} is not due`);
  if (!session.receipt) throw new Error(`${item.key}: no prediction receipt`);
  const cal = calendarInputs(market);
  const closeT = cal.benchmark.get(item.sessionDate);
  const closeTh = cal.benchmark.get(item.sessions[item.sessions.length - 1]);
  if (closeT === undefined || closeTh === undefined) throw new RunnerBlock("benchmark-missing", item.key);
  const evidence = new Map<string, WindowEvidence>();
  for (const p of session.daily.predictions) evidence.set(p.symbol, evidenceFor(market, cal.tradingCalendar, item.key, item.sessionDate, item.sessions, p));
  const calendar: Record<string, CalendarStatus> = {};
  const archives: Record<string, ArchiveStatus> = {};
  for (const d of item.sessions) {
    calendar[d] = cal.calendarStatus[d];
    archives[d] = cal.archives[d];
  }
  try {
    return buildOutcomeRecord({
      daily: session.daily,
      dailyFile: session.dailyFile,
      dailyFileSha256: session.dailyFileSha256,
      receipt: session.receipt,
      horizon: item.horizon,
      sessions: item.sessions,
      calendar,
      archives,
      benchmark: { closeT, closeTh },
      evidence: (symbol) => evidence.get(symbol)!,
      definitionsSha256: ctx.definitionsSha256,
      engine: ctx.engine,
      data: market.data,
      generatedAt: ctx.generatedAt,
      github: ctx.github,
      commitmentSalt: ctx.newSalt(),
    });
  } catch (err) {
    if (/no longer reproduces the frozen volatility20/.test(String(err))) throw new RunnerBlock("source-revised", item.key);
    throw err;
  }
}
