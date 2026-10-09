import { METRIC_GLOSSARY } from "../content/metricGlossary";

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label="Help and metric glossary">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 18, borderBottom: "1px solid var(--color-border)" }}>
          <h2 style={{ margin: 0, fontSize: 17 }}>How to read this dashboard</h2>
          <button type="button" className="btn" onClick={onClose} aria-label="Close help">
            Close
          </button>
        </div>

        <div style={{ padding: 18 }}>
          <p style={{ fontSize: 13 }}>
            This is a research and screening tool for comparing NSE sectors. It is <strong>not</strong> an automated
            trading system, and nothing here predicts future returns. Every metric below is computed directly from
            officially published NSE data - when a metric cannot be computed reliably, it is shown as "N/A" rather
            than guessed.
          </p>

          <div className="card" style={{ padding: 12, marginBottom: 16, background: "var(--color-surface-alt)" }}>
            <strong style={{ fontSize: 13 }}>Worked example: why a strong 1D return can hide a weak 3M/6M trend</strong>
            <p style={{ fontSize: 13, marginBottom: 0 }}>
              Suppose a sector index jumps +2.5% today after a positive policy announcement, but is still down -8%
              over the last 3 months and -12% over the last 6 months. The 1D return alone makes it look exciting,
              but the longer windows show the sector is still in a larger downtrend that one good day hasn't
              reversed. This dashboard always shows all five return windows together for exactly this reason - never
              rely on 1D alone.
            </p>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            {Object.entries(METRIC_GLOSSARY).map(([key, m]) => (
              <div key={key}>
                <h3 style={{ fontSize: 14, margin: "0 0 4px" }}>{m.title}</h3>
                {m.formula && (
                  <div className="num text-muted" style={{ fontSize: 12.5, marginBottom: 4 }}>
                    {m.formula}
                  </div>
                )}
                <p style={{ fontSize: 13, margin: "0 0 4px" }}>{m.explanation}</p>
                <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
                  <strong>Example:</strong> {m.example}
                </p>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 12, marginTop: 16, background: "var(--color-surface-alt)" }}>
            <strong style={{ fontSize: 13 }}>Important limitations</strong>
            <ul style={{ fontSize: 12.5, marginBottom: 0 }}>
              <li>The strength score and regime classification are transparent heuristics, not validated predictive models.</li>
              <li>Breadth is computed from each sector index's official constituent stocks - never from the index's own moving average.</li>
              <li>During market hours, "latest market data" may be from the previous completed trading session - the header always shows the exact date.</li>
              <li>Five sectors named in common NSE sector lists (Capital Goods, Power, Construction, Insurance, Telecommunications) do not have an official NSE index tracked here because no reliable, browser/server-accessible historical data source was found for one - but real constituent-stock data for most of them is viewable under the Industries tab, clearly labeled as a computed aggregate, not an official index. See the README for details.</li>
              <li>Stock-screening patterns (near 52-week high, resistance, consolidation, triangle structure) are disclosed heuristics, not a validated chart-pattern recognizer, and are not predictions of future direction - see the Backtest tab for actual historical evidence on each one before treating any of them as effective.</li>
              <li>Nothing in this dashboard is a buy or sell recommendation. No entry price, stop-loss, or price target is ever shown.</li>
              <li>The four Market Capitalisation Segment panels use verified official NSE constituent lists: NIFTY Midcap 150 and NIFTY Smallcap 250 are confirmed strict subsets of NIFTY 500 (do not add their constituent counts to NIFTY 500's), while NIFTY Microcap 250 is a confirmed, fully separate universe with zero overlap with NIFTY 500.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
