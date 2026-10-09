import { useEffect, useRef } from "react";
import type { StockScreenResult } from "../types/stockScreen";
import { formatDateHuman, formatMaybeNumber, formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { LineChart } from "./LineChart";

export interface StockDetailPanelProps {
  stock: StockScreenResult;
  onClose: () => void;
}

export function StockDetailPanel({ stock, onClose }: StockDetailPanelProps) {
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeBtnRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const priceData = stock.priceSeries.map((b) => ({ time: b.date, value: b.close }));

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={`${stock.symbol} details`}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 18, borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {stock.symbol} <span className="text-faint" style={{ fontSize: 13, fontWeight: 400 }}>{stock.companyName}</span>
            </h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 12 }} className="text-faint">
              <span>{stock.industry}</span>
              {stock.sectorSlugs.length > 0 && <span>· tracked in: {stock.sectorSlugs.join(", ")}</span>}
              <span>· as of {formatDateHuman(stock.latestDate.available ? stock.latestDate.value : null)}</span>
            </div>
          </div>
          <button type="button" ref={closeBtnRef} className="btn" onClick={onClose} aria-label="Close stock detail">
            Close
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 20 }}>
          <div className="card" style={{ padding: 10, background: "var(--color-insufficient-bg)", fontSize: 12 }}>
            Research/screening information only. This is not a buy or sell recommendation, and includes no entry
            price, stop-loss, or price target.
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Price history</h3>
            <LineChart data={priceData} ariaLabel={`${stock.symbol} price history chart`} />
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Returns</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 12 }}>
              {(
                [
                  ["1D", stock.returns.d1],
                  ["1W", stock.returns.w1],
                  ["1M", stock.returns.m1],
                  ["3M", stock.returns.m3],
                  ["6M", stock.returns.m6],
                ] as const
              ).map(([label, val]) => (
                <div key={label}>
                  <div className="text-faint">{label}</div>
                  <div className={`num ${signClass(val)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                    {formatMaybePct(val)}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 12 }}>
              <div>
                <div className="text-faint">Distance from 52-week high</div>
                <div className={`num ${signClass(stock.distanceFrom52wHigh)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatMaybePct(stock.distanceFrom52wHigh)}
                </div>
              </div>
              <div>
                <div className="text-faint">3M relative performance vs NIFTY 500</div>
                <div className={`num ${signClass(stock.relativePerformance3m)}`} style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatMaybePp(stock.relativePerformance3m)}
                </div>
              </div>
              <div>
                <div className="text-faint">Above own 50-DMA</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {stock.above50dma.available ? (stock.above50dma.value ? "Yes" : "No") : "N/A"}
                </div>
              </div>
              <div>
                <div className="text-faint">Above own 200-DMA</div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {stock.above200dma.available ? (stock.above200dma.value ? "Yes" : "No") : "N/A"}
                </div>
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Pattern heuristics</h3>
            <p className="text-faint" style={{ fontSize: 11.5, marginTop: -4 }}>
              Disclosed, deterministic heuristics - not a validated chart-pattern recognizer and not a prediction of
              direction. See the Backtest tab for out-of-sample evidence.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <strong style={{ fontSize: 12.5 }}>Resistance proximity: </strong>
                {stock.resistance.available ? (
                  <span style={{ fontSize: 12.5 }}>
                    nearest prior swing high = <span className="num">{stock.resistance.value.level.toFixed(2)}</span> on{" "}
                    {formatDateHuman(stock.resistance.value.levelDate)}, currently{" "}
                    <span className="num">{stock.resistance.value.distancePct.toFixed(2)}%</span> away.{" "}
                    {stock.resistance.value.isApproaching ? "Flagged as approaching." : "Not currently flagged as approaching."}
                  </span>
                ) : (
                  <span className="text-faint" style={{ fontSize: 12.5 }}>N/A ({stock.resistance.reason})</span>
                )}
              </div>
              <div>
                <strong style={{ fontSize: 12.5 }}>Consolidation: </strong>
                {stock.consolidation.available ? (
                  <span style={{ fontSize: 12.5 }}>
                    recent avg daily range <span className="num">{stock.consolidation.value.recentRangePct.toFixed(2)}%</span> vs. baseline{" "}
                    <span className="num">{stock.consolidation.value.baselineRangePct.toFixed(2)}%</span> (ratio{" "}
                    <span className="num">{stock.consolidation.value.contractionRatio.toFixed(2)}</span>).{" "}
                    {stock.consolidation.value.isConsolidating ? "Flagged as consolidating." : "Not currently flagged as consolidating."}
                  </span>
                ) : (
                  <span className="text-faint" style={{ fontSize: 12.5 }}>N/A</span>
                )}
              </div>
              <div>
                <strong style={{ fontSize: 12.5 }}>Triangle structure: </strong>
                {stock.triangle.available ? (
                  <span style={{ fontSize: 12.5 }}>
                    type = <strong>{stock.triangle.value.type}</strong> (highs slope{" "}
                    <span className="num">{stock.triangle.value.highSlopePctPerSession.toFixed(3)}%/session</span>, lows slope{" "}
                    <span className="num">{stock.triangle.value.lowSlopePctPerSession.toFixed(3)}%/session</span>, from{" "}
                    {stock.triangle.value.swingHighCount} swing highs and {stock.triangle.value.swingLowCount} swing lows).
                  </span>
                ) : (
                  <span className="text-faint" style={{ fontSize: 12.5 }}>N/A</span>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Why this score - pass/fail reasons</h3>
            <div className="text-faint" style={{ fontSize: 12, marginBottom: 8 }}>
              {stock.score.pointsEarned} of {stock.score.pointsPossible} available points (
              {stock.score.completenessPct.toFixed(0)}% of all 10 scoring points could be evaluated).
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {stock.score.conditions.map((c) => (
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
            <h3 style={{ fontSize: 13, margin: "0 0 10px" }}>Data quality</h3>
            <div
              className={`badge ${stock.dataQuality.status === "complete" ? "badge-bullish" : stock.dataQuality.status === "partial" ? "badge-insufficient" : "badge-bearish"}`}
            >
              {stock.dataQuality.status}
            </div>
            {stock.dataQuality.missing.length > 0 && (
              <ul style={{ fontSize: 12.5, margin: "8px 0 0", paddingLeft: 18 }} className="text-muted">
                {stock.dataQuality.missing.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </div>

          <div className="text-faint" style={{ fontSize: 11 }}>
            Current close: <span className="num">{formatMaybeNumber(stock.currentClose)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
