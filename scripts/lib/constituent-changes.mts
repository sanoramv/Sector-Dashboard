/**
 * Point-in-time membership, going forward. niftyindices.com's constituent
 * CSVs carry no effective date and no history, so the only honest record
 * possible is: "at this fetch, these symbols were added to / removed from
 * this list compared with the previous fetch". Each change is logged with
 * the detection time (the real effective date may be earlier, up to the
 * previous fetch). History before the first logged fetch is unknown.
 */
import type { SectorConstituents } from "../../src/types/market.ts";

export interface ConstituentChange {
  list: string;
  /** When the change was detected (this fetch). */
  detectedAt: string;
  /** Previous fetch time: the change happened somewhere between the two. */
  previousFetchedAt: string | null;
  added: string[];
  removed: string[];
}

export interface ConstituentChangeLog {
  schemaVersion: 1;
  note: string;
  /** First fetch whose lists are recorded; membership before this is unknown. */
  trackingSince: string;
  changes: ConstituentChange[];
}

export const LOG_NOTE =
  "Detected differences between successive fetches of niftyindices.com constituent lists. The source publishes no effective dates: a change took effect between previousFetchedAt and detectedAt. Membership before trackingSince is not known.";

export function diffConstituents(
  previous: Record<string, SectorConstituents>,
  next: Record<string, SectorConstituents>,
  detectedAt: string,
): ConstituentChange[] {
  const changes: ConstituentChange[] = [];
  for (const [list, cur] of Object.entries(next)) {
    const prev = previous[list];
    if (!prev) continue; // a newly tracked list is not a membership change
    const before = new Set(prev.constituents.map((c) => c.symbol));
    const after = new Set(cur.constituents.map((c) => c.symbol));
    const added = [...after].filter((s) => !before.has(s)).sort();
    const removed = [...before].filter((s) => !after.has(s)).sort();
    if (added.length > 0 || removed.length > 0) changes.push({ list, detectedAt, previousFetchedAt: prev.fetchedAt ?? null, added, removed });
  }
  return changes;
}

/** Appends changes; idempotent for a re-run that finds no new differences. */
export function appendChanges(log: ConstituentChangeLog | null, changes: ConstituentChange[], trackingSince: string): ConstituentChangeLog {
  const base: ConstituentChangeLog = log ?? { schemaVersion: 1, note: LOG_NOTE, trackingSince, changes: [] };
  return { ...base, changes: [...base.changes, ...changes] };
}
