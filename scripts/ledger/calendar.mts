/**
 * Exchange calendar and the live/live-late cut-off (design §8.3).
 * The next NSE trading session is derived from the pipeline's own archive evidence (`reconcileDate`),
 * never assumed; weekend special sessions are honoured only through create-only override files.
 */
import { CUTOFF_IST, IST_OFFSET_MINUTES } from "./constants.mts";
import { reconcileDate, type DateStatus, type RefreshState } from "../lib/refresh-state.mts";

const DAY_MS = 86_400_000;

/** 09:00 IST on a calendar date, as epoch milliseconds (IST = UTC+05:30). */
export function cutoffAt(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d, CUTOFF_IST.hour, CUTOFF_IST.minute) - IST_OFFSET_MINUTES * 60_000;
}

export const addDays = (date: string, n: number): string => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export const isWeekend = (date: string): boolean => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
};

/** Status of every date the refresh state knows, using the same reconciliation as the data pipeline. */
export function dateStatuses(state: RefreshState, latestDueDate: string | null): Record<string, DateStatus> {
  const out: Record<string, DateStatus> = {};
  const dates = new Set([...Object.keys(state.archives.index), ...Object.keys(state.archives.stocks)]);
  for (const d of dates) out[d] = reconcileDate(state.archives.index[d], state.archives.stocks[d], d === latestDueDate);
  return out;
}

export type CutoffResolution =
  | { kind: "final"; cutoffMs: number; nextSession: string | null; via: "earliest" | "calendar" }
  | { kind: "pending"; waitingFor: string; earliestCutoffMs: number };

/**
 * Cut-off for session date `d` against a publication time `tPubMs`.
 * - The earliest possible next session is the first following weekday (or override day); if the push was at or
 *   before that day's 09:00 IST it is on time whatever the calendar later shows.
 * - Otherwise walk forward: a `trading` day fixes the cut-off, a `non-trading` day is skipped, and an unresolved day
 *   (not yet known) leaves the decision pending. Nothing is assumed.
 */
export function resolveCutoff(d: string, tPubMs: number, statuses: Record<string, DateStatus>, overrides: ReadonlySet<string> = new Set()): CutoffResolution {
  const candidates: string[] = [];
  for (let i = 1; i <= 21 && candidates.length < 14; i++) {
    const c = addDays(d, i);
    if (!isWeekend(c) || overrides.has(c)) candidates.push(c);
  }
  const first = candidates[0];
  const earliest = cutoffAt(first);
  if (tPubMs <= earliest) return { kind: "final", cutoffMs: earliest, nextSession: null, via: "earliest" };
  for (const c of candidates) {
    const st = overrides.has(c) ? "trading" : statuses[c];
    if (st === "trading") return { kind: "final", cutoffMs: cutoffAt(c), nextSession: c, via: "calendar" };
    if (st === "non-trading") continue;
    return { kind: "pending", waitingFor: c, earliestCutoffMs: earliest };
  }
  return { kind: "pending", waitingFor: candidates[candidates.length - 1] ?? first, earliestCutoffMs: earliest };
}
