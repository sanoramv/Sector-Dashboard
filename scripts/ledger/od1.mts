/**
 * OD1 outcome engine — shared, deterministic, pure (Phase B1). The ONLY implementation of the sealed OD1 rules
 * (protocol/od1.json, design §15). It reads no files and writes nothing; callers supply every input.
 *
 * Extracted without behaviour change from scripts/research/breakout-baseline.mts (which now imports it and reproduces
 * its frozen result digest). The one interface difference: sigma is a PARAMETER. Governed outcomes must pass the
 * prediction record's frozen `price.volatility20` (identical definition: population SD of the 20 daily % changes ending
 * at t-1, day t excluded, >= 22 comparable bars), never a value recomputed from rolling, pruned history.
 *
 * Nothing here decides what may be computed or shown: the holdout seal is enforced by the callers (see outcomes.mts).
 */
import { OD1_DEFINITIONS } from "./protocol.mts";

/** Numeric constants of the sealed protocol. k, floorPct, sigmaWindow and minComparableBars are read from the sealed
 *  definitions; the two flag multipliers exist there only as text and are pinned to it by the governance tests. */
export const OD1 = {
  k: OD1_DEFINITIONS.epsilon.k,
  floorPct: OD1_DEFINITIONS.epsilon.floorPct,
  sigmaWindow: OD1_DEFINITIONS.sigma.window,
  minComparableBars: OD1_DEFINITIONS.sigma.minComparableBars,
  abnormalGapSigma: 3,
  volWindowOutlierSigma: 3.5,
} as const;

/** Horizons the sealed protocol stores (all supported); headline horizons are reported, and count, separately. */
export const OD1_STORED_HORIZONS: readonly number[] = OD1_DEFINITIONS.horizons.stored;
export const OD1_HEADLINE_HORIZONS: readonly number[] = OD1_DEFINITIONS.horizons.headline;

export type Od1Class = "confirmed" | "partial" | "sideways" | "failed" | "reversal";
export type Od1Unavailable = "insufficient-history" | "no-bar" | "discontinuity";
export const OD1_CLASSES: readonly Od1Class[] = ["confirmed", "partial", "sideways", "failed", "reversal"];
export const OD1_UNAVAILABLE_REASONS: readonly Od1Unavailable[] = ["insufficient-history", "no-bar", "discontinuity"];

interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

const pct = (a: number, b: number) => (a / b - 1) * 100;

/** sigma window: the 20 daily % changes ending at t-1 (day t excluded). `comparable` = comparable bars up to and including t. */
export function od1SigmaWindow(comparable: Array<Pick<Ohlc, "close">>): number[] | null {
  if (comparable.length < OD1.minComparableBars) return null;
  const n = comparable.length;
  const changes: number[] = [];
  for (let k = n - 1 - OD1.sigmaWindow; k < n - 1; k++) changes.push(pct(comparable[k].close, comparable[k - 1].close));
  return changes;
}

