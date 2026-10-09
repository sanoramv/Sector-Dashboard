import type { DataStatus } from "../lib/providers/types";

const LABELS: Record<DataStatus | "unavailable", string> = {
  live: "Live",
  cached: "Cached",
  stale: "Stale",
  partial: "Partial",
  unavailable: "Unavailable",
};

const DESCRIPTIONS: Record<DataStatus | "unavailable", string> = {
  live: "Data was just fetched successfully from the configured provider and is current as of the latest published trading session.",
  cached: "Showing the last successfully fetched snapshot from this browser's local storage; it was not re-fetched from the network just now.",
  stale: "Data was fetched successfully, but the latest available market date is older than expected. The scheduled data pipeline may be behind.",
  partial: "Data was fetched but some sectors or metrics are missing or incomplete. See warnings for details.",
  unavailable: "No valid data is available - the most recent fetch failed and there is no cached snapshot to fall back on.",
};

export function StatusBadge({ status }: { status: DataStatus | "unavailable" }) {
  const cls =
    status === "live"
      ? "badge-bullish"
      : status === "unavailable"
        ? "badge-bearish"
        : status === "stale"
          ? "badge-insufficient"
          : "badge-sideways";
  return (
    <span className={`badge ${cls}`} title={DESCRIPTIONS[status]}>
      {LABELS[status]}
    </span>
  );
}
