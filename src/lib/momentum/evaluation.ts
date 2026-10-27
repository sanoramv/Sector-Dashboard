import type { AppSettings } from "../../types/config";
import type { DiscoveryGroup, MomentumLabel } from "../../types/momentum";
import type { Regime } from "../../types/metrics";
import type { PreparedUniverse } from "./universe";
import { marketContextAt } from "./market";
import { DEFAULT_TOP_N, buildCandidate, moversOn, rankMovers, type CandidateBuildContext } from "./discovery";
import { nextSessionOutcome, type NextSessionOutcome } from "./outcomes";
import { MOMENTUM_RULES } from "./classify";

/**
 * Historical, walk-forward evaluation of the Next-Day Momentum
 * classifications. For every session t in the data, in chronological order:
 *
 * 1. Rank that day's movers and classify the top N gainers and losers using
 *    ONLY data up to t's close (the same code the live page uses).
 * 2. Record the separately defined next-session outcomes (outcomes.ts).
 *
 * Nothing is fitted: the classification rules are fixed constants
 * (classify.ts), so there is no training period to leak into. The walk-
 * forward check below is the one place a number is "learned" - each label's
 * historical frequency of a positive next session - and it only ever uses
 * observations whose outcome was already known before the date being
 * predicted. It is scored against a simpler predictor (the group's own
 * running frequency) to test whether the labels add anything.
 *
 * Effective sample size: same-day candidates move together (market and
 * sector effects), so confidence intervals are clustered by date, and the
 * number of distinct dates is reported next to n.
 */

export interface EvaluationConfig {
  topN: number;
  /** Round-trip cost + slippage, basis points, applied to the tradable next-open -> next-close outcome. */
  costBps: number;
}

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = { topN: DEFAULT_TOP_N, costBps: 20 };

/** Below either threshold a statistic is flagged as insufficient. */
export const MIN_OBSERVATIONS = 30;
export const MIN_DISTINCT_DATES = 20;

export type VolumeConfirmation = "confirmed" | "not-confirmed" | "unavailable";

export interface Observation {
  date: string;
  symbol: string;
  group: DiscoveryGroup;
  label: MomentumLabel;
  volume: VolumeConfirmation;
  regime: Regime;
  /** The same stock was also in the same group on the previous session. */
  repeat: boolean;
  outcome: NextSessionOutcome;
}

export interface OutcomeStats {
  n: number;
  dates: number;
  stocks: number;
  pctPositive: number;
  /** 95% interval, clustered by date. Null with fewer than 2 dates. */
  pctPositiveCi: [number, number] | null;
  meanPct: number;
  meanCi: [number, number] | null;
  medianPct: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  /** Share of next sessions down 3% or more (close-to-close). */
  pctDown3: number;
  pctOutperformNifty: number;
  meanExcessPp: number;
  pctHigherHigh: number;
  pctLowerLow: number;
  meanGapPct: number;
  meanOpenToCloseNetPct: number;
  pctOpenToCloseNetPositive: number;
  meanMfePct: number;
  meanMaePct: number;
  repeatShare: number;
  sufficient: boolean;
  insufficientReason: string | null;
}

export interface StatsRow<K> {
  key: K;
  stats: OutcomeStats | null;
}

export interface WalkForwardResult {
  group: DiscoveryGroup;
  /** Observations scored (after the warm-up). */
  scored: number;
  brierLabelModel: number | null;
  brierGroupModel: number | null;
  /** 1 - Brier(label) / Brier(group): > 0 means the labels improved on the group's own base rate. */
  skill: number | null;
  reliability: Array<{ bin: string; n: number; meanPredicted: number; observed: number }>;
  /** Every scored prediction, in date order (for auditing that only earlier outcomes were used). */
  predictions: Array<{ date: string; symbol: string; pLabel: number; pGroup: number; positive: boolean }>;
}

