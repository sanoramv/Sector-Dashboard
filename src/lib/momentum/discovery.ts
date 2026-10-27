import type { AppSettings } from "../../types/config";
import type { DailyBar } from "../../types/market";
import type { DiscoveryGroup, DiscoveryResult, ExcludedMover, MomentumCandidate, SectorMarketContext } from "../../types/momentum";
import type { Regime } from "../../types/metrics";
import { ok, unavailable, type Maybe } from "../../types/metrics";
import { computeReturnOverSessions } from "../calculations/returns";
import { computeRelativeStrength } from "../calculations/relativeStrength";
import { describeBreak } from "../calculations/validation";
import { comparableBarsUpTo, type PreparedUniverse, type UniverseStock } from "./universe";
import { MARKET_CONTEXT_INDICES } from "../../config/marketIndices";
import { computeActivityFeatures, computePatternContext, computePriceAction } from "./features";
import { classify, explainFactors, lowConfidenceReasons, MOMENTUM_RULES } from "./classify";
import { assessEvidence } from "./assess";
import { indexContextAt, type IndexContextAt } from "./market";

/** Default list length: the size of a typical "top gainers / top losers" list. Fixed, not tuned. */
export const DEFAULT_TOP_N = 20;

/** Minimum industry peers for the stock-specific vs sector-wide judgement (matches the dashboard's industry minimum of 3). */
const MIN_PEERS = 3;

interface Mover {
  stock: UniverseStock;
  i: number;
  changePct: number;
  /** 21-session return within comparable bars, if available (for industry relative strength). */
  r21: number | null;
}

export interface DayMovers {
  date: string;
  movers: Mover[];
  excluded: ExcludedMover[];
  noSessionCount: number;
  universeSize: number;
}

/**
 * Every universe stock's comparable one-session change on `date`. A stock is
 * not ranked when it has no bar that day, or when that day's bar starts a
 * new comparable segment (suspected corporate action, unverified gap-down,
 * missing sessions): an unadjusted -50% "move" on a bonus ex-date must not
 * appear as a top loser. Such stocks are listed in `excluded`, never dropped
 * silently.
 */
export function moversOn(u: PreparedUniverse, date: string): DayMovers {
  const movers: Mover[] = [];
  const excluded: ExcludedMover[] = [];
  let noSession = 0;
  for (const stock of u.stocks) {
    const i = stock.indexByDate.get(date);
    if (i === undefined) {
      noSession += 1;
      continue;
    }
    if (stock.posInSeg[i] === 0) {
      const brk = stock.breakAt[i];
      const raw = i > 0 ? (stock.bars[i].close / stock.bars[i - 1].close - 1) * 100 : null;
      excluded.push({
        symbol: stock.symbol,
        reason: brk ? brk.kind : "first-bar-in-history",
        rawChangePct: raw,
        detail: brk ? describeBreak(brk) : "first available bar - no previous comparable close",
      });
      continue;
    }
    const bars = stock.segments[stock.segOf[i]];
    const p = stock.posInSeg[i];
    const changePct = (bars[p].close / bars[p - 1].close - 1) * 100;
    const r21 = p >= 21 ? (bars[p].close / bars[p - 21].close - 1) * 100 : null;
    movers.push({ stock, i, changePct, r21 });
  }
  return { date, movers, excluded, noSessionCount: noSession, universeSize: u.stocks.length };
}

/** Top-N by change (gainers: largest positive first; losers: most negative first); ties broken by symbol so the result is deterministic. */
export function rankMovers<T extends { changePct: number; stock: { symbol: string } }>(movers: T[], group: DiscoveryGroup, topN: number): T[] {
  const filtered = movers.filter((m) => (group === "gainer" ? m.changePct > 0 : m.changePct < 0));
  filtered.sort((a, b) => (group === "gainer" ? b.changePct - a.changePct : a.changePct - b.changePct) || a.stock.symbol.localeCompare(b.stock.symbol));
  return filtered.slice(0, topN);
}

