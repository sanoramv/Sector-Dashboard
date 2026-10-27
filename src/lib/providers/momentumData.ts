import type { StockActivityFile } from "../../types/activity";
import type { AnnouncementsFile } from "../../types/announcements";
import type { ActivityRow } from "../../types/activity";
import { decodeAllActivity } from "../activity";

const DATA_BASE = `${import.meta.env.BASE_URL}data`;

export type Supplement<T> = { status: "ok"; value: T } | { status: "unavailable"; reason: string };

export interface MomentumSupplements {
  activity: Supplement<Record<string, ActivityRow[]>>;
  announcements: Supplement<AnnouncementsFile>;
}

async function fetchJson<T>(file: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}?t=${Date.now()}`, { signal, cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Loads the two files only the Next-Day Momentum page needs. Each one fails
 * independently: missing volume data makes volume features unavailable,
 * missing filings make catalysts unavailable - neither blocks the page and
 * neither is replaced by a default.
 */
export async function loadMomentumSupplements(signal?: AbortSignal): Promise<MomentumSupplements> {
  const [activity, announcements] = await Promise.all([
    fetchJson<StockActivityFile>("stock-activity.json", signal)
      .then((f): Supplement<Record<string, ActivityRow[]>> => {
        if (f.schemaVersion !== 1) return { status: "unavailable", reason: `unsupported stock-activity.json schema ${String(f.schemaVersion)}` };
        return { status: "ok", value: decodeAllActivity(f) };
      })
      .catch((err: unknown): Supplement<Record<string, ActivityRow[]>> => ({ status: "unavailable", reason: `stock-activity.json: ${String(err)}` })),
    fetchJson<AnnouncementsFile>("announcements.json", signal)
      .then((f): Supplement<AnnouncementsFile> =>
        f.schemaVersion === 1 && Array.isArray(f.items) ? { status: "ok", value: f } : { status: "unavailable", reason: "unsupported announcements.json format" },
      )
      .catch((err: unknown): Supplement<AnnouncementsFile> => ({ status: "unavailable", reason: `announcements.json: ${String(err)}` })),
  ]);
  return { activity, announcements };
}