export interface EvaluationResult {
  config: EvaluationConfig;
  firstDate: string | null;
  lastDate: string | null;
  sessionsEvaluated: number;
  universeSize: number;
  observations: Observation[];
  baselineAllStocks: OutcomeStats | null;
  baselineNifty500: { n: number; pctPositive: number; meanPct: number; medianPct: number } | null;
  byGroup: Array<StatsRow<DiscoveryGroup>>;
  byGroupLabel: Array<StatsRow<{ group: DiscoveryGroup; label: MomentumLabel }>>;
  byRegime: Array<StatsRow<{ group: DiscoveryGroup; regime: Regime }>>;
  byVolume: Array<StatsRow<{ group: DiscoveryGroup; volume: VolumeConfirmation }>>;
  byFold: Array<StatsRow<{ group: DiscoveryGroup; fold: number; from: string; to: string; label: MomentumLabel | null }>>;
  walkForward: WalkForwardResult[];
  exclusions: {
    pendingNextSession: number;
    noNextBar: number;
    nextSessionDiscontinuity: Record<string, number>;
    moversExcluded: Record<string, number>;
  };
  warnings: string[];
}

const LABELS: MomentumLabel[] = [
  "momentum-continuation",
  "possible-breakout",
  "possible-reversal",
  "extended-reversal-risk",
  "weak-momentum",
  "mixed-signals",
  "insufficient-evidence",
];
const GROUPS: DiscoveryGroup[] = ["gainer", "loser"];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Mean with a 95% interval whose standard error is clustered by date (observations on the same date are not independent). */
export function clusteredMean(values: number[], clusters: string[]): { mean: number; ci: [number, number] | null } {
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sums = new Map<string, number>();
  values.forEach((x, k) => sums.set(clusters[k], (sums.get(clusters[k]) ?? 0) + (x - mean)));
  const g = sums.size;
  if (g < 2) return { mean, ci: null };
  let ss = 0;
  for (const s of sums.values()) ss += s * s;
  const se = (Math.sqrt(ss) / n) * Math.sqrt(g / (g - 1));
  return { mean, ci: [mean - 1.96 * se, mean + 1.96 * se] };
}

export function computeOutcomeStats(obs: Array<Pick<Observation, "date" | "symbol" | "repeat" | "outcome">>): OutcomeStats | null {
  const n = obs.length;
  if (n === 0) return null;
  const dates = obs.map((o) => o.date);
  const c2c = obs.map((o) => o.outcome.closeToClosePct);
  const sorted = [...c2c].sort((a, b) => a - b);
  const mean = clusteredMean(c2c, dates);
  const pos = clusteredMean(
    c2c.map((x) => (x > 0 ? 100 : 0)),
    dates,
  );
  const share = (pred: (o: (typeof obs)[number]) => boolean) => (obs.filter(pred).length / n) * 100;
  const avg = (f: (o: (typeof obs)[number]) => number) => obs.reduce((s, o) => s + f(o), 0) / n;
  const distinctDates = new Set(dates).size;
  const insufficientReason =
    n < MIN_OBSERVATIONS
      ? `only ${n} observations (need ${MIN_OBSERVATIONS})`
      : distinctDates < MIN_DISTINCT_DATES
        ? `only ${distinctDates} distinct dates (need ${MIN_DISTINCT_DATES})`
        : null;
  return {
    n,
    dates: distinctDates,
    stocks: new Set(obs.map((o) => o.symbol)).size,
    pctPositive: pos.mean,
    pctPositiveCi: pos.ci,
    meanPct: mean.mean,
    meanCi: mean.ci,
    medianPct: quantile(sorted, 0.5),
    p10: quantile(sorted, 0.1),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    pctDown3: share((o) => o.outcome.closeToClosePct <= -3),
    pctOutperformNifty: share((o) => o.outcome.excessVsNifty500Pp > 0),
    meanExcessPp: avg((o) => o.outcome.excessVsNifty500Pp),
    pctHigherHigh: share((o) => o.outcome.higherHigh),
    pctLowerLow: share((o) => o.outcome.lowerLow),
    meanGapPct: avg((o) => o.outcome.gapPct),
    meanOpenToCloseNetPct: avg((o) => o.outcome.openToCloseNetPct),
    pctOpenToCloseNetPositive: share((o) => o.outcome.openToCloseNetPct > 0),
    meanMfePct: avg((o) => o.outcome.mfeFromOpenPct),
    meanMaePct: avg((o) => o.outcome.maeFromOpenPct),
    repeatShare: share((o) => o.repeat),
    sufficient: insufficientReason === null,
    insufficientReason,
  };
}

