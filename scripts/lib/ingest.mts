/**
 * Turns one archive download outcome into (a) a recorded per-date status and
 * (b) merged rows - pure, so the "never replace good data with a bad
 * download" rules are unit-tested. Rows are only ever APPENDED from a file
 * that validated and is for exactly the requested date; nothing is removed
 * here, so a failed, invalid or incomplete download leaves existing data as it was.
 */
import type { DailyBar, IndexSeries, StockSeries } from "../../src/types/market.ts";
import type { ActivityRow } from "../../src/types/activity.ts";
import { parseActivityColumns } from "../../src/lib/activity.ts";
import type { ArchiveOutcome } from "./http.mts";
import { interpretArchive } from "./archives.mts";
import { nseDateToIso, nseMonthNameDateToIso } from "./dates.mts";
import type { ArchiveEntry, RefreshState } from "./refresh-state.mts";

function failureEntry(outcome: Extract<ArchiveOutcome, { kind: "failed" }>, checkedAt: string): ArchiveEntry {
  return {
    status: outcome.category === "invalid-content" ? "invalid" : "failed",
    checkedAt,
    detail: `${outcome.category}: ${outcome.detail}`,
    attempts: outcome.attempts,
  };
}

const validBar = (b: DailyBar) => [b.open, b.high, b.low, b.close].every((v) => Number.isFinite(v) && v > 0);

export interface IndexIngestContext {
  defs: Array<{ slug: string; nseIndexName: string }>;
  benchmarkIndexName: string;
  checkedAt: string;
}

export function ingestIndexOutcome(
  series: Record<string, IndexSeries>,
  state: RefreshState,
  iso: string,
  outcome: ArchiveOutcome,
  ctx: IndexIngestContext,
): ArchiveEntry {
  let entry: ArchiveEntry;
  if (outcome.kind === "not-found") {
    entry = { status: "missing", checkedAt: ctx.checkedAt, attempts: outcome.attempts };
  } else if (outcome.kind === "failed") {
    entry = failureEntry(outcome, ctx.checkedAt);
  } else {
    const parsed = interpretArchive("index", outcome.text, iso);
    if (parsed.kind !== "match") {
      entry = { status: parsed.kind === "earlier-session" ? "earlier-session" : "invalid", checkedAt: ctx.checkedAt, attempts: outcome.attempts, detail: `file is for ${parsed.fileDate}` };
    } else if (!parsed.rows.some((r) => r["Index Name"]?.trim() === ctx.benchmarkIndexName)) {
      entry = { status: "invalid", checkedAt: ctx.checkedAt, attempts: outcome.attempts, detail: `file has no ${ctx.benchmarkIndexName} row` };
    } else {
      let kept = 0;
      for (const def of ctx.defs) {
        const row = parsed.rows.find((r) => r["Index Name"]?.trim() === def.nseIndexName);
        if (!row) continue;
        const bar = {
          date: nseDateToIso(row["Index Date"]),
          open: Number(row["Open Index Value"]),
          high: Number(row["High Index Value"]),
          low: Number(row["Low Index Value"]),
          close: Number(row["Closing Index Value"]),
        };
        if (!validBar(bar)) continue;
        (series[def.slug] ??= { slug: def.slug, nseIndexName: def.nseIndexName, bars: [] }).bars.push(bar);
        kept += 1;
      }
      entry = { status: "ok", checkedAt: ctx.checkedAt, attempts: outcome.attempts, detail: `${kept} tracked series` };
    }
  }
  state.archives.index[iso] = entry;
  return entry;
}

