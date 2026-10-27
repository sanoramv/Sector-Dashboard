/**
 * Per-date, per-archive record of what each pipeline run actually retrieved,
 * persisted in public/data/refresh-state.json. It replaces the old rule
 * "fetch any date some series lacks", which re-downloaded every date forever
 * whenever one symbol could never have data (placeholder DUMMY symbols,
 * indices launched mid-window), and it lets a refresh be judged honestly:
 * a timeout is never a holiday, and a run that could not get the latest
 * trading day is reported as failed even if the scripts themselves exited.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import type { ArchiveKind } from "./archives.mts";

export type EntryStatus =
  /** Downloaded, validated, rows merged. */
  | "ok"
  /** HTTP 404. */
  | "missing"
  /** Valid file, but for an earlier session (NSE's bhavcopy URL does this on non-trading days). */
  | "earlier-session"
  /** Transient failure after all retries (timeout, connection, 429, 5xx, other 4xx). */
  | "failed"
  /** Body was not a valid archive (HTML page, empty, malformed, wrong/later date) after all retries. */
  | "invalid"
  /** Valid file, but far fewer tracked symbols than expected - not merged. */
  | "incomplete";

export interface ArchiveEntry {
  status: EntryStatus;
  checkedAt: string;
  detail?: string;
  attempts?: number;
  /** The tracked-symbol/series set (stocks) or tracked-index set (index) the rows were extracted for. */
  symbolSetHash?: string;
}

export interface RefreshState {
  schemaVersion: 1;
  archives: Record<ArchiveKind, Record<string, ArchiveEntry>>;
}

/** Marks entries reconstructed from data files that predate this state file (and the BE/BZ series change). */
export const BOOTSTRAP_HASH = "bootstrap-pre-refresh-state";

export function emptyState(): RefreshState {
  return { schemaVersion: 1, archives: { index: {}, stocks: {} } };
}

/** Loads the state file; uses `bootstrap()` only when the file does not exist. A corrupt file is an error, never silently reset. */
export async function loadState(path: string, bootstrap: () => RefreshState): Promise<RefreshState> {
  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return bootstrap();
    throw err;
  }
  const parsed = JSON.parse(text) as RefreshState;
  if (parsed.schemaVersion !== 1 || !parsed.archives?.index || !parsed.archives?.stocks) {
    throw new Error(`${path} has an unexpected shape - refusing to overwrite it`);
  }
  return parsed;
}

export async function saveState(path: string, state: RefreshState): Promise<void> {
  const sortEntries = (m: Record<string, ArchiveEntry>) => Object.fromEntries(Object.entries(m).sort(([a], [b]) => b.localeCompare(a)));
  await writeFile(
    path,
    JSON.stringify({ schemaVersion: 1, archives: { index: sortEntries(state.archives.index), stocks: sortEntries(state.archives.stocks) } }, null, 1),
  );
}

/** Identifies the set of index series extracted from each ind_close_all file; adding an index re-extracts older dates (bounded). */
export function indexSetHash(nseIndexNames: Iterable<string>): string {
  return createHash("sha256").update([...nseIndexNames].sort().join("|")).digest("hex").slice(0, 16);
}

/** Drops entries older than `cutoffIso` (outside the retained data window). */
export function pruneState(state: RefreshState, cutoffIso: string): void {
  for (const kind of ["index", "stocks"] as const) {
    for (const d of Object.keys(state.archives[kind])) if (d < cutoffIso) delete state.archives[kind][d];
  }
}

/**
 * Identifies the set of rows a stock archive was ingested for, and which
 * columns were extracted from them; changing series, symbols or `fields`
 * means older dates must be re-extracted (in bounded batches - see planFetch).
 * An empty `fields` keeps the original hash, so states written before
 * fields were tracked hash identically.
 */
