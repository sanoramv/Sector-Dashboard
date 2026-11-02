/**
 * The only date a rule version may be enabled from (Phase A1): the next eligible, not-yet-captured NSE trading session
 * after the latest PUBLISHED market date. There is deliberately no override: historical enabling would be backfill.
 */
import { addDays, isWeekend } from "./calendar.mts";
import type { DateStatus } from "../lib/refresh-state.mts";

export interface EnableInputs {
  /** manifest.latestMarketDate, or null if it cannot be established */
  latestMarketDate: string | null;
  /** The pipeline's own classification of dates (calendar.dateStatuses) */
  statuses: Record<string, DateStatus>;
  /** Weekend special sessions declared through protocol/calendar overrides */
  overrides?: ReadonlySet<string>;
  /** Dates that already have a daily file under any rule version */
  capturedDates?: ReadonlySet<string>;
  /** Weekdays that are due by the clock, newest first (refresh-state.targetDates). Used to detect a stale checkout. */
  dueDates?: string[];
}

export type EnableDecision = { ok: true; expected: string } | { ok: false; reason: string; expected?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string) => {
  if (!DATE_RE.test(d)) return false;
  const t = Date.parse(`${d}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
};

/** The next eligible session after the latest published date, or the reason it cannot be determined. */
export function expectedEnableDate(inp: EnableInputs): EnableDecision {
  let staleReason = "";
  const latest = inp.latestMarketDate;
  if (!latest || !validDate(latest)) return { ok: false, reason: "The latest published market date cannot be established from manifest.json; refusing to enable." };
  const overrides = inp.overrides ?? new Set<string>();
  // Stale checkout: every due weekday after the latest published date must already be a known holiday, except the
  // newest due day, which may simply not have been fetched yet. Anything else means this checkout is behind.
  if (inp.dueDates) {
    const newerDue = inp.dueDates.filter((d) => d > latest);
    newerDue.forEach((d, i) => {
      const isNewest = i === 0;
      const st = inp.statuses[d];
      if (isNewest ? st === "trading" || st === "unresolved" : st !== "non-trading") staleReason = `This checkout looks behind the published data: ${d} was due by the clock but the local data (latest ${latest}) does not show it as ${isNewest ? "published or pending" : "a known holiday"} (status ${st ?? "absent"}). Pull the latest data and try again.`;
    });
    if (staleReason) return { ok: false, reason: staleReason };
  }
  for (let i = 1; i <= 14; i++) {
    const c = addDays(latest, i);
    if (isWeekend(c) && !overrides.has(c)) continue;
    const st = inp.statuses[c];
    if (st === "non-trading") continue; // a known exchange holiday: the next weekday is the next candidate
    if (st === undefined || st === "pending-publication") return { ok: true, expected: c };
    if (st === "trading") return { ok: false, reason: `${c} is already a published trading session (${latest} is not the latest); the published data is inconsistent, refusing to enable.` };
    return { ok: false, reason: `${c} is unresolved in the refresh state (a failed or incomplete archive); the next session is ambiguous, refusing to enable.` };
  }
  return { ok: false, reason: `No next trading session could be established within 14 days after ${latest}.` };
}

export function checkEnableDate(from: string, inp: EnableInputs): EnableDecision {
  if (!validDate(from)) return { ok: false, reason: `--from ${JSON.stringify(from)} is not a valid YYYY-MM-DD date.` };
  const d = expectedEnableDate(inp);
  if (!d.ok) return d;
  const latest = inp.latestMarketDate as string;
  if (from <= latest) return { ok: false, expected: d.expected, reason: `--from ${from} is on or before the latest published market date ${latest}. Historical enabling would be backfill and is not permitted in Phase A1. Use --from ${d.expected}.` };
  if (inp.capturedDates?.has(from)) return { ok: false, expected: d.expected, reason: `${from} already has a captured daily file.` };
  if (from !== d.expected) return { ok: false, expected: d.expected, reason: `--from ${from} is not the next eligible session. After ${latest} the next eligible session is ${d.expected}; skipping or postponing it is not permitted. Use --from ${d.expected}.` };
  return d;
}
