import type { Regime } from "../types/metrics";

const CONFIG: Record<Regime, { cls: string; label: string; arrow: string }> = {
  bullish: { cls: "badge-bullish", label: "Bullish", arrow: "▲" },
  bearish: { cls: "badge-bearish", label: "Bearish", arrow: "▼" },
  sideways: { cls: "badge-sideways", label: "Sideways", arrow: "▬" },
  "insufficient-data": { cls: "badge-insufficient", label: "Insufficient data", arrow: "?" },
};

export function RegimeBadge({ regime }: { regime: Regime }) {
  const c = CONFIG[regime];
  return (
    <span className={`badge ${c.cls}`}>
      <span aria-hidden="true">{c.arrow}</span> {c.label}
    </span>
  );
}