/** Population standard deviation (divisor N) - the same arithmetic as features.ts `stdev` (volatility20). */
export function populationSd(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

/** eps_h = max(k * sigma * sqrt(h), floorPct). */
export const od1Epsilon = (sigma: number, h: number) => Math.max(OD1.k * sigma * Math.sqrt(h), OD1.floorPct);

/** First-match classification from the OD1 quantities. `up` = gainer rules; otherwise the loser mirror. */
export function od1Classify(q: { up: boolean; R: number; X: number; Hstar: number; Lstar: number; Ht: number; Lt: number; eps: number }): { cls: Od1Class; P: boolean; E: boolean; N: boolean; D: boolean; B: boolean } {
  const { up, R, X, Hstar, Lstar, Ht, Lt, eps } = q;
  const P = up ? R >= eps : R <= -eps;
  const E = up ? X > 0 : X < 0;
  const N = up ? Hstar > Ht : Lstar < Lt;
  const D = up ? R <= -eps : R >= eps;
  const B = up ? Lstar < Lt : Hstar > Ht;
  let cls: Od1Class;
  if (D && B) cls = "reversal";
  else if (D) cls = "failed";
  else if (P && E && N) cls = "confirmed";
  else if (P || E || N) cls = "partial";
  else cls = "sideways";
  return { cls, P, E, N, D, B };
}

export interface Od1Measured {
  cls: Od1Class;
  P: boolean;
  E: boolean;
  N: boolean;
  D: boolean;
  B: boolean;
  R: number;
  X: number;
  eps: number;
  Hstar: number;
  Lstar: number;
  gapPct: number;
  abnormalGap: boolean;
  /** null when the sigma-window changes are not supplied (the flag cannot be evaluated) */
  volWindowOutlier: boolean | null;
}

/**
 * OD1 for a prediction-day bar and an already validated window of h bars (t+1..t+h), with sigma SUPPLIED (frozen).
 * `sigmaChanges` is used only for the descriptive volWindowOutlier flag; it never affects the class.
 */
export function od1Measure(a: { up: boolean; day: Pick<Ohlc, "close" | "high" | "low">; window: Ohlc[]; benchT: number; benchTh: number; sigma: number; sigmaChanges?: number[] | null }): Od1Measured {
  const h = a.window.length;
  if (h < 1) throw new Error("od1Measure: the window must contain at least one bar");
  const sigma = a.sigma;
  const eps = od1Epsilon(sigma, h);
  const R = pct(a.window[h - 1].close, a.day.close);
  const X = R - pct(a.benchTh, a.benchT);
  const Hstar = Math.max(...a.window.map((b) => b.high));
  const Lstar = Math.min(...a.window.map((b) => b.low));
  const c = od1Classify({ up: a.up, R, X, Hstar, Lstar, Ht: a.day.high, Lt: a.day.low, eps });
  const gapPct = pct(a.window[0].open, a.day.close);
  return {
    ...c,
    R,
    X,
    eps,
    Hstar,
    Lstar,
    gapPct,
    abnormalGap: Math.abs(gapPct) >= OD1.abnormalGapSigma * sigma,
    volWindowOutlier: a.sigmaChanges ? Math.max(...a.sigmaChanges.map(Math.abs)) >= OD1.volWindowOutlierSigma * sigma : null,
  };
}

/** One bar of the outcome window as seen in the data: `null` = no bar on that trading session. */
export interface Od1WindowBar extends Ohlc {
  date: string;
  /** true when the bar is in the same comparable price segment as bar t (no corporate-action discontinuity) */
  sameSegmentAsT: boolean;
}

export interface Od1Input {
  /** the h trading sessions t+1..t+h from the maturity check; bars[k] belongs to sessions[k] or is null (no bar) */
  sessions: string[];
  bars: Array<Od1WindowBar | null>;
  /** sign of the day-t change: gainer rules when true, loser mirror when false */
  up: boolean;
  /** frozen prediction-day values from the immutable prediction record */
  day: Pick<Ohlc, "close" | "high" | "low">;
  /** frozen `price.volatility20` (null = unavailable at t) */
  sigma: number | null;
  sigmaChanges?: number[] | null;
  benchT: number;
  benchTh: number;
}

export type Od1Outcome = ({ status: "complete"; endDate: string } & Od1Measured) | { status: "unavailable"; reason: Od1Unavailable };

/**
 * The OD1 outcome of one prediction for an already MATURE window (maturity is decided by `od1Maturity`). Precedence is
 * the research implementation's: sigma first, then each session in order (no bar, then discontinuity).
 */
export function od1Outcome(i: Od1Input): Od1Outcome {
  const h = i.sessions.length;
  if (h < 1 || i.bars.length !== h) throw new Error("od1Outcome: sessions and bars must both have length h >= 1");
  if (i.sigma === null || !Number.isFinite(i.sigma)) return { status: "unavailable", reason: "insufficient-history" };
  const window: Ohlc[] = [];
  for (let k = 0; k < h; k++) {
    const b = i.bars[k];
    if (!b) return { status: "unavailable", reason: "no-bar" };
    if (b.date !== i.sessions[k]) throw new Error(`od1Outcome: bar ${b.date} is not session ${i.sessions[k]}`);
    if (!b.sameSegmentAsT) return { status: "unavailable", reason: "discontinuity" };
    window.push(b);
  }
  return { status: "complete", endDate: i.sessions[h - 1], ...od1Measure({ up: i.up, day: i.day, window, benchT: i.benchT, benchTh: i.benchTh, sigma: i.sigma, sigmaChanges: i.sigmaChanges }) };
}

export type CalendarStatus = "trading" | "non-trading" | "pending-publication" | "unresolved";
export type ArchiveStatus = { index: string | null; stocks: string | null };

export type Od1Maturity = { status: "mature"; sessions: string[]; endDate: string } | { status: "pending"; reason: string };

const addDay = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const isWeekday = (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

/**
 * Is horizon h of session t mature? Uses the actual NSE (NIFTY 500) trading calendar: t+h is the h-th trading session
 * after t, and EVERY weekday in (t, t+h] must be resolved (`trading` or `non-trading`) so an unpublished session can never
 * be skipped, and the index and stock archives of each of the h sessions must be `ok`. Anything else is pending.
 */
export function od1Maturity(a: { sessionDate: string; h: number; tradingCalendar: string[]; calendarStatus: Record<string, CalendarStatus | string | undefined>; archives: Record<string, ArchiveStatus | undefined> }): Od1Maturity {
  if (!Number.isInteger(a.h) || !OD1_STORED_HORIZONS.includes(a.h)) return { status: "pending", reason: `horizon ${a.h} is not a stored OD1 horizon` };
  const cal = [...a.tradingCalendar].sort();
  const ti = cal.indexOf(a.sessionDate);
  if (ti < 0) return { status: "pending", reason: `${a.sessionDate} is not a session of the trading calendar` };
  if (ti + a.h >= cal.length) return { status: "pending", reason: `fewer than ${a.h} trading sessions after ${a.sessionDate} are known` };
  const sessions = cal.slice(ti + 1, ti + 1 + a.h);
  const endDate = sessions[sessions.length - 1];
  for (let d = addDay(a.sessionDate, 1); d <= endDate; d = addDay(d, 1)) {
    if (!isWeekday(d)) continue;
    const s = a.calendarStatus[d];
    const isSession = sessions.includes(d);
    if (isSession && s !== "trading") return { status: "pending", reason: `${d} is a calendar session but its exchange-calendar status is ${String(s ?? "unknown")}` };
    if (!isSession && s !== "non-trading") return { status: "pending", reason: `weekday ${d} is not resolved as a non-trading day (status ${String(s ?? "unknown")})` };
  }
  for (const d of sessions) {
    const ar = a.archives[d];
    if (!ar || ar.index !== "ok" || ar.stocks !== "ok") return { status: "pending", reason: `the archives of ${d} are not ok (index ${String(ar?.index ?? "missing")}, stocks ${String(ar?.stocks ?? "missing")})` };
  }
  return { status: "mature", sessions, endDate };
}