/**
 * Walk-forward test of the label frequencies. For the observations on date t,
 * each prediction uses only observations from dates BEFORE t (whose
 * next-session outcomes were known by t's close):
 *   label model: (positives + 1) / (n + 2) for the observation's group+label,
 *                falling back to the group frequency until the label has MIN_OBSERVATIONS
 *   group model: (positives + 1) / (n + 2) for the group
 * Scoring starts once the group has MIN_OBSERVATIONS prior observations.
 */
export function walkForward(obs: Observation[], group: DiscoveryGroup): WalkForwardResult {
  const mine = obs.filter((o) => o.group === group).sort((a, b) => a.date.localeCompare(b.date));
  const labelCounts = new Map<MomentumLabel, { n: number; pos: number }>();
  const groupCount = { n: 0, pos: 0 };
  let bl = 0;
  let bg = 0;
  let scored = 0;
  const bins = new Map<number, { n: number; pred: number; obs: number }>();
  const predictions: WalkForwardResult["predictions"] = [];
  let k = 0;
  while (k < mine.length) {
    const date = mine[k].date;
    const today: Observation[] = [];
    while (k < mine.length && mine[k].date === date) today.push(mine[k++]);
    if (groupCount.n >= MIN_OBSERVATIONS) {
      const pGroup = (groupCount.pos + 1) / (groupCount.n + 2);
      for (const o of today) {
        const lc = labelCounts.get(o.label);
        const pLabel = lc && lc.n >= MIN_OBSERVATIONS ? (lc.pos + 1) / (lc.n + 2) : pGroup;
        const y = o.outcome.closeToClosePct > 0 ? 1 : 0;
        bl += (pLabel - y) ** 2;
        bg += (pGroup - y) ** 2;
        scored += 1;
        predictions.push({ date: o.date, symbol: o.symbol, pLabel, pGroup, positive: y === 1 });
        const bin = Math.min(9, Math.floor(pLabel * 10));
        const b = bins.get(bin) ?? { n: 0, pred: 0, obs: 0 };
        b.n += 1;
        b.pred += pLabel;
        b.obs += y;
        bins.set(bin, b);
      }
    }
    for (const o of today) {
      const y = o.outcome.closeToClosePct > 0 ? 1 : 0;
      const lc = labelCounts.get(o.label) ?? { n: 0, pos: 0 };
      lc.n += 1;
      lc.pos += y;
      labelCounts.set(o.label, lc);
      groupCount.n += 1;
      groupCount.pos += y;
    }
  }
  const brierLabelModel = scored > 0 ? bl / scored : null;
  const brierGroupModel = scored > 0 ? bg / scored : null;
  return {
    group,
    scored,
    brierLabelModel,
    brierGroupModel,
    skill: brierLabelModel !== null && brierGroupModel ? 1 - brierLabelModel / brierGroupModel : null,
    reliability: [...bins.entries()]
      .sort(([a], [b]) => a - b)
      .map(([bin, b]) => ({ bin: `${bin * 10}-${bin * 10 + 10}%`, n: b.n, meanPredicted: (b.pred / b.n) * 100, observed: (b.obs / b.n) * 100 })),
    predictions,
  };
}

