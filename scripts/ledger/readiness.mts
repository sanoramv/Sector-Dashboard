/**
 * Readiness checks R1-R11 exactly as defined in docs/design/MOMENTUM_LEDGER_DESIGN.md §10 (Revision 4).
 * Pure functions over a prepared context so every boundary can be tested. Nothing is invented here: every
 * threshold comes from constants.mts.
 *
 * dispositions
 *   ok       passed
 *   waiting  inputs not available yet (retried by later scheduled runs; not an alert on its own)
 *   blocked  a data-quality check failed: nothing is written for the date
 *   flag     review flag only: the capture proceeds and the reason is recorded
 */
import type { ArchiveEntry } from "../lib/refresh-state.mts";
import { EXPECTED_INDEX_SLUGS, READINESS, SETTINGS_READ_BY_MOMENTUM } from "./constants.mts";

export type Disposition = "ok" | "waiting" | "blocked" | "flag";

export interface CheckResult {
  id: string;
  name: string;
  status: "pass" | "fail" | "warn" | "skipped";
  disposition: Disposition;
  observed: unknown;
  threshold: unknown;
  mode?: string;
  reason: string;
  affected?: string[];
}

const pass = (id: string, name: string, observed: unknown, threshold: unknown, reason: string, extra: Partial<CheckResult> = {}): CheckResult => ({ id, name, status: "pass", disposition: "ok", observed, threshold, reason, ...extra });
const fail = (id: string, name: string, disposition: Disposition, observed: unknown, threshold: unknown, reason: string, extra: Partial<CheckResult> = {}): CheckResult => ({ id, name, status: "fail", disposition, observed, threshold, reason, ...extra });

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** R1 - the pipeline's own record that the day's index and stock archives were retrieved and validated. */
export function checkR1(date: string, index: ArchiveEntry | undefined, stocks: ArchiveEntry | undefined): CheckResult {
  const observed = { index: index?.status ?? "absent", stocks: stocks?.status ?? "absent" };
  if (index?.status === "ok" && stocks?.status === "ok") return pass("R1", "refresh-state archives ok", observed, { index: "ok", stocks: "ok" }, `Both archives for ${date} are ok.`);
  return fail("R1", "refresh-state archives ok", "waiting", observed, { index: "ok", stocks: "ok" }, `Archives for ${date} are not both ok yet.`);
}

/** R2 - NIFTY 500 and all 20 tracked index series have a bar for the date (`hasBar[slug]` is computed by the caller). */
export function checkR2(date: string, hasBar: Record<string, boolean>): CheckResult {
  const missing = EXPECTED_INDEX_SLUGS.filter((s) => !hasBar[s]);
  const observed = { expected: EXPECTED_INDEX_SLUGS.length, withBar: EXPECTED_INDEX_SLUGS.length - missing.length };
  if (missing.length === 0) return pass("R2", "all tracked index series have a bar", observed, { expected: EXPECTED_INDEX_SLUGS.length }, "All tracked index series have a bar.");
  return fail("R2", "all tracked index series have a bar", "waiting", observed, { expected: EXPECTED_INDEX_SLUGS.length }, `${missing.length} tracked index series lack a bar for ${date}.`, { affected: missing });
}

/** R3 - at least 99% of universe stocks that have a bar have a volume row. */
export function checkR3(withBar: number, withVolume: number, missing: string[]): CheckResult {
  const coverage = withBar === 0 ? 0 : withVolume / withBar;
  const observed = { withBar, withVolume, coverage };
  const threshold = { minCoverage: READINESS.R3.minVolumeCoverage };
  if (withBar > 0 && coverage >= READINESS.R3.minVolumeCoverage) {
    return pass("R3", "volume coverage", observed, threshold, `Volume rows exist for ${withVolume} of ${withBar} stocks.`, missing.length ? { affected: missing } : {});
  }
  return fail("R3", "volume coverage", "blocked", observed, threshold, withBar === 0 ? "No universe stock has a bar for the date." : `Volume coverage ${(coverage * 100).toFixed(2)}% is below ${(READINESS.R3.minVolumeCoverage * 100).toFixed(0)}%.`, { affected: missing });
}

