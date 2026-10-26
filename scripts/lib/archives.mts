/**
 * Validation and parsing for NSE's two daily archives. Pure functions - no
 * network - so every acceptance rule is unit-tested with real file shapes.
 *
 * Observed NSE behaviour (verified 2026-10-26) that these rules rely on:
 * - A future/unpublished date returns HTTP 404 with an HTML page for both archives.
 * - On a non-trading weekday the INDEX archive returns 404, but the EQUITY
 *   bhavcopy URL returns HTTP 200 with the PREVIOUS session's file (e.g.
 *   requesting 2026-10-02 serves DATE1 = 01-Oct-2026). So a 200 is not proof
 *   that the requested date traded; the dates inside the file are checked.
 */
import { parseCsvObjects } from "./csv.mts";
import { nseDateToIso, nseMonthNameDateToIso } from "./dates.mts";

export type ArchiveKind = "index" | "stocks";

export const INDEX_REQUIRED_COLUMNS = ["Index Name", "Index Date", "Open Index Value", "High Index Value", "Low Index Value", "Closing Index Value"];
export const STOCK_REQUIRED_COLUMNS = ["SYMBOL", "SERIES", "DATE1", "OPEN_PRICE", "HIGH_PRICE", "LOW_PRICE", "CLOSE_PRICE"];
/** A real ind_close_all file has ~150 index rows; a real bhavcopy ~3000 security rows. */
export const MIN_INDEX_ROWS = 50;
export const MIN_STOCK_ROWS = 1000;

export type ParsedArchive =
  | { kind: "match"; rows: Record<string, string>[] }
  /** The file is well-formed but all its rows carry an earlier session date. */
  | { kind: "earlier-session"; fileDate: string };

/** Structural check used as fetchArchive's `validate`: null if this is a genuine, complete archive file. */
export function validateArchiveText(kind: ArchiveKind, text: string): string | null {
  const head = text.slice(0, 200).trimStart().toLowerCase();
  if (text.trim().length === 0) return "empty body";
  if (head.startsWith("<") || head.includes("<html") || head.includes("<!doctype")) return "HTML page instead of CSV";
  const rows = parseCsvObjects(text);
  const columns = kind === "index" ? INDEX_REQUIRED_COLUMNS : STOCK_REQUIRED_COLUMNS;
  const header = rows.length > 0 ? Object.keys(rows[0]) : [];
  const missing = columns.filter((c) => !header.includes(c));
  if (missing.length > 0) return `missing expected column(s): ${missing.join(", ")}`;
  const min = kind === "index" ? MIN_INDEX_ROWS : MIN_STOCK_ROWS;
  if (rows.length < min) return `only ${rows.length} data rows (expected at least ${min}) - truncated or incomplete file`;
  const dateCol = kind === "index" ? "Index Date" : "DATE1";
  const dates = new Set(rows.map((r) => r[dateCol]).filter(Boolean));
  if (dates.size !== 1) return `file mixes ${dates.size} session dates`;
  try {
    const iso = toIso(kind, [...dates][0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(iso))) return `unparseable session date "${[...dates][0]}"`;
  } catch {
    return `unparseable session date "${[...dates][0]}"`;
  }
  return null;
}

function toIso(kind: ArchiveKind, value: string): string {
  return kind === "index" ? nseDateToIso(value) : nseMonthNameDateToIso(value);
}

/**
 * Interprets an already-validated archive for `requestedIso`. A file for a
 * LATER date than requested is impossible for a correct archive and is
 * reported as invalid by the caller.
 */
export function interpretArchive(kind: ArchiveKind, text: string, requestedIso: string): ParsedArchive | { kind: "later-session"; fileDate: string } {
  const rows = parseCsvObjects(text);
  const fileDate = toIso(kind, rows[0][kind === "index" ? "Index Date" : "DATE1"]);
  if (fileDate === requestedIso) return { kind: "match", rows };
  if (fileDate < requestedIso) return { kind: "earlier-session", fileDate };
  return { kind: "later-session", fileDate };
}
