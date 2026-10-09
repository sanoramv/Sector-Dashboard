import { useEffect, useRef } from "react";
import type { IndustryMetrics } from "../types/industry";
import { formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { RegimeBadge } from "./RegimeBadge";

export interface IndustryDetailPanelProps {
  industry: IndustryMetrics;
  onClose: () => void;
}

export function IndustryDetailPanel({ industry, onClose }: IndustryDetailPanelProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={`${industry.name} details`}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 18, borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>{industry.name}</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <RegimeBadge regime={industry.regime.regime} />
              <span className="text-faint" style={{ fontSize: 12 }}>
                {industry.stockCount} constituent stock{industry.stockCount === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          <button type="button" ref={closeBtnRef} className="btn" onClick={onClose} aria-label="Close industry detail">
            Close
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 20 }}>
          <div className="card" style={{ padding: 12, background: "var(--color-surface-alt)", fontSize: 12.5 }}>
            NSE does not publish a price index for this industry classification. Every figure below is a computed,
            equal-weighted average across this industry's own constituent stocks' individually-measured metrics -
            not an official index value. The number in parentheses after each figure is how many of the{" "}
            {industry.stockCount} constituents actually had enough price history to contribute to that average.
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Average returns across all timeframes</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
              {(
                [
                  ["1D", industry.returns.d1, industry.returnsSampleSize.d1],
                  ["1W", industry.returns.w1, industry.returnsSampleSize.w1],
                  ["1M", industry.returns.m1, industry.returnsSampleSize.m1],
                  ["3M", industry.returns.m3, industry.returnsSampleSize.m3],
                  ["6M", industry.returns.m6, industry.returnsSampleSize.m6],
                ] as const
              ).map(([label, val, n]) => (
                <div key={label}>
                  <div className="text-faint">{label}</div>
                  <div className={`num ${signClass(val)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                    {formatMaybePct(val)}
                  </div>
                  <div className="text-faint" style={{ fontSize: 11 }}>
                    n={n}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Moving-average breadth</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
              {(
                [
                  ["20-DMA", industry.breadth.above20dma],
                  ["50-DMA", industry.breadth.above50dma],
                  ["200-DMA", industry.breadth.above200dma],
                ] as const
              ).map(([label, w]) => (
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
            <div style={{ marginTop: 10 }}>
              <div className="text-faint">Average distance from 52-week high</div>
              <div className={`num ${signClass(industry.distanceFrom52wHigh)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                {formatMaybePct(industry.distanceFrom52wHigh)}{" "}
                <span className="text-faint" style={{ fontSize: 11, fontWeight: 400 }}>
                  (n={industry.distanceSampleSize})
                </span>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="text-faint">Average 3M relative performance vs NIFTY 500</div>
              <div className={`num ${signClass(industry.relativePerformance3m)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                {formatMaybePp(industry.relativePerformance3m)}{" "}
                <span className="text-faint" style={{ fontSize: 11, fontWeight: 400 }}>
                  (n={industry.relativePerformanceSampleSize})
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Strength score breakdown</h3>
            <div className="text-faint" style={{ fontSize: 12, marginBottom: 8 }}>
              {industry.score.pointsEarned} of {industry.score.pointsPossible} available points (
              {industry.score.completenessPct.toFixed(0)}% of all 9 scoring points could be evaluated).
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {industry.score.conditions.map((c) => (
                <li key={c.id} style={{ marginBottom: 4 }}>
                  <span className={c.passed === null ? "text-faint" : c.passed ? "text-pos" : "text-neg"} aria-hidden="true">
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
              {industry.regime.reasons.map((r, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {r}
                </li>
              ))}
            </ul>
            <div className="text-faint" style={{ fontSize: 12, marginTop: 8 }}>
              Confidence: {industry.regime.confidence}. {industry.regime.confidenceReasons.join(" ")}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Data quality</h3>
            <div
              className={`badge ${industry.dataQuality.status === "complete" ? "badge-bullish" : industry.dataQuality.status === "partial" ? "badge-insufficient" : "badge-bearish"}`}
            >
              {industry.dataQuality.status}
            </div>
            {industry.dataQuality.missing.length > 0 && (
              <ul style={{ fontSize: 12.5, margin: "8px 0 0", paddingLeft: 18 }} className="text-muted">
                {industry.dataQuality.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