/** R4 - eligible-stock count at least 90% of the median over the preceding sessions. */
export function checkR4(eligibleToday: number, eligiblePreceding: number[]): CheckResult {
  const base = eligiblePreceding.slice(-READINESS.R4.baselineSessions);
  const med = median(base);
  const threshold = { fraction: READINESS.R4.fraction, baselineSessions: base.length };
  if (med === null) return fail("R4", "eligible-stock count", "blocked", { eligibleToday, median: null }, threshold, "No preceding session exists to establish the eligible-count baseline.");
  const floor = READINESS.R4.fraction * med;
  const observed = { eligibleToday, median: med, floor };
  if (eligibleToday >= floor) return pass("R4", "eligible-stock count", observed, threshold, `${eligibleToday} eligible stocks against a floor of ${floor.toFixed(1)}.`);
  return fail("R4", "eligible-stock count", "blocked", observed, threshold, `${eligibleToday} eligible stocks is below ${(READINESS.R4.fraction * 100).toFixed(0)}% of the median ${med}.`);
}

export interface PreviousSnapshot {
  source: string;
  symbolCount: number;
  constituentsFetchedAt: string;
  readable: boolean;
}

export interface ListInfo {
  count: number;
  present: boolean;
}

/**
 * R5 - universe lists are sane.
 * R5a (every snapshot): the four lists are present and within +-5% of their nominal index sizes.
 * R5b (from the second live snapshot): symbol count within +-5% of the previous LIVE snapshot, skipped when the lists were refreshed.
 * Replay data is never a baseline: only a `live-capture` snapshot qualifies.
 */
export function checkR5(lists: Record<string, ListInfo>, symbolCount: number, constituentsFetchedAt: string | null, previous: PreviousSnapshot | null): CheckResult {
  const tol = READINESS.R5.tolerancePct / 100;
  const problems: string[] = [];
  const ranges: Record<string, { min: number; max: number; count: number | null }> = {};
  for (const [slug, nominal] of Object.entries(READINESS.R5.nominal)) {
    const info = lists[slug];
    const min = Math.ceil(nominal * (1 - tol) - 1e-9);
    const max = Math.floor(nominal * (1 + tol) + 1e-9);
    ranges[slug] = { min, max, count: info?.present ? info.count : null };
    if (!info || !info.present || info.count === 0) problems.push(`${slug} is missing or empty`);
    else if (info.count < min || info.count > max) problems.push(`${slug} has ${info.count} symbols, outside ${min}-${max}`);
  }
  const threshold = { tolerancePct: READINESS.R5.tolerancePct, nominal: READINESS.R5.nominal };
  if (problems.length > 0) return fail("R5", "universe lists", "blocked", { ranges, symbolCount }, threshold, `R5a failed: ${problems.join("; ")}.`, { mode: previous ? "previous-live" : "bootstrap-nominal" });
  if (!previous) return pass("R5", "universe lists", { ranges, symbolCount }, threshold, "First live snapshot: lists checked against nominal index sizes only.", { mode: "bootstrap-nominal" });
  if (!previous.readable) return pass("R5", "universe lists", { ranges, symbolCount }, threshold, "Previous live snapshot was unreadable: only the nominal check applies.", { mode: "nominal-only", status: "warn" });
  if (constituentsFetchedAt !== null && previous.constituentsFetchedAt !== constituentsFetchedAt) {
    return pass("R5", "universe lists", { ranges, symbolCount, previousFetchedAt: previous.constituentsFetchedAt, fetchedAt: constituentsFetchedAt }, threshold, "Constituent lists were refreshed since the previous snapshot: previous-snapshot comparison skipped.", { mode: "list-refreshed" });
  }
  const lo = previous.symbolCount * (1 - tol);
  const hi = previous.symbolCount * (1 + tol);
  const observed = { symbolCount, previousSymbolCount: previous.symbolCount, allowed: [lo, hi] };
  if (symbolCount >= lo && symbolCount <= hi) return pass("R5", "universe lists", observed, threshold, `Symbol count ${symbolCount} is within 5% of the previous live snapshot (${previous.symbolCount}).`, { mode: "previous-live" });
  return fail("R5", "universe lists", "blocked", observed, threshold, `Symbol count ${symbolCount} differs from the previous live snapshot (${previous.symbolCount}) by more than 5%.`, { mode: "previous-live" });
}

