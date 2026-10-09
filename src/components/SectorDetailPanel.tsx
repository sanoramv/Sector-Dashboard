import { useEffect, useRef } from "react";
import type { SectorMetrics } from "../types/metrics";
import type { RegimeHistoryEntry } from "../lib/dashboard";
import { formatDateHuman, formatMaybeNumber, formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { RegimeBadge } from "./RegimeBadge";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";
import { LineChart } from "./LineChart";

export interface SectorDetailPanelProps {
  sector: SectorMetrics;
  regimeHistory: RegimeHistoryEntry[];
  onClose: () => void;
}

export function SectorDetailPanel({ sector, regimeHistory, onClose }: SectorDetailPanelProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const priceData = sector.priceSeries.map((b) => ({ time: b.date, value: b.close }));
  const rsData = sector.relativeStrength.ratioSeries.available
    ? sector.relativeStrength.ratioSeries.value.map((r) => ({ time: r.date, value: r.ratio }))
    : [];

  const regimeChanged =
    regimeHistory.length >= 2 && regimeHistory[regimeHistory.length - 1].regime !== regimeHistory[regimeHistory.length - 2].regime;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={`${sector.displayName} details`}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 18, borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{sector.displayName}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <RegimeBadge regime={sector.regime.regime} />
              <span className="text-faint" style={{ fontSize: 12 }}>
                Confidence: {sector.regime.confidence}
              </span>
              <span className="text-faint" style={{ fontSize: 12 }}>
                as of {formatDateHuman(sector.latestDate.available ? sector.latestDate.value : null)}
              </span>
            </div>
          </div>
          <button type="button" ref={closeBtnRef} className="btn" onClick={onClose} aria-label="Close sector detail">
            Close
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 20 }}>
          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Price history</h3>
            <LineChart data={priceData} ariaLabel={`${sector.displayName} price history chart`} />
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px", display: "flex", alignItems: "center", gap: 6 }}>
              Relative strength vs NIFTY 500 (RS ratio)
              <MetricHelp content={METRIC_GLOSSARY.rsRatio} />
            </h3>
            <LineChart data={rsData} kind="line" ariaLabel={`${sector.displayName} relative strength ratio chart`} />
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Returns across all timeframes</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
              {([
                ["1D", sector.returns.d1],
                ["1W", sector.returns.w1],
                ["1M", sector.returns.m1],
                ["3M", sector.returns.m3],
                ["6M", sector.returns.m6],
              ] as const).map(([label, val]) => (
                <div key={label}>
                  <div className="text-faint">{label}</div>
                  <div className={`num ${signClass(val)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                    {formatMaybePct(val)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Moving-average breadth</h3>
            <p className="text-faint" style={{ fontSize: 11.5, marginTop: -4 }}>
              Share of this sector's constituent stocks trading above their own moving average - not the index's own
              moving average.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
              {([
                ["20-DMA", sector.breadth.above20dma],
                ["50-DMA", sector.breadth.above50dma],
                ["200-DMA", sector.breadth.above200dma],
              ] as const).map(([label, w]) => (
                <div key={label}>
                  <div className="text-faint">{label}</div>
                  <div className="num" style={{ fontSize: 16, fontWeight: 700 }}>
                    {formatMaybePct(w.pct, 0)}
                  </div>
                  <div className="text-faint" style={{ fontSize: 11 }}>
                    {w.eligible}/{w.total} eligible
                  </div>
                </div>
              ))}
            </div>
            <div>
              <div className="text-faint" style={{ marginTop: 10 }}>
                Distance from 52-week high
              </div>
              <div className={`num ${signClass(sector.distanceFrom52wHigh)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                {formatMaybePct(sector.distanceFrom52wHigh)}
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Strength score breakdown</h3>
            <div className="text-faint" style={{ fontSize: 12, marginBottom: 8 }}>
              {sector.score.pointsEarned} of {sector.score.pointsPossible} available points (
              {sector.score.completenessPct.toFixed(0)}% of all 9 scoring points could be evaluated).
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {sector.score.conditions.map((c) => (
                <li key={c.id} style={{ marginBottom: 4 }}>
                  <span
                    className={c.passed === null ? "text-faint" : c.passed ? "text-pos" : "text-neg"}
                    aria-hidden="true"
                  >
                    {c.passed === null ? "—" : c.passed ? "✓" : "✗"}
                  </span>{" "}
                  {c.label} <span className="text-faint">({c.points} pt{c.points > 1 ? "s" : ""})</span>
                  {c.passed === null && <span className="text-faint"> — not available</span>}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Why this classification?</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {sector.regime.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {r}
                </li>
              ))}
            </ul>
            {sector.regime.shortVsLongConflict && (
              <p className="badge badge-insufficient" style={{ marginTop: 8 }}>
                Short-term and long-term trends disagree for this sector.
              </p>
            )}
            <div className="text-faint" style={{ fontSize: 12, marginTop: 8 }}>
              Confidence reasons: {sector.regime.confidenceReasons.join(" ")}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Recent classification history</h3>
            {regimeHistory.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13 }}>Not enough history to show recent changes.</p>
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {regimeHistory.map((h) => (
                    <div key={h.date} style={{ textAlign: "center" }}>
                      <div className="text-faint" style={{ fontSize: 11 }}>
                        {formatDateHuman(h.date)}
                      </div>
                      <RegimeBadge regime={h.regime} />
                    </div>
                  ))}
                </div>
                {regimeChanged && (
                  <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                    This sector's classification changed on the most recent trading session versus the one before it.
                  </p>
                )}
              </>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Data source &amp; quality</h3>
            <div className={`badge ${sector.dataQuality.status === "complete" ? "badge-bullish" : sector.dataQuality.status === "partial" ? "badge-insufficient" : "badge-bearish"}`}>
              {sector.dataQuality.status}
            </div>
            {sector.dataQuality.missing.length > 0 && (
              <ul style={{ fontSize: 12.5, margin: "8px 0 0", paddingLeft: 18 }} className="text-muted">
                {sector.dataQuality.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-faint" style={{ fontSize: 11 }}>
            Current close: <span className="num">{formatMaybeNumber(sector.currentClose)}</span> · 3M relative
            performance vs NIFTY 500: <span className="num">{formatMaybePp(sector.relativeStrength.m3)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
