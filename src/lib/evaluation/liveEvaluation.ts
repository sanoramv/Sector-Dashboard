/**
 * Live evaluation of the frozen mv1 predictions (continuous-monitoring policy, docs/design/EVALUATION_POLICY.md).
 * Pure functions over public/data/evaluation/<rule>.json; no network, no state.
 *
 * Groups use the SAME definitions as the historical reference (scripts/research/breakout-characteristics.mts):
 *  B = top-50 gainer list; C = B with setup "possible-breakout"; E / F = C with / without evidence "continuation";
 *  D = B with setup "momentum-continuation"; L = top-50 loser list (OD1 loser rules; no historical reference).
 * Shares are observed frequencies of completed outcomes, never probabilities. Uncertainty resamples whole SESSIONS,
 * because stocks on the same day move together.
 */

export const HORIZONS = [1, 2, 5, 10] as const;
export type Horizon = (typeof HORIZONS)[number];
export const OD1_CLASS_ORDER = ["confirmed", "partial", "sideways", "failed", "reversal"] as const;
export const COST_BPS = 20;
/** Minimum distinct sessions before an interval is shown at all. */
export const MIN_SESSIONS_FOR_CI = 5;
export const CHECKPOINTS = [5, 20, 50, 100, 250] as const;

export interface SummaryOutcome {
  s: "complete" | "unavailable";
  c?: string;
  R?: number;
  X?: number;
  T?: number;
  mfe?: number;
  mae?: number;
  why?: string;
}
export interface SummaryPrediction {
  id: string;
  symbol: string;
  name: string;
  industry: string;
  segment: string | null;
  sector: string | null;
  group: "gainer" | "loser";
  lists: Array<[string, number]>;
  setup: string | null;
  evidence: string | null;
  netScore: number | null;
  changePct: number;
  out: Partial<Record<`h${Horizon}`, SummaryOutcome>>;
}
export interface SummaryHorizon {
  status: string;
  reason?: string;
  end?: string;
  processedAt?: string;
}
export interface SummarySession {
  date: string;
  eligible: boolean;
  excluded: string | null;
  regime: string | null;
  benchmarkChangePct: number | null;
  receipt: string | null;
  horizons: Record<`h${Horizon}`, SummaryHorizon>;
  predictions: SummaryPrediction[];
}
export interface EvaluationSummary {
  kind: string;
  ruleVersion: string;
  policy: { decidedAt: string; outcomesFrom: string; excludedSessions: Array<{ sessionDate: string; reason: string }> };
  note: string;
  sessions: SummarySession[];
}

export type GroupKey = "B" | "C" | "E" | "F" | "D" | "L";
export const GROUP_TEXT: Record<GroupKey, string> = {
  B: "Top-50 gainers",
  C: "Possible breakout setup (top-50)",
  E: "Breakout + continuation characteristics",
  F: "Breakout without continuation characteristics",
  D: "Momentum continuation candidate (top-50)",
  L: "Top-50 losers (downside rules)",
};
const inList = (p: SummaryPrediction, list: string) => p.lists.some(([l, r]) => l === list && r <= 50);
export const GROUP_FILTER: Record<GroupKey, (p: SummaryPrediction) => boolean> = {
  B: (p) => p.group === "gainer" && inList(p, "gainer"),
  C: (p) => p.group === "gainer" && inList(p, "gainer") && p.setup === "possible-breakout",
  E: (p) => p.group === "gainer" && inList(p, "gainer") && p.setup === "possible-breakout" && p.evidence === "continuation",
  F: (p) => p.group === "gainer" && inList(p, "gainer") && p.setup === "possible-breakout" && p.evidence !== "continuation",
  D: (p) => p.group === "gainer" && inList(p, "gainer") && p.setup === "momentum-continuation",
  L: (p) => p.group === "loser" && inList(p, "loser"),
};

/** Official sessions: eligible and not excluded by the policy (2026-11-18 never counts). */
export const officialSessions = (s: EvaluationSummary) => s.sessions.filter((x) => x.eligible && !x.excluded);

export interface Interval {
  value: number | null;
  ci: [number, number] | null;
}
export interface HorizonStats {
  horizon: Horizon;
  /** predictions in the group on official sessions */
  predictions: number;
  complete: number;
  unavailable: Record<string, number>;
  pending: number;
  sessionsWithOutcomes: number;
  classes: Record<string, number>;
  adverse: Interval;
  confirmed: Interval;
  hitR: number | null;
  hitX: number | null;
  meanR: Interval;
  medianR: number | null;
  meanX: Interval;
  medianX: number | null;
  /** tradable: open(t+1) -> close(t+h) minus COST_BPS */
  meanNet: Interval;
  meanMfe: number | null;
  meanMae: number | null;
}