/** R7 - the manifest is current and its refresh did not fail. */
export function checkR7(date: string, manifest: { latestMarketDate: string; refresh?: { outcome: string; tradingDaysBehind: number; reasons?: string[] } }, dateIsOk: boolean): CheckResult {
  const r = manifest.refresh;
  const observed = { latestMarketDate: manifest.latestMarketDate, outcome: r?.outcome ?? "absent", tradingDaysBehind: r?.tradingDaysBehind ?? null, dateIsOk };
  const threshold = { latestMarketDate: `>= ${date}`, outcome: "not failed; if partial, date ok and tradingDaysBehind = 0" };
  if (manifest.latestMarketDate < date) return fail("R7", "manifest current", "waiting", observed, threshold, `Manifest latestMarketDate ${manifest.latestMarketDate} is before ${date}.`);
  if (!r) return fail("R7", "manifest current", "blocked", observed, threshold, "The manifest has no refresh status.");
  if (r.outcome === "failed") return fail("R7", "manifest current", "blocked", observed, threshold, "The last pipeline refresh failed.");
  if (r.outcome === "partial" && !(dateIsOk && r.tradingDaysBehind === 0)) return fail("R7", "manifest current", "blocked", observed, threshold, "Partial refresh and the session date is not fully resolved.");
  return pass("R7", "manifest current", observed, threshold, r.outcome === "partial" ? `Refresh partial but ${date} is ok; reasons recorded.` : "Manifest is current.", r.outcome === "partial" ? { status: "warn" } : {});
}

/** R8 - the computed rule version is the enabled version, and the path reads only recorded settings. */
export function checkR8(ruleVersion: string, enabled: string | null, settingsReads: readonly string[]): CheckResult {
  const unrecorded = settingsReads.filter((p) => !(SETTINGS_READ_BY_MOMENTUM as readonly string[]).includes(p));
  const observed = { ruleVersion, enabled, settingsReads: [...settingsReads].sort() };
  const threshold = { ruleVersion: "equals the enabled version", settingsReads: "subset of the 11 recorded leaves" };
  if (!enabled) return fail("R8", "rule version enabled", "blocked", observed, threshold, "No enabled rule version is recorded under protocol/versions.");
  if (ruleVersion !== enabled) return fail("R8", "rule version enabled", "blocked", observed, threshold, `Computed rule version ${ruleVersion} differs from the enabled version ${enabled}; a rule change must be enabled deliberately.`);
  if (unrecorded.length > 0) return fail("R8", "rule version enabled", "blocked", observed, threshold, `The path read settings that are not recorded: ${unrecorded.join(", ")}.`, { affected: unrecorded });
  return pass("R8", "rule version enabled", observed, threshold, `Rule version ${ruleVersion} is enabled.`);
}

