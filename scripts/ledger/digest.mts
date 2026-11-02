/**
 * R10 input digests (design §10.3, `digest-v1`): per-symbol and per-index SHA-256 over every stored row in the
 * 365-calendar-day window ending at the session date. Compares the data with itself over time, so market
 * moves can never trigger a mismatch - only a change in the stored rows can.
 */
import type { DailyBar } from "../../src/types/market.ts";
import type { ActivityRow } from "../../src/types/activity.ts";
import { sha256Hex } from "./canonical.mts";
import { DIGEST_ID, READINESS } from "./constants.mts";
import { addDays } from "./calendar.mts";

const num = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** `(session − 365d, session]` */
export function windowStart(sessionDate: string, days: number = READINESS.R10.windowCalendarDays): string {
  return addDays(sessionDate, -days);
}

export function symbolDigest(symbol: string, bars: DailyBar[], activity: ActivityRow[] | undefined, sessionDate: string): string {
  const lo = windowStart(sessionDate);
  const byDate = new Map((activity ?? []).map((r) => [r.date, r]));
  const lines: string[] = [];
  for (const b of [...bars].sort((a, c) => a.date.localeCompare(c.date))) {
    if (b.date <= lo || b.date > sessionDate) continue;
    const a = byDate.get(b.date);
    lines.push([symbol, b.date, num(b.open), num(b.high), num(b.low), num(b.close), a ? num(a.volume) : "", a ? num(a.turnoverLakhs) : "", a ? num(a.deliveryPct) : "", a ? a.series : ""].join("|"));
  }
  return sha256Hex(lines.join("\n")).slice(0, 12);
}

export function indexDigest(slug: string, bars: DailyBar[], sessionDate: string): string {
  const lo = windowStart(sessionDate);
  const lines = [...bars]
    .sort((a, c) => a.date.localeCompare(c.date))
    .filter((b) => b.date > lo && b.date <= sessionDate)
    .map((b) => [slug, b.date, num(b.open), num(b.high), num(b.low), num(b.close)].join("|"));
  return sha256Hex(lines.join("\n")).slice(0, 12);
}

export interface InputDigest {
  windowCalendarDays: number;
  procedure: string;
  perSymbol: string[];
  indexSeries: Record<string, string>;
}

export interface DigestSource {
  stocks: Record<string, { bars: DailyBar[] } | undefined>;
  activity: Record<string, ActivityRow[]>;
  indexSeries: Record<string, { bars: DailyBar[] } | undefined>;
}

export function computeInputDigest(symbols: string[], indexSlugs: string[], src: DigestSource, sessionDate: string): InputDigest {
  return {
    windowCalendarDays: READINESS.R10.windowCalendarDays,
    procedure: DIGEST_ID,
    perSymbol: symbols.map((s) => symbolDigest(s, src.stocks[s]?.bars ?? [], src.activity[s], sessionDate)),
    indexSeries: Object.fromEntries([...indexSlugs].sort().map((slug) => [slug, indexDigest(slug, src.indexSeries[slug]?.bars ?? [], sessionDate)])),
  };
}

export interface DigestComparison {
  ok: boolean;
  /** Symbols whose stored rows differ now (still present in the data). */
  changedSymbols: string[];
  changedIndices: string[];
  /** Symbols no longer present in the source: informational, not drift. */
  removedFromSource: string[];
}

export function compareInputDigest(captured: { symbols: string[]; digest: InputDigest }, src: DigestSource, sessionDate: string): DigestComparison {
  const changedSymbols: string[] = [];
  const removedFromSource: string[] = [];
  captured.symbols.forEach((s, i) => {
    if (!src.stocks[s]) {
      removedFromSource.push(s);
      return;
    }
    if (symbolDigest(s, src.stocks[s]!.bars, src.activity[s], sessionDate) !== captured.digest.perSymbol[i]) changedSymbols.push(s);
  });
  const changedIndices = Object.entries(captured.digest.indexSeries)
    .filter(([slug, d]) => indexDigest(slug, src.indexSeries[slug]?.bars ?? [], sessionDate) !== d)
    .map(([slug]) => slug);
  return { ok: changedSymbols.length === 0 && changedIndices.length === 0, changedSymbols, changedIndices, removedFromSource };
}
