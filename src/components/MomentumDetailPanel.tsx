import { useEffect, useRef } from "react";
import type { MomentumCandidate } from "../types/momentum";
import type { DailyBar } from "../types/market";
import type { ActivityRow } from "../types/activity";
import type { Maybe } from "../types/metrics";
import type { OutcomeStats } from "../lib/momentum/evaluation";
import type { FilingWindowResult } from "../lib/momentum/news";
import { CATEGORY_TEXT } from "../lib/momentum/news";
import { LABEL_DEFINITION, LABEL_TEXT } from "../lib/momentum/classify";
import { formatDateHuman, formatDateTimeHuman } from "../lib/format";
import { LineChart } from "./LineChart";
import { LABEL_BADGE } from "./MomentumTable";

export interface MomentumDetailPanelProps {
  candidate: MomentumCandidate;
  /** Comparable bars up to the evaluation date (never later). */
  bars: DailyBar[];
  activityByDate: Map<string, ActivityRow>;
  filings: FilingWindowResult;
  /** Historical next-session statistics for this candidate's group and label, if the evaluation has been run. */
  history: OutcomeStats | null;
  historyRan: boolean;
  onClose: () => void;
}

const pct = (m: Maybe<number>, d = 2) => (m.available ? `${m.value >= 0 ? "+" : ""}${m.value.toFixed(d)}%` : "N/A");
const pp = (m: Maybe<number>) => (m.available ? `${m.value >= 0 ? "+" : ""}${m.value.toFixed(2)}pp` : "N/A");
const num = (n: number | null, d = 2) => (n === null ? "N/A" : n.toFixed(d));