/** R9 - stocks present on the previous session but absent today: more than the trailing median + 1 blocks. Every list is recorded. */
export function checkR9(noBarToday: string[], precedingCounts: number[]): CheckResult {
  const base = precedingCounts.slice(-READINESS.R9.baselineSessions);
  const med = median(base);
  const threshold = { margin: READINESS.R9.margin, baselineSessions: base.length };
  if (med === null) return fail("R9", "missing-today stocks", "blocked", { count: noBarToday.length, median: null }, threshold, "No preceding session exists to establish the missing-stock baseline.", { affected: noBarToday });
  const limit = med + READINESS.R9.margin;
  const observed = { count: noBarToday.length, median: med, limit };
  if (noBarToday.length > limit) return fail("R9", "missing-today stocks", "blocked", observed, threshold, `${noBarToday.length} stocks vanished against a limit of ${limit}.`, { affected: noBarToday });
  return pass("R9", "missing-today stocks", observed, threshold, noBarToday.length > 0 ? `${noBarToday.length} stock(s) absent today, within the limit; recorded.` : "No stock vanished.", noBarToday.length > 0 ? { status: "warn", affected: noBarToday } : {});
}

export interface BreakEvidence {
  symbol: string;
  reason: string;
  closeRatio: number | null;
}

/** R11 - price-break burst review flag. Never blocks. `first-bar-in-history` is a new listing and is not counted. */
export function checkR11(excluded: BreakEvidence[]): CheckResult {
  const counted = excluded.filter((e) => e.reason !== "first-bar-in-history");
  const groups = new Map<string, string[]>();
  for (const e of counted) {
    if (e.closeRatio === null) continue;
    const key = e.closeRatio.toFixed(READINESS.R11.ratioDecimals);
    groups.set(key, [...(groups.get(key) ?? []), e.symbol]);
  }
  const shared = [...groups.entries()].filter(([, s]) => s.length >= READINESS.R11.sameRatioCount);
  const observed = { breakStarts: counted.length, sameRatioGroups: shared.map(([ratio, symbols]) => ({ ratio, symbols })) };
  const threshold = { warnCount: READINESS.R11.warnCount, sameRatioCount: READINESS.R11.sameRatioCount, ratioDecimals: READINESS.R11.ratioDecimals };
  if (counted.length >= READINESS.R11.warnCount || shared.length > 0) {
    const why = counted.length >= READINESS.R11.warnCount ? `${counted.length} stocks start a price break today (flag at ${READINESS.R11.warnCount})` : `${shared[0][1].length} stocks share a close ratio of ${shared[0][0]}`;
    return { id: "R11", name: "price-break burst", status: "warn", disposition: "flag", observed, threshold, reason: `Review flag: ${why}. Every excluded stock is recorded with its evidence; the capture is not blocked.`, affected: counted.map((e) => e.symbol) };
  }
  return pass("R11", "price-break burst", observed, threshold, counted.length ? `${counted.length} price break(s), below the review flag; recorded.` : "No price break starts today.", counted.length ? { affected: counted.map((e) => e.symbol) } : {});
}

/** R10 - source revision of previously captured sessions. Never blocks a new capture. */
export interface R10Session {
  date: string;
  ok: boolean;
  changedSymbols: string[];
  changedIndices: string[];
  removedFromSource: string[];
}

export function summariseR10(sessions: R10Session[]): CheckResult {
  const revised = sessions.filter((s) => !s.ok);
  const observed = { checked: sessions.length, revised: revised.map((s) => ({ date: s.date, changedSymbols: s.changedSymbols, changedIndices: s.changedIndices })) };
  const threshold = { checkedSessions: READINESS.R10.checkedSessions, windowCalendarDays: READINESS.R10.windowCalendarDays };
  if (revised.length === 0) return pass("R10", "source revision", observed, threshold, sessions.length === 0 ? "No previously captured session to compare (vacuous pass)." : `${sessions.length} captured session(s) match their stored digests.`);
  return { id: "R10", name: "source revision", status: "warn", disposition: "flag", observed, threshold, reason: `Source data for ${revised.map((s) => s.date).join(", ")} changed after capture; those sessions are marked source-revised. New captures are not blocked.`, affected: revised.map((s) => s.date) };
}

export const anyBlocking = (checks: CheckResult[]): CheckResult[] => checks.filter((c) => c.disposition === "blocked");
export const anyWaiting = (checks: CheckResult[]): CheckResult[] => checks.filter((c) => c.disposition === "waiting");
