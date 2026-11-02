/** Builds one prediction record (design §6.4) from the application's own MomentumCandidate. No scoring logic lives here. */
import type { Maybe } from "../../src/types/metrics.ts";
import type { MomentumCandidate } from "../../src/types/momentum.ts";
import type { DailyBar } from "../../src/types/market.ts";
import type { PreparedUniverse } from "../../src/lib/momentum/universe.ts";
import type { ExcludedMover } from "../../src/types/momentum.ts";
import { sha256Canonical } from "./canonical.mts";
import type { BreakEvidence } from "./readiness.mts";

export interface ListEntry {
  list: "gainer" | "loser" | "volume";
  rank: number;
  setup: string;
  evidence: string;
  netScore: number;
}

export type PredictionRecord = Record<string, unknown> & { symbol: string; predictionId: string; recordHash: string };

export function buildPredictionRecord(c: MomentumCandidate, lists: ListEntry[], date: string, bar: DailyBar, ruleVersion: string): PredictionRecord {
  const unavailable: Record<string, string> = {};
  const mv = <T,>(path: string, m: Maybe<T> | null | undefined): T | null => {
    if (m && m.available) return m.value;
    if (m && !m.available) unavailable[path] = m.reason;
    return null;
  };
  const p = c.price;
  const pt = c.patterns;
  const a = c.activity;
  const cx = c.context;
  const record: Record<string, unknown> = {
    predictionId: `${date}|${c.symbol}|${ruleVersion}`,
    date,
    symbol: c.symbol,
    companyName: c.companyName,
    industry: c.industry,
    sectorIndex: cx.sectorIndex?.slug ?? null,
    sizeSegment: c.segment,
    group: c.group,
    lists,
    classification: {
      setup: c.label,
      evidence: c.assessment.category,
      netScore: c.assessment.total,
      components: c.assessment.components,
      missingEvidence: c.assessment.missingEvidence,
      rationale: c.assessment.rationale,
      forFactors: c.continuationFactors,
      againstFactors: c.reversalFactors,
      lowConfidenceReasons: c.lowConfidenceReasons,
      quality: c.quality,
    },
    bar: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, prevClose: p.prevClose },
    price: {
      changePct: p.dailyChangePct,
      gapPct: p.gapPct,
      openToClosePct: p.openToClosePct,
      closeLocation: p.closeLocation,
      rangePct: p.rangePct,
      bodyShare: p.bodyShare,
      upperWickShare: p.upperWickShare,
      lowerWickShare: p.lowerWickShare,
      r3: mv("price.r3", p.r3),
      r5: mv("price.r5", p.r5),
      r10: mv("price.r10", p.r10),
      r20: mv("price.r20", p.r20),
      volatility20: mv("price.volatility20", p.volatility20),
      moveZ: mv("price.moveZ", p.moveZ),
      distSma20Pct: mv("price.distSma20Pct", p.distSma20Pct),
      distSma50Pct: mv("price.distSma50Pct", p.distSma50Pct),
      distSma200Pct: mv("price.distSma200Pct", p.distSma200Pct),
      distanceFrom52wHigh: mv("price.distanceFrom52wHigh", p.distanceFrom52wHigh),
      distFromSwingHigh20Pct: mv("price.distFromSwingHigh20Pct", p.distFromSwingHigh20Pct),
    },
    patterns: {
      resistance: mv("patterns.resistance", pt.resistance),
      breakoutToday: pt.breakoutToday,
      breakdownToday: pt.breakdownToday,
      failedBreakoutToday: pt.failedBreakoutToday,
      retest: pt.retest,
      consolidationBefore: mv("patterns.consolidationBefore", pt.consolidationBefore),
      triangleBefore: mv("patterns.triangleBefore", pt.triangleBefore),
    },
    activity: {
      available: a.available,
      unavailableReason: a.unavailableReason,
      volume: a.volume,
      relativeVolume: mv("activity.relativeVolume", a.relativeVolume),
      turnoverCr: a.turnoverCr,
      medianTurnover20Cr: mv("activity.medianTurnover20Cr", a.medianTurnover20Cr),
      deliveryPct: a.deliveryPct,
      avgDeliveryPct20: mv("activity.avgDeliveryPct20", a.avgDeliveryPct20),
      series: a.series,
      tradeForTrade: a.tradeForTrade,
      zeroVolume: a.zeroVolume,
      priorParticipation: mv("activity.priorParticipation", a.priorParticipation),
      liquidityWarnings: a.liquidityWarnings,
    },
    context: {
      peerCount: cx.peerCount,
      peerMedianChangePct: cx.peerMedianChangePct,
      stockVsPeersPp: cx.stockVsPeersPp,
      moveScope: cx.moveScope,
      relativeStrength1m: mv("context.relativeStrength1m", cx.relativeStrength1m),
      industryRelativeStrength1m: mv("context.industryRelativeStrength1m", cx.industryRelativeStrength1m),
      benchmarkChangePct: mv("context.benchmarkChangePct", cx.benchmarkChangePct),
      nifty50: cx.nifty50
        ? { changePct: mv("context.nifty50.changePct", cx.nifty50.changePct), relativeStrength1m: mv("context.nifty50.relativeStrength1m", cx.nifty50.relativeStrength1m), above50dma: cx.nifty50.above50dma }
        : null,
      sectorIndex: cx.sectorIndex
        ? {
            slug: cx.sectorIndex.slug,
            displayName: cx.sectorIndex.displayName,
            changePct: mv("context.sectorIndex.changePct", cx.sectorIndex.changePct),
            relativeStrength1m: mv("context.sectorIndex.relativeStrength1m", cx.sectorIndex.relativeStrength1m),
            above50dma: cx.sectorIndex.above50dma,
            breadth50Pct: cx.sectorIndex.breadth50 ? mv("context.sectorIndex.breadth50", cx.sectorIndex.breadth50.pct) : null,
            breadth50Eligible: cx.sectorIndex.breadth50?.eligible ?? null,
          }
        : null,
      stockVsSectorIndexPp: cx.stockVsSectorIndexPp,
      marketRegime: cx.marketRegime,
    },
    unavailable,
  };
  record.recordHash = sha256Canonical(record);
  return record as PredictionRecord;
}

export interface ExcludedEvidence extends BreakEvidence {
  prevDate: string | null;
  prevClose: number | null;
  open: number | null;
  close: number | null;
  openRatio: number | null;
  rawChangePct: number | null;
  missingSessions: number | null;
  detail: string;
}

/** Evidence for every stock the application did not rank because its bar starts a discontinuity (never silently discarded). */
export function buildExcludedEvidence(u: PreparedUniverse, excluded: ExcludedMover[], date: string): ExcludedEvidence[] {
  return excluded.map((e) => {
    const st = u.bySymbol.get(e.symbol);
    const i = st?.indexByDate.get(date);
    const bar = st && i !== undefined ? st.bars[i] : undefined;
    const prev = st && i !== undefined && i > 0 ? st.bars[i - 1] : undefined;
    const brk = st && i !== undefined ? st.breakAt[i] : null;
    return {
      symbol: e.symbol,
      reason: e.reason,
      prevDate: prev?.date ?? null,
      prevClose: prev?.close ?? null,
      open: bar?.open ?? null,
      close: bar?.close ?? null,
      closeRatio: bar && prev ? bar.close / prev.close : null,
      openRatio: bar && prev ? bar.open / prev.close : null,
      rawChangePct: e.rawChangePct,
      missingSessions: brk?.missingSessions ?? null,
      detail: e.detail,
    };
  });
}
