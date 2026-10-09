import type { Maybe } from "../types/metrics";

export function formatMaybePct(m: Maybe<number>, digits = 2): string {
  return m.available ? `${m.value >= 0 ? "+" : ""}${m.value.toFixed(digits)}%` : "N/A";
}

export function formatMaybeNumber(m: Maybe<number>, digits = 2): string {
  return m.available ? m.value.toFixed(digits) : "N/A";
}

export function formatMaybePp(m: Maybe<number>, digits = 2): string {
  return m.available ? `${m.value >= 0 ? "+" : ""}${m.value.toFixed(digits)}pp` : "N/A";
}

export function signClass(m: Maybe<number>): string {
  if (!m.available) return "text-faint";
  if (m.value > 0) return "text-pos";
  if (m.value < 0) return "text-neg";
  return "text-muted";
}

export function formatDateHuman(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00Z" : ""));
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
}

export function formatDateTimeHuman(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatRelativeToNow(iso: string | null | undefined): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
}