export function runMomentumEvaluation(u: PreparedUniverse, settings: AppSettings, config: EvaluationConfig = DEFAULT_EVALUATION_CONFIG): EvaluationResult {
  const observations: Observation[] = [];
  const baselineObs: Array<Pick<Observation, "date" | "symbol" | "repeat" | "outcome">> = [];
  const niftyReturns: number[] = [];
  const exclusions: EvaluationResult["exclusions"] = { pendingNextSession: 0, noNextBar: 0, nextSessionDiscontinuity: {}, moversExcluded: {} };
  let prevMembers: Record<DiscoveryGroup, Set<string>> = { gainer: new Set(), loser: new Set() };
  let sessions = 0;
  let firstDate: string | null = null;
  let lastDate: string | null = null;

  for (let ci = 1; ci < u.calendar.length; ci++) {
    const date = u.calendar[ci];
    const day = moversOn(u, date);
    if (day.movers.length === 0) continue;
    for (const ex of day.excluded) exclusions.moversExcluded[ex.reason] = (exclusions.moversExcluded[ex.reason] ?? 0) + 1;

    const next = u.calendar[ci + 1];
    if (next !== undefined) niftyReturns.push((u.benchmark[ci + 1].close / u.benchmark[ci].close - 1) * 100);

    for (const m of day.movers) {
      const r = nextSessionOutcome(u, m.stock, m.i, config.costBps);
      if (r.kind === "ok") baselineObs.push({ date, symbol: m.stock.symbol, repeat: false, outcome: r.outcome });
    }

    const regime = marketContextAt(u, date, settings).regime.regime;
    const ctx: CandidateBuildContext = { settings, marketRegime: regime, day, benchmarkUpTo: u.benchmark.slice(0, ci + 1), activityLoaded: u.activityLoaded };
    const members: Record<DiscoveryGroup, Set<string>> = { gainer: new Set(), loser: new Set() };
    let any = false;
    for (const group of GROUPS) {
      rankMovers(day.movers, group, config.topN).forEach((m, k) => {
        members[group].add(m.stock.symbol);
        const r = nextSessionOutcome(u, m.stock, m.i, config.costBps);
        if (r.kind === "pending") {
          exclusions.pendingNextSession += 1;
          return;
        }
        if (r.kind === "no-next-bar") {
          exclusions.noNextBar += 1;
          return;
        }
        if (r.kind === "discontinuity") {
          exclusions.nextSessionDiscontinuity[r.breakKind] = (exclusions.nextSessionDiscontinuity[r.breakKind] ?? 0) + 1;
          return;
        }
        const c = buildCandidate(m, group, k + 1, ctx);
        const rv = c.activity.relativeVolume;
        observations.push({
          date,
          symbol: c.symbol,
          group,
          label: c.label,
          volume: !rv.available ? "unavailable" : rv.value >= MOMENTUM_RULES.volumeConfirmRvol ? "confirmed" : "not-confirmed",
          regime,
          repeat: prevMembers[group].has(c.symbol),
          outcome: r.outcome,
        });
        any = true;
      });
    }
    prevMembers = members;
    if (any) {
      sessions += 1;
      firstDate ??= date;
      lastDate = date;
    }
  }

  const byGroup = GROUPS.map((g) => ({ key: g, stats: computeOutcomeStats(observations.filter((o) => o.group === g)) }));
  const byGroupLabel = GROUPS.flatMap((group) =>
    LABELS.map((label) => ({ key: { group, label }, stats: computeOutcomeStats(observations.filter((o) => o.group === group && o.label === label)) })),
  ).filter((r) => r.stats !== null);
  const regimes: Regime[] = ["bullish", "sideways", "bearish", "insufficient-data"];
  const byRegime = GROUPS.flatMap((group) =>
    regimes.map((regime) => ({ key: { group, regime }, stats: computeOutcomeStats(observations.filter((o) => o.group === group && o.regime === regime)) })),
  ).filter((r) => r.stats !== null);
  const vols: VolumeConfirmation[] = ["confirmed", "not-confirmed", "unavailable"];
  const byVolume = GROUPS.flatMap((group) =>
    vols.map((volume) => ({ key: { group, volume }, stats: computeOutcomeStats(observations.filter((o) => o.group === group && o.volume === volume)) })),
  ).filter((r) => r.stats !== null);

  // Three consecutive, equal-length blocks of evaluated dates: does the pattern hold across time?
  const evalDates = [...new Set(observations.map((o) => o.date))].sort();
  const byFold: EvaluationResult["byFold"] = [];
  for (let f = 0; f < 3 && evalDates.length >= 3; f++) {
    const from = evalDates[Math.floor((f * evalDates.length) / 3)];
    const to = evalDates[Math.floor(((f + 1) * evalDates.length) / 3) - 1];
    const inFold = observations.filter((o) => o.date >= from && o.date <= to);
    for (const group of GROUPS) {
      byFold.push({ key: { group, fold: f + 1, from, to, label: null }, stats: computeOutcomeStats(inFold.filter((o) => o.group === group)) });
      for (const label of LABELS) {
        const s = computeOutcomeStats(inFold.filter((o) => o.group === group && o.label === label));
        if (s) byFold.push({ key: { group, fold: f + 1, from, to, label }, stats: s });
      }
    }
  }

  const sortedNifty = [...niftyReturns].sort((a, b) => a - b);
  const discontinuities = Object.values(exclusions.nextSessionDiscontinuity).reduce((a, b) => a + b, 0);
  const warnings = [
    `Universe: today's NIFTY 500 + NIFTY Microcap 250 constituent lists (the Nifty Total Market components) applied to the whole history. Stocks that were delisted, merged or dropped from these indices during the period are missing (survivorship bias), and stocks added recently are counted as if they had always been members. Past top-gainer/loser lists therefore differ from what a live list (e.g. Groww's) showed on those days.`,
    `History: ${sessions} sessions from ${firstDate ?? "?"} to ${lastDate ?? "?"} - roughly one year in a single market environment. Features needing long windows (200-day average, 52-week high) are unavailable for the earliest part, and volume features for the first ~20 sessions with volume data.`,
    `Thresholds were fixed before this evaluation was run and are not fitted to it. Changing them after reading these results would make any improvement in-sample.`,
    `Same-day candidates are correlated (market and sector moves), so confidence intervals are clustered by date and "dates" is the better guide to sample size than n. ${observations.length > 0 ? `${((observations.filter((o) => o.repeat).length / observations.length) * 100).toFixed(0)}% of observations are a stock repeating in the same list on consecutive days.` : ""}`,
    `Corporate actions: NSE prices are unadjusted. ${Object.values(exclusions.moversExcluded).reduce((a, b) => a + b, 0)} stock-days were not ranked because that day's bar starts a price discontinuity, and ${discontinuities} candidate observations were dropped because the NEXT bar does. Some of those were genuine 15%+ gap-downs, so the worst real next-day falls are under-represented. Smaller bonuses/rights issues are not detected.`,
    `Close-to-close returns are not tradable (the signal is only known at the close). The tradable outcome is next-open to next-close, net of an assumed ${config.costBps} bps round-trip cost; MFE/MAE use the daily high/low and say nothing about the order in which they occurred.`,
    `No news or filings are used historically: the announcements feed only provides recent items, so catalyst information cannot be tested.`,
  ];

  return {
    config,
    firstDate,
    lastDate,
    sessionsEvaluated: sessions,
    universeSize: u.stocks.length,
    observations,
    baselineAllStocks: computeOutcomeStats(baselineObs),
    baselineNifty500:
      niftyReturns.length > 0
        ? {
            n: niftyReturns.length,
            pctPositive: (niftyReturns.filter((r) => r > 0).length / niftyReturns.length) * 100,
            meanPct: niftyReturns.reduce((a, b) => a + b, 0) / niftyReturns.length,
            medianPct: quantile(sortedNifty, 0.5),
          }
        : null,
    byGroup,
    byGroupLabel,
    byRegime,
    byVolume,
    byFold,
    walkForward: GROUPS.map((g) => walkForward(observations, g)),
    exclusions,
    warnings,
  };
}