export interface StockIngestContext {
  requiredSymbols: Set<string>;
  trackedSeries: Set<string>;
  symbolSetHash: string;
  /** Tracked symbols expected to trade on this date (from existing history). */
  expectedSymbols: number;
  /** Reject a file carrying fewer than this share of expectedSymbols (when expectedSymbols >= 20). */
  minCoverage: number;
  checkedAt: string;
  /** Rows kept per series, for the run log. */
  rowsPerSeries?: Map<string, number>;
  /**
   * When given, each merged row's trading activity (volume, turnover,
   * delivery %, series) is appended here - from the same validated row as
   * its OHLC bar, so the two can never disagree about the date. A row whose
   * activity columns are not valid numbers keeps its bar but adds no
   * activity (counted in `activitySkipped`), never a zero.
   */
  activity?: Record<string, ActivityRow[]>;
  activitySkipped?: { count: number };
}

export function ingestStockOutcome(
  stocks: Record<string, StockSeries>,
  state: RefreshState,
  iso: string,
  outcome: ArchiveOutcome,
  ctx: StockIngestContext,
): ArchiveEntry {
  let entry: ArchiveEntry;
  if (outcome.kind === "not-found") {
    entry = { status: "missing", checkedAt: ctx.checkedAt, attempts: outcome.attempts };
  } else if (outcome.kind === "failed") {
    entry = failureEntry(outcome, ctx.checkedAt);
  } else {
    const parsed = interpretArchive("stocks", outcome.text, iso);
    if (parsed.kind !== "match") {
      entry = { status: parsed.kind === "earlier-session" ? "earlier-session" : "invalid", checkedAt: ctx.checkedAt, attempts: outcome.attempts, detail: `file is for ${parsed.fileDate}` };
    } else {
      const rows: Array<{ symbol: string; series: string; bar: DailyBar; activity: ActivityRow | null }> = [];
      for (const row of parsed.rows) {
        if (!ctx.trackedSeries.has(row["SERIES"])) continue;
        const symbol = row["SYMBOL"];
        if (!ctx.requiredSymbols.has(symbol)) continue;
        const bar = {
          date: nseMonthNameDateToIso(row["DATE1"]),
          open: Number(row["OPEN_PRICE"]),
          high: Number(row["HIGH_PRICE"]),
          low: Number(row["LOW_PRICE"]),
          close: Number(row["CLOSE_PRICE"]),
        };
        if (validBar(bar)) {
          const activity = parseActivityColumns(bar.date, row["SERIES"], row["TTL_TRD_QNTY"], row["TURNOVER_LACS"], row["DELIV_PER"]);
          rows.push({ symbol, series: row["SERIES"], bar, activity });
        }
      }
      if (ctx.expectedSymbols >= 20 && rows.length < ctx.expectedSymbols * ctx.minCoverage) {
        entry = {
          status: "incomplete",
          checkedAt: ctx.checkedAt,
          attempts: outcome.attempts,
          detail: `only ${rows.length} tracked symbols in file, expected about ${ctx.expectedSymbols}`,
        };
      } else {
        for (const { symbol, series, bar, activity } of rows) {
          (stocks[symbol] ??= { symbol, bars: [] }).bars.push(bar);
          ctx.rowsPerSeries?.set(series, (ctx.rowsPerSeries.get(series) ?? 0) + 1);
          if (ctx.activity) {
            if (activity) (ctx.activity[symbol] ??= []).push(activity);
            else if (ctx.activitySkipped) ctx.activitySkipped.count += 1;
          }
        }
        entry = { status: "ok", checkedAt: ctx.checkedAt, attempts: outcome.attempts, symbolSetHash: ctx.symbolSetHash, detail: `${rows.length} tracked symbols` };
      }
    }
  }
  state.archives.stocks[iso] = entry;
  return entry;
}

/** Dedupes by date (a later-ingested bar for the same date wins), drops bars before `cutoffIso`, sorts ascending. */
export function finalizeBars<T extends { date: string }>(bars: T[], cutoffIso: string): T[] {
  const dedup = new Map(bars.map((b) => [b.date, b]));
  return [...dedup.values()].filter((b) => b.date >= cutoffIso).sort((a, b) => a.date.localeCompare(b.date));
}
