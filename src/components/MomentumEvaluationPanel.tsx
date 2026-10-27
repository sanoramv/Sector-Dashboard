import { useState } from "react";
import type { EvaluationConfig, EvaluationResult, OutcomeStats } from "../lib/momentum/evaluation";
import { DEFAULT_EVALUATION_CONFIG } from "../lib/momentum/evaluation";
import { LABEL_TEXT } from "../lib/momentum/classify";
import { CATEGORY_TEXT } from "../lib/momentum/assess";

export interface MomentumEvaluationPanelProps {
  result: EvaluationResult | null;
  running: boolean;
  onRun: (config: EvaluationConfig) => void;
}

const f = (n: number, d = 2) => n.toFixed(d);
const ci = (c: [number, number] | null, d = 1) => (c ? `${c[0].toFixed(d)} to ${c[1].toFixed(d)}` : "n/a");

const HEADERS = ["Group", "n (dates)", "Next close higher", "95% CI", "Mean", "Median", "10th / 90th pct", "Down ≥3%", "Beat NIFTY 500", "Higher high", "Lower low", "Open→close net"];

function StatsRow({ name, s }: { name: React.ReactNode; s: OutcomeStats | null }) {
  const td: React.CSSProperties = { textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" };
  if (!s) return null;
  return (
    <tr style={{ borderTop: "1px solid var(--color-border)", opacity: s.sufficient ? 1 : 0.6 }} title={s.sufficient ? undefined : `Insufficient sample: ${s.insufficientReason}`}>
      <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
        {name}
        {!s.sufficient && (
          <span className="badge badge-insufficient" style={{ fontSize: 9.5, marginLeft: 4 }}>
            insufficient sample
          </span>
        )}
      </td>
      <td className="num" style={td}>
        {s.n} ({s.dates})
      </td>
      <td className="num" style={td}>{f(s.pctPositive, 1)}%</td>
      <td className="num text-faint" style={td}>{ci(s.pctPositiveCi)}</td>
      <td className="num" style={td} title={`95% CI ${ci(s.meanCi, 2)}`}>
        {f(s.meanPct)}%
      </td>
      <td className="num" style={td}>{f(s.medianPct)}%</td>
      <td className="num" style={td}>
        {f(s.p10, 1)} / {f(s.p90, 1)}
      </td>
      <td className="num" style={td}>{f(s.pctDown3, 1)}%</td>
      <td className="num" style={td}>{f(s.pctOutperformNifty, 1)}%</td>
      <td className="num" style={td}>{f(s.pctHigherHigh, 1)}%</td>
      <td className="num" style={td}>{f(s.pctLowerLow, 1)}%</td>
      <td className="num" style={td}>{f(s.meanOpenToCloseNetPct)}%</td>
    </tr>
  );
}

function StatsTable({ caption, rows }: { caption: string; rows: Array<{ name: React.ReactNode; s: OutcomeStats | null; key: string }> }) {
  return (
    <div className="scroll-x" style={{ marginBottom: 14 }}>
      <table aria-label={caption} style={{ fontSize: 12 }}>
        <caption style={{ textAlign: "left", fontWeight: 700, fontSize: 12.5, padding: "4px 0" }}>{caption}</caption>
        <thead>
          <tr>
            {HEADERS.map((h) => (
              <th key={h} className="text-muted" style={{ textAlign: h === "Group" ? "left" : "right", padding: "6px 8px", fontSize: 11, whiteSpace: "nowrap" }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <StatsRow key={r.key} name={r.name} s={r.s} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const groupName = (g: "gainer" | "loser") => (g === "gainer" ? "Gainers" : "Losers");

export function MomentumEvaluationPanel({ result, running, onRun }: MomentumEvaluationPanelProps) {
  const [config, setConfig] = useState<EvaluationConfig>(DEFAULT_EVALUATION_CONFIG);
  const input: React.CSSProperties = { padding: "5px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };

  return (
    <section className="card" style={{ padding: 16 }} aria-label="Historical next-session evaluation">
      <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>Historical evaluation: what happened on the next session?</h2>
      <p style={{ fontSize: 12.5, marginTop: 0 }}>
        For every session in the data, this rebuilds that day's top gainers and losers, classifies them using only data
        available at that close, and records the following session separately as: close-to-close return (positive or not,
        and versus NIFTY 500), whether the next high exceeded today's high, whether the next low broke today's low, and
        a tradable next-open→next-close return after costs. These are historical conditional frequencies, not promises
        of future performance.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 13 }}>
        <label>
          List size{" "}
          <select style={input} value={config.topN} onChange={(e) => setConfig({ ...config, topN: Number(e.target.value) })}>
            {[10, 20, 50].map((n) => (
              <option key={n} value={n}>
                top {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cost + slippage{" "}
          <select style={input} value={config.costBps} onChange={(e) => setConfig({ ...config, costBps: Number(e.target.value) })}>
            {[10, 20, 30, 50].map((n) => (
              <option key={n} value={n}>
                {n} bps round trip
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" onClick={() => onRun(config)} disabled={running}>
          {running ? "Running…" : result ? "Re-run evaluation" : "Run historical evaluation"}
        </button>
        <span className="text-faint" style={{ fontSize: 12 }}>Takes a few seconds; runs in your browser.</span>
      </div>

      {result && (
        <>
          <p style={{ fontSize: 12.5 }}>
            {result.sessionsEvaluated} sessions ({result.firstDate} to {result.lastDate}), {result.observations.length.toLocaleString("en-IN")} candidate
            observations, universe {result.universeSize} stocks, top {result.config.topN}, cost {result.config.costBps} bps.
          </p>

          <StatsTable
            caption="Baselines and groups"
            rows={[
              { key: "base", name: "All eligible universe stocks (baseline)", s: result.baselineAllStocks },
              ...result.byGroup.map((g) => ({ key: g.key, name: `Top ${result.config.topN} ${g.key}s (all labels)`, s: g.stats })),
            ]}
          />
          {result.baselineNifty500 && (
            <p className="text-faint" style={{ fontSize: 12, marginTop: -6 }}>
              NIFTY 500 itself: next session higher {f(result.baselineNifty500.pctPositive, 1)}% of {result.baselineNifty500.n} sessions, mean{" "}
              {f(result.baselineNifty500.meanPct, 3)}%, median {f(result.baselineNifty500.medianPct, 3)}%.
            </p>
          )}

          <StatsTable
            caption="By evidence category (the headline classification)"
            rows={result.byCategory.map((r) => ({ key: `${r.key.group}-${r.key.category}`, name: `${groupName(r.key.group)} · ${CATEGORY_TEXT[r.key.group][r.key.category]}`, s: r.stats }))}
          />

          <h3 style={{ fontSize: 13, margin: "4px 0 6px" }}>Does a category beat simply taking every top mover?</h3>
          <p style={{ fontSize: 12.5, marginTop: 0 }}>
            "Continued" = the next close moved further in the day's direction (higher for gainers, lower for losers). The
            base rate is the precision of taking every top mover in the group without any score.
          </p>
          <div className="scroll-x" style={{ marginBottom: 14 }}>
            <table style={{ fontSize: 12 }} aria-label="Category precision and recall">
              <thead>
                <tr>
                  {["Group · category", "Predicts", "Flagged (dates)", "Precision", "95% CI", "Base rate", "Lift", "Recall"].map((h) => (
                    <th key={h} className="text-muted" style={{ textAlign: h.startsWith("Group") ? "left" : "right", padding: "6px 8px", fontSize: 11, whiteSpace: "nowrap" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.classification.map((m) => {
                  const td: React.CSSProperties = { textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" };
                  const ciCoversBase = m.precisionCi ? m.precisionCi[0] <= m.baseRate && m.baseRate <= m.precisionCi[1] : true;
                  return (
                    <tr key={`${m.group}-${m.category}`} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ padding: "6px 8px" }}>{groupName(m.group)} · {CATEGORY_TEXT[m.group][m.category]}</td>
                      <td style={td}>{m.target}</td>
                      <td className="num" style={td}>{m.predicted} ({m.predictedDates})</td>
                      <td className="num" style={td}>{m.precision === null ? "n/a" : `${f(m.precision, 1)}%`}</td>
                      <td className="num text-faint" style={td}>{ci(m.precisionCi)}</td>
                      <td className="num" style={td}>{f(m.baseRate, 1)}%</td>
                      <td className="num" style={td}>
                        {m.liftPp === null ? "n/a" : `${m.liftPp >= 0 ? "+" : ""}${f(m.liftPp, 1)}pp`}{" "}
                        {ciCoversBase && <span className="badge badge-insufficient" style={{ fontSize: 9.5 }}>within uncertainty</span>}
                      </td>
                      <td className="num" style={td}>{m.recall === null ? "n/a" : `${f(m.recall, 1)}%`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <StatsTable
            caption="Evidence category by chronological third"
            rows={result.byCategoryFold.map((r) => ({
              key: `${r.key.fold}-${r.key.group}-${r.key.category}`,
              name: `${r.key.from} to ${r.key.to} · ${groupName(r.key.group)} · ${CATEGORY_TEXT[r.key.group][r.key.category]}`,
              s: r.stats,
            }))}
          />
          <StatsTable
            caption="First appearance only (consecutive-day repeats removed)"
            rows={result.firstAppearanceOnly.map((r) => ({ key: r.key, name: `${groupName(r.key)} (first day of each run)`, s: r.stats }))}
          />
          <StatsTable
            caption="By liquidity (median daily turnover, previous 20 sessions)"
            rows={result.byLiquidity.map((r) => ({ key: `${r.key.group}-${r.key.liquidity}`, name: `${groupName(r.key.group)} · ${r.key.liquidity === "unknown" ? "unknown (no volume baseline)" : `₹${r.key.liquidity}`}`, s: r.stats }))}
          />
          <StatsTable
            caption="By size of the day's move"
            rows={result.byMagnitude.map((r) => ({ key: `${r.key.group}-${r.key.magnitude}`, name: `${groupName(r.key.group)} · ${r.key.magnitude}`, s: r.stats }))}
          />
          <details style={{ marginBottom: 14 }}>
            <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 700 }}>By NSE industry ({result.byIndustry.length} rows)</summary>
            <StatsTable caption="By NSE industry" rows={result.byIndustry.map((r) => ({ key: `${r.key.group}-${r.key.industry}`, name: `${groupName(r.key.group)} · ${r.key.industry}`, s: r.stats }))} />
          </details>

          <StatsTable
            caption="By setup label"
            rows={result.byGroupLabel.map((r) => ({ key: `${r.key.group}-${r.key.label}`, name: `${groupName(r.key.group)} · ${LABEL_TEXT[r.key.label]}`, s: r.stats }))}
          />
          <StatsTable
            caption="By market regime on the evaluation date"
            rows={result.byRegime.map((r) => ({ key: `${r.key.group}-${r.key.regime}`, name: `${groupName(r.key.group)} · ${r.key.regime}`, s: r.stats }))}
          />
          <StatsTable
            caption="By volume confirmation (relative volume ≥ 1.5x)"
            rows={result.byVolume.map((r) => ({ key: `${r.key.group}-${r.key.volume}`, name: `${groupName(r.key.group)} · volume ${r.key.volume}`, s: r.stats }))}
          />
          <StatsTable
            caption="Chronological thirds (is the pattern stable over time?)"
            rows={result.byFold.map((r) => ({
              key: `${r.key.fold}-${r.key.group}-${r.key.label ?? "all"}`,
              name: `${r.key.from} to ${r.key.to} · ${groupName(r.key.group)}${r.key.label ? ` · ${LABEL_TEXT[r.key.label]}` : " (all)"}`,
              s: r.stats,
            }))}
          />

          <h3 style={{ fontSize: 13, margin: "8px 0 6px" }}>Walk-forward check: do the labels predict the next session better than the group's base rate?</h3>
          <p style={{ fontSize: 12.5, marginTop: 0 }}>
            Each prediction uses only earlier dates' outcomes: the label's historical share of higher next closes, versus
            simply the group's share. Skill above zero would mean the labels add information. No probability is shown
            elsewhere on this page unless this check finds clear skill.
          </p>
          <div className="scroll-x">
            <table style={{ fontSize: 12 }} aria-label="Walk-forward calibration">
              <thead>
                <tr>
                  {["Group", "Scored", "Brier (label or category)", "Brier (group base rate)", "Skill", "Reliability (predicted → observed)"].map((h) => (
                    <th key={h} className="text-muted" style={{ textAlign: "left", padding: "6px 8px", fontSize: 11 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...result.walkForward.map((w) => ({ w, by: "setup label" })), ...result.walkForwardCategory.map((w) => ({ w, by: "evidence category" }))].map(({ w, by }) => (
                  <tr key={`${w.group}-${by}`} style={{ borderTop: "1px solid var(--color-border)" }}>
                    <td style={{ padding: "6px 8px" }}>{groupName(w.group)} · by {by}</td>
                    <td className="num" style={{ padding: "6px 8px" }}>{w.scored}</td>
                    <td className="num" style={{ padding: "6px 8px" }}>{w.brierLabelModel?.toFixed(4) ?? "n/a"}</td>
                    <td className="num" style={{ padding: "6px 8px" }}>{w.brierGroupModel?.toFixed(4) ?? "n/a"}</td>
                    <td className="num" style={{ padding: "6px 8px" }}>
                      {w.skill === null ? "n/a" : w.skill.toFixed(4)}{" "}
                      {w.skill !== null && (w.skill <= 0.005 ? <span className="badge badge-insufficient" style={{ fontSize: 9.5 }}>no meaningful skill</span> : null)}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 11.5 }}>
                      {w.reliability.map((b) => `${b.bin}: ${b.meanPredicted.toFixed(0)}%→${b.observed.toFixed(0)}% (n=${b.n})`).join("; ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 13, margin: "14px 0 6px" }}>Exclusions</h3>
          <ul style={{ fontSize: 12, margin: 0, paddingLeft: 18 }}>
            <li>Not ranked because that day's bar starts a price discontinuity: {Object.entries(result.exclusions.moversExcluded).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.</li>
            <li>
              Candidates dropped because the next bar starts a discontinuity: {Object.entries(result.exclusions.nextSessionDiscontinuity).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}; with no bar on the next session: {result.exclusions.noNextBar}; next session not yet available:{" "}
              {result.exclusions.pendingNextSession}.
            </li>
          </ul>

          <div className="card" style={{ padding: 12, marginTop: 14, background: "var(--color-insufficient-bg)", fontSize: 12.5 }}>
            <strong>Limitations</strong>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {result.warnings.map((w, i) => (
                <li key={i} style={{ marginBottom: 3 }}>
                  {w}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