function Stat({ label, value, title }: { label: string; value: React.ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="text-faint" style={{ fontSize: 11.5 }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 14.5, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 };

export function MomentumDetailPanel({ candidate: c, bars, activityByDate, filings, history, historyRan, onClose }: MomentumDetailPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const recent = bars.slice(-120);
  const priceData = recent.map((b) => ({ time: b.date, value: b.close }));
  const volumeData = recent.filter((b) => activityByDate.has(b.date)).map((b) => ({ time: b.date, value: (activityByDate.get(b.date) as ActivityRow).volume }));
  const last10 = bars.slice(-10).reverse();
  const up = c.group === "gainer";
  const sym = encodeURIComponent(c.symbol);

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={`${c.symbol} next-day momentum research`}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: 18, borderBottom: "1px solid var(--color-border)", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>
              {c.symbol} <span className="text-faint" style={{ fontSize: 13, fontWeight: 400 }}>{c.companyName}</span>
            </h2>
            <div className="text-faint" style={{ fontSize: 12, marginTop: 6 }}>
              {c.industry}
              {c.segment ? ` · ${c.segment}-cap (by current index membership)` : ""} · #{c.rank} top {up ? "gainer" : "loser"} for the NSE session of{" "}
              <strong>{formatDateHuman(c.date)}</strong> (end-of-day data)
            </div>
          </div>
          <button type="button" ref={closeRef} className="btn" onClick={onClose} aria-label="Close research detail">
            Close
          </button>
        </div>

        <div style={{ padding: 18, display: "grid", gap: 20 }}>
          <div className="card" style={{ padding: 10, background: "var(--color-insufficient-bg)", fontSize: 12 }}>
            Research information only - a description of observed conditions, not a buy or sell recommendation. No entry
            price, stop-loss or target is given.
          </div>

          <div>
            <span className={`badge ${LABEL_BADGE[c.label]}`} style={{ fontSize: 12 }}>
              {LABEL_TEXT[c.label]}
            </span>
            <p style={{ fontSize: 12.5, margin: "8px 0 0" }} className="text-muted">
              {LABEL_DEFINITION[c.label]}
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
            <div>
              <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Supports {up ? "further upside" : "further weakness"} ({c.continuationFactors.length})</h3>
              {c.continuationFactors.length === 0 ? (
                <p className="text-faint" style={{ fontSize: 12.5 }}>None of the checked factors.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {c.continuationFactors.map((f) => (
                    <li key={f.id} style={{ marginBottom: 3 }}>{f.text}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Supports a reversal ({c.reversalFactors.length})</h3>
              {c.reversalFactors.length === 0 ? (
                <p className="text-faint" style={{ fontSize: 12.5 }}>None of the checked factors.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                  {c.reversalFactors.map((f) => (
                    <li key={f.id} style={{ marginBottom: 3 }}>{f.text}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {c.lowConfidenceReasons.length > 0 && (
            <div className="card" style={{ padding: 10, background: "var(--color-insufficient-bg)", fontSize: 12.5 }}>
              <strong>Reasons for low confidence</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {c.lowConfidenceReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Historical next-session record for this group and label</h3>
            {!historyRan ? (
              <p className="text-faint" style={{ fontSize: 12.5 }}>Run the historical evaluation below the tables to see how earlier {up ? "gainers" : "losers"} with this label did on the next session.</p>
            ) : !history ? (
              <p className="text-faint" style={{ fontSize: 12.5 }}>No historical observations for this group and label.</p>
            ) : (
              <>
                <div style={grid}>
                  <Stat label="Observations (dates)" value={`${history.n} (${history.dates})`} />
                  <Stat label="Next close higher" value={`${history.pctPositive.toFixed(1)}%`} title={history.pctPositiveCi ? `95% interval ${history.pctPositiveCi[0].toFixed(1)}-${history.pctPositiveCi[1].toFixed(1)}%, clustered by date` : undefined} />
                  <Stat label="Mean / median next session" value={`${history.meanPct.toFixed(2)}% / ${history.medianPct.toFixed(2)}%`} />
                  <Stat label="Beat NIFTY 500" value={`${history.pctOutperformNifty.toFixed(1)}%`} />
                  <Stat label="Next low below today's low" value={`${history.pctLowerLow.toFixed(1)}%`} />
                  <Stat label="Next open→close, net" value={`${history.meanOpenToCloseNetPct.toFixed(2)}%`} />
                </div>
                <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 0 }}>
                  Historical conditional frequencies over the available history - not a probability for this stock, and not a forecast.
                  {!history.sufficient && <strong> Insufficient sample: {history.insufficientReason}.</strong>}
                </p>
              </>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Price action</h3>
            <div style={grid}>
              <Stat label="Change (prev close→close)" value={`${c.price.dailyChangePct >= 0 ? "+" : ""}${c.price.dailyChangePct.toFixed(2)}%`} />
              <Stat label="Open→close" value={`${c.price.openToClosePct.toFixed(2)}%`} />
              <Stat label="Gap at open" value={`${c.price.gapPct.toFixed(2)}%`} />
              <Stat label="Close in day's range" value={c.price.closeLocation === null ? "N/A" : `${Math.round(c.price.closeLocation * 100)}%`} />
              <Stat label="3 / 5 sessions" value={`${pct(c.price.r3, 1)} / ${pct(c.price.r5, 1)}`} />
              <Stat label="10 / 20 sessions" value={`${pct(c.price.r10, 1)} / ${pct(c.price.r20, 1)}`} />
              <Stat label="Move vs own volatility" value={c.price.moveZ.available ? `${c.price.moveZ.value.toFixed(1)}σ` : "N/A"} title="Today's change divided by the standard deviation of the previous 20 daily changes" />
              <Stat label="vs 20 / 50 / 200-DMA" value={`${pct(c.price.distSma20Pct, 1)} / ${pct(c.price.distSma50Pct, 1)} / ${pct(c.price.distSma200Pct, 1)}`} />
              <Stat label="vs 52-week high" value={pct(c.price.distanceFrom52wHigh, 1)} title={c.price.distanceFrom52wHigh.available ? undefined : c.price.distanceFrom52wHigh.reason} />
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Patterns (existing dashboard detectors)</h3>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
              <li>
                Resistance (highest high of the prior 60 sessions):{" "}
                {c.patterns.resistance.available
                  ? `${c.patterns.resistance.value.level.toFixed(2)} on ${formatDateHuman(c.patterns.resistance.value.levelDate)}; close is ${c.patterns.resistance.value.distancePct.toFixed(2)}% ${c.patterns.resistance.value.distancePct >= 0 ? "above" : "below"} it${c.patterns.breakoutToday ? " (closed above - breakout)" : c.patterns.failedBreakoutToday ? " (traded above but closed below - failed breakout)" : ""}.`
                  : `N/A (${c.patterns.resistance.reason})`}
              </li>
              <li>
                Retest: {c.patterns.retest ? `held the ${c.patterns.retest.level.toFixed(2)} level broken on ${formatDateHuman(c.patterns.retest.breakoutDate)}.` : "no retest of a breakout from the previous 10 sessions."}
              </li>
              <li>
                Before today: consolidation{" "}
                {c.patterns.consolidationBefore.available
                  ? c.patterns.consolidationBefore.value.isConsolidating
                    ? `yes (range ratio ${c.patterns.consolidationBefore.value.contractionRatio.toFixed(2)})`
                    : `no (range ratio ${c.patterns.consolidationBefore.value.contractionRatio.toFixed(2)})`
                  : "N/A"}
                ; triangle{" "}
                {c.patterns.triangleBefore.available
                  ? c.patterns.triangleBefore.value.type === "none"
                    ? "none"
                    : `${c.patterns.triangleBefore.value.type} (${c.patterns.triangleBefore.value.confidence}${c.patterns.triangleBefore.value.tentativeReason ? `: ${c.patterns.triangleBefore.value.tentativeReason}` : ""})`
                  : "N/A"}
                .
              </li>
            </ul>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Volume and participation (NSE bhavcopy)</h3>
            {!c.activity.available ? (
              <p className="text-faint" style={{ fontSize: 12.5 }}>Unavailable: {c.activity.unavailableReason}.</p>
            ) : (
              <div style={grid}>
                <Stat label="Volume (shares)" value={c.activity.volume?.toLocaleString("en-IN") ?? "N/A"} />
                <Stat label="Relative volume (20d)" value={c.activity.relativeVolume.available ? `${c.activity.relativeVolume.value.toFixed(2)}x` : "N/A"} title={c.activity.relativeVolume.available ? undefined : c.activity.relativeVolume.reason} />
                <Stat label="Turnover today" value={c.activity.turnoverCr === null ? "N/A" : `₹${c.activity.turnoverCr.toFixed(2)} cr`} />
                <Stat label="Median turnover (20d)" value={c.activity.medianTurnover20Cr.available ? `₹${c.activity.medianTurnover20Cr.value.toFixed(2)} cr` : "N/A"} />
                <Stat label="Delivery % today / 20d avg" value={`${num(c.activity.deliveryPct, 1)} / ${c.activity.avgDeliveryPct20.available ? c.activity.avgDeliveryPct20.value.toFixed(1) : "N/A"}`} title="Deliverable quantity as % of traded quantity. 100% by rule in the BE/BZ trade-for-trade series." />
                <Stat label="NSE series" value={c.activity.series ?? "N/A"} />
              </div>
            )}
            {c.activity.liquidityWarnings.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12 }} className="text-muted">
                {c.activity.liquidityWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <p className="text-faint" style={{ fontSize: 11.5, marginBottom: 0 }}>High volume shows participation, not whether buyers or sellers initiated the trades.</p>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Sector and market context</h3>
            <div style={grid}>
              <Stat label={`${c.context.industry} peers' median change`} value={c.context.peerMedianChangePct === null ? "N/A" : `${c.context.peerMedianChangePct.toFixed(2)}% (${c.context.peerCount})`} />
              <Stat label="Move looks" value={c.context.moveScope === "unknown" ? "unknown (too few peers)" : c.context.moveScope} />
              <Stat label="Stock 1M vs NIFTY 500" value={pp(c.context.relativeStrength1m)} />
              <Stat label="Industry 1M vs NIFTY 500" value={pp(c.context.industryRelativeStrength1m)} title="Median 21-session return of industry peers minus NIFTY 500's" />
              <Stat label="NIFTY 500 today" value={pct(c.context.benchmarkChangePct)} />
              <Stat label="Market regime" value={c.context.marketRegime} />
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Exchange filings and catalysts</h3>
            <p style={{ fontSize: 12.5, margin: "0 0 6px" }}>{filings.summary}</p>
            <p className="text-faint" style={{ fontSize: 11.5, margin: "0 0 6px" }}>
              Window: {formatDateTimeHuman(filings.windowStart)} to {formatDateTimeHuman(filings.windowEnd)}. Source: NSE corporate announcements feed. Categories come from NSE's
              subject line; no positive/negative sentiment is inferred - open the filing to judge it.
            </p>
            {filings.filings.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {filings.filings.map((f) => (
                  <li key={f.id} style={{ marginBottom: 6 }}>
                    <span className="badge badge-sideways" style={{ fontSize: 10 }}>
                      {CATEGORY_TEXT[f.category]}
                    </span>{" "}
                    <span className={`badge ${f.timing === "before-close" ? "badge-insufficient" : "badge-sideways"}`} style={{ fontSize: 10 }}>
                      {f.timing === "before-close" ? "before the close" : "after the close"}
                    </span>{" "}
                    <a href={f.url} target="_blank" rel="noopener noreferrer">
                      {f.subject || "Filing"}
                    </a>{" "}
                    <span className="text-faint">({formatDateTimeHuman(f.publishedAt)})</span>
                    {f.description && <div className="text-muted" style={{ fontSize: 12 }}>{f.description}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Price (last {recent.length} comparable sessions to {formatDateHuman(c.date)})</h3>
            <LineChart data={priceData} height={200} ariaLabel={`${c.symbol} closing prices`} />
            <h3 style={{ fontSize: 13, margin: "12px 0 8px" }}>Volume</h3>
            <LineChart data={volumeData} height={120} kind="line" ariaLabel={`${c.symbol} daily volume`} />
          </div>

          <div className="scroll-x">
            <h3 style={{ fontSize: 13, margin: "0 0 8px" }}>Last 10 sessions</h3>
            <table aria-label={`${c.symbol} last 10 sessions`} style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  {["Date", "Open", "High", "Low", "Close", "Volume", "Delivery %"].map((h) => (
                    <th key={h} style={{ textAlign: "right", padding: "4px 8px" }} className="text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {last10.map((b) => {
                  const a = activityByDate.get(b.date);
                  return (
                    <tr key={b.date} style={{ borderTop: "1px solid var(--color-border)" }}>
                      <td style={{ textAlign: "right", padding: "4px 8px" }}>{b.date}</td>
                      {[b.open, b.high, b.low, b.close].map((v, i) => (
                        <td key={i} className="num" style={{ textAlign: "right", padding: "4px 8px" }}>
                          {v.toFixed(2)}
                        </td>
                      ))}
                      <td className="num" style={{ textAlign: "right", padding: "4px 8px" }}>{a ? a.volume.toLocaleString("en-IN") : "N/A"}</td>
                      <td className="num" style={{ textAlign: "right", padding: "4px 8px" }}>{a?.deliveryPct != null ? a.deliveryPct.toFixed(1) : "N/A"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 12.5 }}>
            <h3 style={{ fontSize: 13, margin: "0 0 6px" }}>Charts elsewhere</h3>
            <a href={`https://www.nseindia.com/get-quotes/equity?symbol=${sym}`} target="_blank" rel="noopener noreferrer">
              NSE quote page
            </a>
            {" · "}
            <a href={`https://www.tradingview.com/chart/?symbol=NSE%3A${sym}`} target="_blank" rel="noopener noreferrer">
              TradingView chart
            </a>
            <div className="text-faint" style={{ fontSize: 11.5, marginTop: 4 }}>
              No Groww link: Groww's stock pages use company-name addresses that cannot be derived reliably from the NSE symbol, so none is generated.
            </div>
          </div>

          <div className="text-faint" style={{ fontSize: 11 }}>
            Data quality: {c.quality.status} · {c.quality.barsUsed} comparable sessions from {formatDateHuman(c.quality.usableFrom)}
            {c.quality.notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