export function symbolSetHash(symbols: Iterable<string>, series: Iterable<string>, fields = ""): string {
  const h = createHash("sha256");
  h.update([...series].sort().join(",") + "|" + [...symbols].sort().join(",") + (fields ? `|${fields}` : ""));
  return h.digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Which dates exist to be fetched
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 330 * 60_000;
/** NSE normally publishes both archives by ~18:00 IST; a date is only "due" after this time on that day. */
export const PUBLISH_CUTOFF_IST_MINUTES = 19 * 60;

/**
 * Weekdays (newest first) from the latest date whose archives are due, back
 * `calendarDays`. NSE trades Monday-Friday; weekday holidays are discovered
 * from the archives themselves, never assumed.
 */
export function targetDates(now: Date, calendarDays: number): string[] {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const cursor = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
  if (minutes < PUBLISH_CUTOFF_IST_MINUTES) cursor.setUTCDate(cursor.getUTCDate() - 1);
  const out: string[] = [];
  for (let i = 0; i < calendarDays; i++) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

/** The most recent this many due weekdays are "recent": always re-checked until resolved, and critical if unresolved. */
export const RECENT_DATES = 5;

export interface FetchPlan {
  recent: string[];
  backfill: string[];
  /** Older dates that still need fetching but exceed this run's backfill limit. */
  deferred: number;
}

/**
 * Decides which dates one archive type needs this run. Recent dates are
 * re-checked unless they were downloaded OK; older dates are only fetched
 * when never resolved, previously failed/invalid, or (stocks) extracted for
 * a different symbol/series set - and at most `maxBackfill` of them per run.
 */
export function planFetch(
  kind: ArchiveKind,
  targets: string[],
  state: RefreshState,
  opts: { maxBackfill: number; currentSymbolSetHash?: string },
): FetchPlan {
  const entries = state.archives[kind];
  const needs = (date: string, recent: boolean): boolean => {
    const e = entries[date];
    if (!e) return true;
    switch (e.status) {
      case "ok":
        // Re-extract when the date was ingested for a different symbol/series set (stocks) or index set (index).
        return opts.currentSymbolSetHash !== undefined && e.symbolSetHash !== opts.currentSymbolSetHash;
      case "missing":
      case "earlier-session":
        return recent; // settled once it ages out of the recent window
      default:
        return true; // failed / invalid / incomplete: always retry
    }
  };
  const recentDates = targets.slice(0, RECENT_DATES);
  const older = targets.slice(RECENT_DATES).filter((d) => needs(d, false));
  return {
    recent: recentDates.filter((d) => needs(d, true)),
    backfill: older.slice(0, Math.max(0, opts.maxBackfill)),
    deferred: Math.max(0, older.length - Math.max(0, opts.maxBackfill)),
  };
}

// ---------------------------------------------------------------------------
// Judging a refresh
// ---------------------------------------------------------------------------

export type DateStatus = "trading" | "non-trading" | "pending-publication" | "unresolved";

/**
 * Combines both archives' evidence for one date.
 * - Both OK -> trading.
 * - Index 404 and the bhavcopy URL serving an earlier session -> non-trading
 *   (the only holiday signal available without NSE's cookie-gated calendar API).
 * - Both 404: on the latest due date this means "not published yet"; on an
 *   older date, no archive was ever published -> treated as non-trading.
 * - Anything else (a failure, invalid/incomplete file, one archive present
 *   but not the other, or not yet checked) -> unresolved.
 */
export function reconcileDate(index: ArchiveEntry | undefined, stocks: ArchiveEntry | undefined, isLatestDue: boolean): DateStatus {
  const i = index?.status;
  const s = stocks?.status;
  if (i === "ok" && s === "ok") return "trading";
  if (i === "missing" && s === "earlier-session") return "non-trading";
  if (i === "missing" && s === "missing") return isLatestDue ? "pending-publication" : "non-trading";
  return "unresolved";
}

export interface DateIssue {
  date: string;
  index: string;
  stocks: string;
}

export interface RefreshSummary {
  outcome: "complete" | "partial" | "failed";
  /** When this summary was computed (the pipeline run's manifest step). */
  evaluatedAt: string;
  /** Latest weekday whose archives were due when the run happened. */
  latestDueDate: string;
  latestMarketDate: string;
  /** Due dates after latestMarketDate that are trading days or unresolved (excludes non-trading and not-yet-published). */
  tradingDaysBehind: number;
  unresolvedRecent: DateIssue[];
  unresolvedHistorical: DateIssue[];
  pendingPublication: string[];
  nonTradingDates: number;
  /** Older dates still to be re-extracted for the current stock symbol/series set or index set (bounded backfill). */
  backfillRemaining: number;
  reasons: string[];
}

function describe(e: ArchiveEntry | undefined): string {
  if (!e) return "not checked";
  return e.detail ? `${e.status} (${e.detail})` : e.status;
}

export function evaluateRefresh(
  state: RefreshState,
  targets: string[],
  latestMarketDate: string,
  currentSymbolSetHash: string,
  now: Date,
  /** When given, index dates extracted for a different index set also count as backfill remaining. */
  currentIndexSetHash?: string,
): RefreshSummary {
  const unresolvedRecent: DateIssue[] = [];
  const unresolvedHistorical: DateIssue[] = [];
  const pendingPublication: string[] = [];
  let nonTradingDates = 0;
  let tradingDaysBehind = 0;
  let backfillRemaining = 0;

  targets.forEach((date, i) => {
    const idx = state.archives.index[date];
    const stk = state.archives.stocks[date];
    const status = reconcileDate(idx, stk, i === 0);
    if (status === "non-trading") nonTradingDates += 1;
    if (status === "pending-publication") pendingPublication.push(date);
    if (status === "unresolved") (i < RECENT_DATES ? unresolvedRecent : unresolvedHistorical).push({ date, index: describe(idx), stocks: describe(stk) });
    if ((status === "trading" || status === "unresolved") && date > latestMarketDate) tradingDaysBehind += 1;
    if (stk?.status === "ok" && stk.symbolSetHash !== currentSymbolSetHash) backfillRemaining += 1;
    else if (currentIndexSetHash !== undefined && idx?.status === "ok" && idx.symbolSetHash !== currentIndexSetHash) backfillRemaining += 1;
  });

  const reasons: string[] = [];
  if (unresolvedRecent.length > 0) {
    reasons.push(`${unresolvedRecent.length} recent date(s) could not be retrieved: ${unresolvedRecent.map((u) => `${u.date} [index: ${u.index}; stocks: ${u.stocks}]`).join("; ")}`);
  }
  if (tradingDaysBehind > 0) reasons.push(`published market data (${latestMarketDate}) is ${tradingDaysBehind} trading day(s) behind the latest due date ${targets[0]}`);
  if (unresolvedHistorical.length > 0) reasons.push(`${unresolvedHistorical.length} older date(s) unresolved (historical gaps): ${unresolvedHistorical.map((u) => u.date).join(", ")}`);
  if (backfillRemaining > 0) reasons.push(`${backfillRemaining} older date(s) still to be re-extracted for the current tracked symbols/series/indices`);

  const outcome = unresolvedRecent.length > 0 || tradingDaysBehind > 0 ? "failed" : unresolvedHistorical.length > 0 || backfillRemaining > 0 ? "partial" : "complete";
  return {
    outcome,
    evaluatedAt: now.toISOString(),
    latestDueDate: targets[0] ?? "",
    latestMarketDate,
    tradingDaysBehind,
    unresolvedRecent,
    unresolvedHistorical,
    pendingPublication,
    nonTradingDates,
    backfillRemaining,
    reasons,
  };
}

/**
 * The manifest's refresh block. `lastCompleteRefreshAt` only advances on a
 * complete run - a partial or failed run keeps the previous value, so the
 * dashboard never implies that market data advanced when it did not.
 */
export function toRefreshStatus(summary: RefreshSummary, previousLastComplete: string | null) {
  return {
    outcome: summary.outcome,
    evaluatedAt: summary.evaluatedAt,
    lastCompleteRefreshAt: summary.outcome === "complete" ? summary.evaluatedAt : previousLastComplete,
    latestDueDate: summary.latestDueDate,
    tradingDaysBehind: summary.tradingDaysBehind,
    reasons: summary.reasons,
  };
}