/** Deterministic PRNG (mulberry32) so intervals do not change between page loads. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mean of per-row values with a 95% interval from resampling whole sessions (null below MIN_SESSIONS_FOR_CI). */
export function sessionBootstrap(rows: Array<{ session: string; v: number }>, reps = 1000, seed = 20261124): Interval {
  if (rows.length === 0) return { value: null, ci: null };
  const by = new Map<string, { n: number; d: number }>();
  for (const r of rows) {
    const e = by.get(r.session) ?? { n: 0, d: 0 };
    e.n += r.v;
    e.d += 1;
    by.set(r.session, e);
  }
  const groups = [...by.values()];
  const value = groups.reduce((a, g) => a + g.n, 0) / groups.reduce((a, g) => a + g.d, 0);
  if (groups.length < MIN_SESSIONS_FOR_CI) return { value, ci: null };
  const rnd = mulberry32(seed);
  const xs: number[] = [];
  for (let k = 0; k < reps; k++) {
    let n = 0;
    let d = 0;
    for (let j = 0; j < groups.length; j++) {
      const g = groups[Math.floor(rnd() * groups.length)];
      n += g.n;
      d += g.d;
    }
    if (d > 0) xs.push(n / d);
  }
  xs.sort((a, b) => a - b);
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
  return { value, ci: [q(0.025), q(0.975)] };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function horizonStats(summary: EvaluationSummary, group: GroupKey, h: Horizon, reps = 1000): HorizonStats {
  const rows: Array<{ session: string; p: SummaryPrediction; o: SummaryOutcome | undefined; stored: boolean }> = [];
  for (const s of officialSessions(summary)) {
    const stored = s.horizons[`h${h}`]?.status === "stored";
    for (const p of s.predictions) if (GROUP_FILTER[group](p)) rows.push({ session: s.date, p, o: p.out[`h${h}`], stored });
  }
  const done = rows.filter((r) => r.o?.s === "complete") as Array<{ session: string; p: SummaryPrediction; o: SummaryOutcome }>;
  const unavailable: Record<string, number> = {};
  for (const r of rows) if (r.o?.s === "unavailable") unavailable[r.o.why ?? "unknown"] = (unavailable[r.o.why ?? "unknown"] ?? 0) + 1;
  const classes: Record<string, number> = {};
  for (const r of done) classes[r.o.c!] = (classes[r.o.c!] ?? 0) + 1;
  const share = (pred: (o: SummaryOutcome) => boolean) => sessionBootstrap(done.map((r) => ({ session: r.session, v: pred(r.o) ? 100 : 0 })), reps);
  const val = (k: "R" | "X") => sessionBootstrap(done.map((r) => ({ session: r.session, v: r.o[k] as number })), reps);
  const tradable = done.filter((r) => typeof r.o.T === "number");
  return {
    horizon: h,
    predictions: rows.length,
    complete: done.length,
    unavailable,
    pending: rows.filter((r) => !r.o).length,
    sessionsWithOutcomes: new Set(done.map((r) => r.session)).size,
    classes,
    adverse: share((o) => o.c === "failed" || o.c === "reversal"),
    confirmed: share((o) => o.c === "confirmed"),
    hitR: done.length ? (100 * done.filter((r) => (r.o.R as number) > 0).length) / done.length : null,
    hitX: done.length ? (100 * done.filter((r) => (r.o.X as number) > 0).length) / done.length : null,
    meanR: val("R"),
    medianR: median(done.map((r) => r.o.R as number)),
    meanX: val("X"),
    medianX: median(done.map((r) => r.o.X as number)),
    meanNet: sessionBootstrap(tradable.map((r) => ({ session: r.session, v: (r.o.T as number) - COST_BPS / 100 })), reps),
    meanMfe: mean(done.map((r) => r.o.mfe).filter((x): x is number => typeof x === "number")),
    meanMae: mean(done.map((r) => r.o.mae).filter((x): x is number => typeof x === "number")),
  };
}

/** What the current sample can support (see docs/design/EVALUATION_POLICY.md and the strategic reset). */
export function checkpointOf(sessionsWithOutcomes: number): { reached: number | null; next: number | null; message: string } {
  const reached = [...CHECKPOINTS].reverse().find((c) => sessionsWithOutcomes >= c) ?? null;
  const next = CHECKPOINTS.find((c) => sessionsWithOutcomes < c) ?? null;
  const message =
    reached === null
      ? "Operational check only: too few sessions for any performance conclusion."
      : reached < 20
        ? "Operational validation: outcomes compute and coverage can be checked; performance figures are anecdotal."
        : reached < 50
          ? "First look: only gross failures (far from the historical rates) are detectable; one market mood dominates."
          : reached < 100
            ? "Early evidence for large differences; small groups (breakouts without continuation) remain unresolved."
            : reached < 250
              ? "Moderate confidence for large effects; regime coverage still limited."
              : "Long-term research milestone reached: confirmatory reading of the pre-registered hypotheses (noting interim looks).";
  return { reached, next, message };
}

/** Totals for the status strip. */
export function overview(summary: EvaluationSummary) {
  const official = officialSessions(summary);
  const perH = Object.fromEntries(
    HORIZONS.map((h) => {
      let mature = 0;
      let pending = 0;
      for (const s of official) {
        const n = s.predictions.length;
        if (s.horizons[`h${h}`]?.status === "stored") mature += n;
        else pending += n;
      }
      return [`h${h}`, { mature, pending }];
    }),
  ) as Record<`h${Horizon}`, { mature: number; pending: number }>;
  return {
    captured: summary.sessions.reduce((a, s) => a + s.predictions.length, 0),
    sessions: summary.sessions.length,
    official: official.length,
    excluded: summary.sessions.filter((s) => s.excluded || !s.eligible).map((s) => ({ date: s.date, reason: s.excluded ?? (s.date < summary.policy.outcomesFrom ? "before the evaluation policy start" : "not eligible") })),
    perH,
  };
}