function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Memoised index context for one date (NIFTY 50 and sector indices), so each is computed once per date. */
export function indexContextCache(u: PreparedUniverse, date: string): (slug: string) => IndexContextAt | null {
  const cache = new Map<string, IndexContextAt | null>();
  return (slug) => {
    if (!cache.has(slug)) {
      const index = u.indices.get(slug);
      cache.set(slug, index ? indexContextAt(u, index, date) : null);
    }
    return cache.get(slug) as IndexContextAt | null;
  };
}

export interface CandidateBuildContext {
  settings: AppSettings;
  marketRegime: Regime;
  /** Movers on the same date (for industry peer statistics). */
  day: DayMovers;
  /** Benchmark bars up to and including the date. */
  benchmarkUpTo: DailyBar[];
  activityLoaded: boolean;
  /** Prepared universe (for sector membership) and the per-date index-context cache. */
  universe: PreparedUniverse;
  indexContext: (slug: string) => IndexContextAt | null;
}

export function buildCandidate(mover: Mover, group: DiscoveryGroup, rank: number, ctx: CandidateBuildContext): MomentumCandidate {
  const { stock, i } = mover;
  const bars = comparableBarsUpTo(stock, i);
  const date = bars[bars.length - 1].date;

  const price = computePriceAction(bars);
  const patterns = computePatternContext(bars, ctx.settings);
  const activity = computeActivityFeatures(bars, stock.activityByDate, ctx.activityLoaded);

  const peers = ctx.day.movers.filter((m) => m.stock.industry === stock.industry && m.stock.symbol !== stock.symbol);
  const peerMedian = peers.length >= MIN_PEERS ? medianOf(peers.map((m) => m.changePct)) : null;
  const moveScope: SectorMarketContext["moveScope"] =
    peerMedian === null
      ? "unknown"
      : Math.sign(peerMedian) === Math.sign(mover.changePct) && Math.abs(peerMedian) >= MOMENTUM_RULES.sectorWideMinPeerMovePct
        ? "sector-wide"
        : "stock-specific";

  const benchR21 = computeReturnOverSessions(ctx.benchmarkUpTo, 21);
  const peerR21 = peers.map((m) => m.r21).filter((r): r is number => r !== null);
  const industryRelativeStrength1m: Maybe<number> =
    !benchR21.available
      ? unavailable(`benchmark return unavailable: ${benchR21.reason}`)
      : peerR21.length >= MIN_PEERS
        ? ok((medianOf(peerR21) as number) - benchR21.value)
        : unavailable(`fewer than ${MIN_PEERS} industry peers with 21 comparable sessions`);
  const benchD1 = computeReturnOverSessions(ctx.benchmarkUpTo, 1);

  const sectorSlug = ctx.universe.sectorsOf.get(stock.symbol)?.find((slug) => ctx.universe.indices.has(slug)) ?? null;
  const sectorIndex = sectorSlug ? ctx.indexContext(sectorSlug) : null;
  const nifty50 = ctx.indexContext(MARKET_CONTEXT_INDICES[0].slug);
  const stockVsSectorIndexPp = sectorIndex && sectorIndex.changePct.available ? mover.changePct - sectorIndex.changePct.value : null;

  const brk = stock.breakAt[i - stock.posInSeg[i]];
  const notes: string[] = [];
  if (brk) notes.push(`Features use only prices from ${bars[0].date} (${describeBreak(brk)}).`);
  const segmentStart = bars[0].date;

  const base = {
    symbol: stock.symbol,
    companyName: stock.companyName,
    industry: stock.industry,
    segment: stock.segment,
    group,
    rank,
    date,
    price,
    patterns,
    activity,
    context: {
      industry: stock.industry,
      peerCount: peers.length,
      peerMedianChangePct: peerMedian,
      stockVsPeersPp: peerMedian === null ? null : mover.changePct - peerMedian,
      moveScope,
      relativeStrength1m: computeRelativeStrength(bars, ctx.benchmarkUpTo).m1,
      industryRelativeStrength1m,
      benchmarkChangePct: benchD1,
      marketRegime: ctx.marketRegime,
      nifty50,
      sectorIndex,
      stockVsSectorIndexPp,
    },
    quality: {
      status: (brk || bars.length < MOMENTUM_RULES.minBarsForEvidence || !activity.available ? "limited" : "ok") as "ok" | "limited",
      barsUsed: bars.length,
      usableFrom: segmentStart,
      notes,
    },
  };
  const { continuation, reversal } = explainFactors(base);
  return {
    ...base,
    label: classify(base),
    assessment: assessEvidence(base),
    continuationFactors: continuation,
    reversalFactors: reversal,
    lowConfidenceReasons: lowConfidenceReasons(base, group),
  };
}

