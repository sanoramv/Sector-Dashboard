import type { SnapshotHistoryEntry } from "../types/snapshotHistory";
import { formatDateHuman, formatDateTimeHuman } from "../lib/format";
import { RegimeBadge } from "./RegimeBadge";
import type { Regime } from "../types/metrics";

export interface HistoryPanelProps {
  history: SnapshotHistoryEntry[];
  onExportJson: () => void;
}

export function HistoryPanel({ history, onExportJson }: HistoryPanelProps) {
  const sorted = [...history].sort((a, b) => b.marketDate.localeCompare(a.marketDate));

  return (
    <section className="card" style={{ padding: 16 }}>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0 }}>
        A compact summary is recorded locally in this browser every time <strong>Refresh Data</strong> successfully
        fetches a new trading day's data (never for a reloaded cache) - this lets you see how the market-wide
        regime distribution and top rankings evolved across sessions. This history lives only in this browser's
        local storage and is not synced anywhere.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
        <button type="button" className="btn" onClick={onExportJson} disabled={sorted.length === 0}>
          Export history JSON
        </button>
      </div>

      {sorted.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 13 }}>
          No history recorded yet - it builds up as you use the dashboard across different trading days.
        </p>
      ) : (
        <div className="scroll-x">
          <table aria-label="Snapshot history">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                {["Market Date", "Recorded", "Bullish", "Sideways", "Bearish", "Insufficient", "NIFTY 500 1M", "Top Sector", "Top Stock"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "8px 10px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((h) => (
                <tr key={h.marketDate} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "9px 10px", fontSize: 13 }}>{formatDateHuman(h.marketDate)}</td>
                  <td className="text-faint" style={{ padding: "9px 10px", fontSize: 12 }} title={formatDateTimeHuman(h.recordedAt)}>
                    {formatDateTimeHuman(h.recordedAt)}
                  </td>
                  <td className="num" style={{ padding: "9px 10px", fontSize: 13 }}>{h.bullishCount}</td>
                  <td className="num" style={{ padding: "9px 10px", fontSize: 13 }}>{h.sidewaysCount}</td>
                  <td className="num" style={{ padding: "9px 10px", fontSize: 13 }}>{h.bearishCount}</td>
                  <td className="num" style={{ padding: "9px 10px", fontSize: 13 }}>{h.insufficientDataCount}</td>
                  <td className="num" style={{ padding: "9px 10px", fontSize: 13 }}>
                    {h.benchmarkReturn1m === null ? "N/A" : `${h.benchmarkReturn1m >= 0 ? "+" : ""}${h.benchmarkReturn1m.toFixed(2)}%`}
                  </td>
                  <td style={{ padding: "9px 10px", fontSize: 13 }}>
                    {h.topSectors[0] ? (
                      <span>
                        {h.topSectors[0].displayName} ({h.topSectors[0].score}/{h.topSectors[0].scorePossible}){" "}
                        <RegimeBadge regime={h.topSectors[0].regime as Regime} />
                      </span>
                    ) : (
                      "N/A"
                    )}
                  </td>
                  <td style={{ padding: "9px 10px", fontSize: 13 }}>
                    {h.topStocks[0] ? `${h.topStocks[0].symbol} (${h.topStocks[0].score}/${h.topStocks[0].scorePossible})` : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
