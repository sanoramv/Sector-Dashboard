import { useState } from "react";
import type { RawDataset } from "../types/dataset";
import type { AppSettings } from "../types/config";
import type { BacktestResult } from "../lib/backtest/engine";
import { runAllBacktests, DEFAULT_BACKTEST_CONFIG, type BacktestRunConfig } from "../lib/backtest/runAll";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

export interface BacktestPanelProps {
  rawDataset: RawDataset;
  settings: AppSettings;
}

function fmtPct(n: number | undefined, digits = 2): string {
  if (n === undefined) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function BacktestPanel({ rawDataset, settings }: BacktestPanelProps) {
  const [config, setConfig] = useState<BacktestRunConfig>(DEFAULT_BACKTEST_CONFIG);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<BacktestResult[] | null>(null);
  const [ranAt, setRanAt] = useState<{ config: BacktestRunConfig; settingsSnapshot: AppSettings } | null>(null);

  function run() {
    setRunning(true);
    // Yield one tick so the "Running..." state actually paints before the
    // synchronous, CPU-heavy backtest blocks the main thread.
    setTimeout(() => {
      const r = runAllBacktests(rawDataset, settings, config);
      setResults(r);
      setRanAt({ config, settingsSnapshot: settings });
      setRunning(false);
    }, 20);
  }

  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Backtest: does any screening rule actually show an edge?</h2>
      <p style={{ fontSize: 13 }}>
        This runs every rule exposed in the Stock Screener (and the sector-level "near 52-week high" rule) against
        the full available NIFTY 500 price history, computing, with <strong>no look-ahead</strong>: every time the
        rule would have fired historically, what the forward return actually was over a fixed holding period -
        compared against an unconditional baseline (holding anything, unconditionally, over the same dates).
      </p>

      <div className="card" style={{ padding: 12, marginBottom: 14, background: "var(--color-insufficient-bg)", fontSize: 12.5 }}>
        <strong>Read this before the results. This is NOT evidence that any rule is profitable.</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          <li>
            <strong>Survivorship bias:</strong> this uses today's NIFTY 500 constituent list applied across the
            entire backtest window. Stocks that were delisted, merged, or dropped from the index during this period
            are not included - this tends to inflate results relative to a true point-in-time universe.
          </li>
          <li>
            <strong>Execution assumption:</strong> entry is assumed at the next session's opening price (a signal is
            only known after the close), exit at the closing price N sessions after the signal date - still not a
            realistic fill.
          </li>
          <li>
            <strong>Short history:</strong> only about 14 months of stock prices are available, in one mostly
            range-bound market. Rules needing a year of history (near 52-week high) or 200 sessions (200-DMA) can only
            be evaluated over the last few months of it. There is no separate out-of-sample test period.
          </li>
          <li>
            <strong>Overlapping trades:</strong> a signal is evaluated on every session, so consecutive signals for
            the same stock share most of their holding period, and stocks in the same sector move together. The
            sample size "n" therefore greatly overstates the number of independent observations. No significance
            test is computed, because a naive one would be misleading.
          </li>
          <li>
            <strong>Unadjusted prices:</strong> NSE prices are not adjusted for corporate actions. Holding periods
            never cross a detected price discontinuity, but small bonuses and rights issues are not detected and can
            still distort individual returns.
          </li>
          <li>
            <strong>Changing thresholds in Settings and re-running</strong> tunes the rules to this same period
            (in-sample). Any improvement found that way is expected to shrink on new data.
          </li>
        </ul>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Holding period (sessions)
          <input
            type="number"
            min={1}
            max={60}
            value={config.holdingSessions}
            onChange={(e) => setConfig((c) => ({ ...c, holdingSessions: Math.max(1, Math.min(60, Number(e.target.value) || 1)) }))}
            style={{ width: 70, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Assumed round-trip cost (bps)
          <input
            type="number"
            min={0}
            max={500}
            value={config.costBps}
            onChange={(e) => setConfig((c) => ({ ...c, costBps: Math.max(0, Math.min(500, Number(e.target.value) || 0)) }))}
            style={{ width: 70, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={run} disabled={running}>
          {running ? "Running… (can take several seconds)" : "Run Backtest"}
        </button>
      </div>

      {results && ranAt && (
        <div className="scroll-x">
          <table aria-label="Backtest results">
            <thead>
              <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                {["Rule", "Signal N", "Win Rate", "Avg Net Return", "Median Net Return", "Baseline Avg Net Return", "Baseline N"].map((h) => (
                  <th key={h} style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
                <th style={{ textAlign: "right", padding: "8px 10px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    Edge vs Baseline
                    <MetricHelp content={METRIC_GLOSSARY.backtestEdge} />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const edge = r.signalStats && r.baselineStats ? r.signalStats.avgReturnPct - r.baselineStats.avgReturnPct : undefined;
                const tooFew = !r.signalStats || r.signalStats.n < 30;
                return (
                  <tr key={r.ruleName} style={{ borderBottom: "1px solid var(--color-border)" }}>
                    <td style={{ textAlign: "left", padding: "9px 10px", fontSize: 13, fontWeight: 600 }}>
                      {r.ruleName}
                      {tooFew && (
                        <span className="badge badge-insufficient" style={{ marginLeft: 6, fontSize: 10 }}>
                          low N
                        </span>
                      )}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {r.signalStats?.n ?? 0}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {r.signalStats ? `${r.signalStats.winRatePct.toFixed(1)}%` : "N/A"}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {fmtPct(r.signalStats?.avgReturnPct)}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {fmtPct(r.signalStats?.medianReturnPct)}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {fmtPct(r.baselineStats?.avgReturnPct)}
                    </td>
                    <td className="num" style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {r.baselineStats?.n ?? 0}
                    </td>
                    <td className={`num ${edge === undefined ? "" : edge > 0 ? "text-pos" : edge < 0 ? "text-neg" : ""}`} style={{ textAlign: "right", padding: "9px 10px", fontSize: 13 }}>
                      {edge === undefined ? "N/A" : `${edge >= 0 ? "+" : ""}${edge.toFixed(2)}pp`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-faint" style={{ fontSize: 11.5, marginTop: 10 }}>
            Ran with holding period = {ranAt.config.holdingSessions} sessions, assumed cost = {ranAt.config.costBps} bps,
            against current screening thresholds. "Edge vs baseline" is simply the signal's average net return minus
            the baseline's - a positive number means the rule's forward returns were higher than an unconditional
            hold over the same dates in THIS sample; it is not a significance test and is not a guarantee of future
            performance.
          </p>
          {results.some((r) => (r.signalStats?.n ?? 0) < 30) && (
            <ul className="text-muted" style={{ fontSize: 12, margin: "8px 0 0", paddingLeft: 18 }}>
              {results
                .filter((r) => (r.signalStats?.n ?? 0) < 30)
                .map((r) => (
                  <li key={r.ruleName}>
                    <strong>{r.ruleName}:</strong> {r.warnings[r.warnings.length - 1]}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}

      {!results && !running && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          Click "Run Backtest" to compute results. This runs entirely in your browser against the already-loaded
          price history - no additional network request is made.
        </p>
      )}
    </section>
  );
}