/**
 * Top gainers and top losers for `date`, with every feature computed from
 * data available at that date's close. `marketRegime` should come from
 * marketContextAt(u, date, settings).regime.
 */
export function makeBuildContext(u: PreparedUniverse, date: string, settings: AppSettings, marketRegime: Regime, day: DayMovers): CandidateBuildContext {
  const benchIdx = u.calendarIndex.get(date);
  const benchmarkUpTo = benchIdx === undefined ? u.benchmark.filter((b) => b.date <= date) : u.benchmark.slice(0, benchIdx + 1);
  return { settings, marketRegime, day, benchmarkUpTo, activityLoaded: u.activityLoaded, universe: u, indexContext: indexContextCache(u, date) };
}

/**
 * Relative volume (today / mean of the previous 20 comparable sessions'
 * volume) for ranking unusual-volume movers - the same definition the
 * candidate features use. Null when the baseline is incomplete.
 */
export function moverRelativeVolume(m: Mover): number | null {
  const bars = m.stock.segments[m.stock.segOf[m.i]];
  const p = m.stock.posInSeg[m.i];
  const today = m.stock.activityByDate.get(bars[p].date);
  if (!today || p < 1) return null;
  const prior = bars
    .slice(Math.max(0, p - 20), p)
    .map((b) => m.stock.activityByDate.get(b.date))
    .filter((r) => r !== undefined);
  if (prior.length < 18) return null;
  const mean = prior.reduce((a, r) => a + r.volume, 0) / prior.length;
  return mean > 0 ? today.volume / mean : null;
}

/** Top-N by relative volume among ranked stocks with a nonzero change (direction defines the group); ties by symbol. */
export function rankVolumeMovers(movers: Mover[], topN: number): Array<{ mover: Mover; rvol: number }> {
  return movers
    .filter((m) => m.changePct !== 0)
    .map((mover) => ({ mover, rvol: moverRelativeVolume(mover) }))
    .filter((x): x is { mover: Mover; rvol: number } => x.rvol !== null)
    .sort((a, b) => b.rvol - a.rvol || a.mover.stock.symbol.localeCompare(b.mover.stock.symbol))
    .slice(0, topN);
}

/**
 * Top gainers, top losers and unusual-volume movers for `date`, with every
 * feature computed from data available at that date's close.
 * `marketRegime` should come from marketContextAt(u, date, settings).regime.
 */
export function discover(u: PreparedUniverse, date: string, settings: AppSettings, marketRegime: Regime, topN = DEFAULT_TOP_N): DiscoveryResult {
  const day = moversOn(u, date);
  const ctx = makeBuildContext(u, date, settings, marketRegime, day);
  const build = (group: DiscoveryGroup) => rankMovers(day.movers, group, topN).map((m, k) => buildCandidate(m, group, k + 1, ctx));
  return {
    date,
    eligibleCount: day.movers.length,
    universeSize: day.universeSize,
    noSessionCount: day.noSessionCount,
    unchangedCount: day.movers.filter((m) => m.changePct === 0).length,
    excluded: day.excluded,
    gainers: build("gainer"),
    losers: build("loser"),
    volumeMovers: rankVolumeMovers(day.movers, topN).map(({ mover }, k) => buildCandidate(mover, mover.changePct > 0 ? "gainer" : "loser", k + 1, ctx)),
  };
}
