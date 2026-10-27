import type { PreparedUniverse, UniverseStock } from "./universe";

/**
 * What happened in the session AFTER the evaluation date t. Each outcome is
 * kept separate - a stock can close higher (positive close-to-close) after
 * trading well below the previous low during the day.
 *
 *   closeToClosePct      C(t+1) / C(t) - 1                    (signal known at t's close; not directly tradable at C(t))
 *   excessVsNifty500Pp   closeToClosePct - NIFTY 500's C(t+1)/C(t) - 1
 *   higherHigh           H(t+1) > H(t)
 *   lowerLow             L(t+1) < L(t)
 *   gapPct               O(t+1) / C(t) - 1                     (move before anyone could act at the open)
 *   openToCloseNetPct    C(t+1) / O(t+1) - 1 - cost            (tradable: enter at the next open, exit at that close)
 *   mfeFromOpenPct       H(t+1) / O(t+1) - 1                   (best price after a next-open entry, from the daily high)
 *   maeFromOpenPct       L(t+1) / O(t+1) - 1                   (worst price after a next-open entry, from the daily low)
 *
 * Daily bars do not say whether the high or the low came first, so MFE/MAE
 * are bounds on what was possible during the day, not a simulated path.
 */
export interface NextSessionOutcome {
  nextDate: string;
  closeToClosePct: number;
  excessVsNifty500Pp: number;
  higherHigh: boolean;
  lowerLow: boolean;
  gapPct: number;
  openToCloseNetPct: number;
  mfeFromOpenPct: number;
  maeFromOpenPct: number;
}

export type OutcomeResult =
  | { kind: "ok"; outcome: NextSessionOutcome }
  /** t is the latest session in the data - the next session has not happened (or been published) yet. */
  | { kind: "pending" }
  /** The stock has no bar on the next calendar session (suspended, delisted, or a data gap). */
  | { kind: "no-next-bar"; nextDate: string }
  /**
   * The next bar starts a new comparable segment: a suspected corporate action
   * or a 15%+ gap-down at both open and close (which may be a genuine crash).
   * Excluded because the unadjusted change may be meaningless; this biases
   * results AGAINST capturing the worst genuine next-day falls - reported.
   */
  | { kind: "discontinuity"; nextDate: string; breakKind: string };

export function nextSessionOutcome(u: PreparedUniverse, stock: UniverseStock, i: number, costBps: number): OutcomeResult {
  const date = stock.bars[i].date;
  const calIdx = u.calendarIndex.get(date);
  if (calIdx === undefined) return { kind: "pending" };
  const nextDate = u.calendar[calIdx + 1];
  if (nextDate === undefined) return { kind: "pending" };
  const j = stock.indexByDate.get(nextDate);
  if (j === undefined) return { kind: "no-next-bar", nextDate };
  if (stock.segOf[j] !== stock.segOf[i]) return { kind: "discontinuity", nextDate, breakKind: stock.breakAt[j]?.kind ?? "unknown" };

  const t = stock.bars[i];
  const n = stock.bars[j];
  const b0 = u.benchmark[calIdx];
  const b1 = u.benchmark[calIdx + 1];
  const closeToClosePct = (n.close / t.close - 1) * 100;
  return {
    kind: "ok",
    outcome: {
      nextDate,
      closeToClosePct,
      excessVsNifty500Pp: closeToClosePct - (b1.close / b0.close - 1) * 100,
      higherHigh: n.high > t.high,
      lowerLow: n.low < t.low,
      gapPct: (n.open / t.close - 1) * 100,
      openToCloseNetPct: (n.close / n.open - 1) * 100 - costBps / 100,
      mfeFromOpenPct: (n.high / n.open - 1) * 100,
      maeFromOpenPct: (n.low / n.open - 1) * 100,
    },
  };
}
