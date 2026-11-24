import { useEffect, useMemo, useState } from "react";
import {
  COST_BPS,
  GROUP_FILTER,
  GROUP_TEXT,
  HORIZONS,
  OD1_CLASS_ORDER,
  checkpointOf,
  horizonStats,
  officialSessions,
  overview,
  type EvaluationSummary,
  type GroupKey,
  type Horizon,
  type HorizonStats,
  type Interval,
} from "../lib/evaluation/liveEvaluation";

const DATA_BASE = `${import.meta.env.BASE_URL}data/evaluation`;
const RULE = "mv1-8ecef864";
const GROUPS: GroupKey[] = ["B", "C", "E", "F", "D", "L"];
const HIST_GROUPS: GroupKey[] = ["B", "C", "E", "F", "D"];

interface HistGroup {
  stockDays: number;
  sessions: number;
  [h: string]: any;
}
interface Historical {
  period: { first: string; last: string; sessions: number };
  source: string;
  groups: Record<string, HistGroup>;
}

const f = (x: number | null | undefined, d = 1) => (x === null || x === undefined || !Number.isFinite(x) ? "–" : x.toFixed(d));
const sign = (x: number | null | undefined, d = 2) => (x === null || x === undefined ? "–" : `${x > 0 ? "+" : ""}${x.toFixed(d)}`);
const iv = (x: Interval, d = 1, signed = false) => (
  <>
    {signed ? sign(x.value, d) : f(x.value, d)}
    {x.ci && (
      <span className="text-faint" style={{ fontSize: 10.5 }}>
        {" "}
        [{signed ? sign(x.ci[0], d) : f(x.ci[0], d)}, {signed ? sign(x.ci[1], d) : f(x.ci[1], d)}]
      </span>
    )}
  </>
);
const CLASS_COLOR: Record<string, string> = { confirmed: "#2e7d32", partial: "#81c784", sideways: "#9e9e9e", failed: "#ef6c00", reversal: "#c62828" };
const td: React.CSSProperties = { textAlign: "right", padding: "6px 8px", whiteSpace: "nowrap" };
const th: React.CSSProperties = { ...td, fontSize: 11 };

function ClassBar({ classes, total }: { classes: Record<string, number>; total: number }) {
  if (!total) return <span className="text-faint">–</span>;
  return (
    <div style={{ display: "flex", width: 160, height: 10, borderRadius: 3, overflow: "hidden" }} title={OD1_CLASS_ORDER.map((c) => `${c} ${classes[c] ?? 0}`).join(", ")}>
      {OD1_CLASS_ORDER.map((c) => (
        <div key={c} style={{ width: `${(100 * (classes[c] ?? 0)) / total}%`, background: CLASS_COLOR[c] }} />
      ))}
    </div>
  );
}

function GroupTable({ stats }: { stats: Array<{ g: GroupKey; s: HorizonStats }> }) {
  return (
    <div className="scroll-x">
      <table style={{ fontSize: 12 }} aria-label="Live outcomes by group">
        <thead>
          <tr className="text-muted">
            <th style={{ ...th, textAlign: "left" }}>Group</th>
            <th style={th} title="completed outcomes (distinct sessions)">n (sessions)</th>
            <th style={th}>Pending</th>
            <th style={th} title="unavailable outcomes: insufficient history, missing bar, corporate-action discontinuity">Unavailable</th>
            <th style={{ ...th, textAlign: "left" }}>Class mix</th>
            <th style={th} title="Failed + Reversal, % of completed">Adverse %</th>
            <th style={th}>Confirmed %</th>
            <th style={th} title="close at t+h above the prediction-day close">Up %</th>
            <th style={th} title="beat NIFTY 500 over the window">Beat N500 %</th>
            <th style={th}>Mean / median return %</th>
            <th style={th} title="benchmark-relative">Mean vs N500 (pp)</th>
            <th style={th} title={`open(t+1) to close(t+h) minus ${COST_BPS} bps`}>Tradable net %</th>
            <th style={th} title="best high / worst low inside the window vs the prediction-day close">MFE / MAE %</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(({ g, s }) => {
            const un = Object.values(s.unavailable).reduce((a, b) => a + b, 0);
            const small = s.sessionsWithOutcomes < 20;
            return (
              <tr key={g} style={{ borderTop: "1px solid var(--color-border)", opacity: s.complete ? 1 : 0.55 }}>
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>
                  {GROUP_TEXT[g]}
                  {small && s.complete > 0 && (
                    <span className="badge badge-insufficient" style={{ fontSize: 9.5, marginLeft: 4 }}>
                      {s.sessionsWithOutcomes} session{s.sessionsWithOutcomes === 1 ? "" : "s"}
                    </span>
                  )}
                </td>
                <td className="num" style={td}>
                  {s.complete} ({s.sessionsWithOutcomes})
                </td>
                <td className="num" style={td}>{s.pending}</td>
                <td className="num" style={td} title={Object.entries(s.unavailable).map(([k, v]) => `${k}: ${v}`).join(", ")}>
                  {un}
                </td>
                <td style={{ ...td, textAlign: "left" }}>
                  <ClassBar classes={s.classes} total={s.complete} />
                </td>
                <td className="num" style={td}>{iv(s.adverse)}</td>
                <td className="num" style={td}>{iv(s.confirmed)}</td>
                <td className="num" style={td}>{f(s.hitR)}</td>
                <td className="num" style={td}>{f(s.hitX)}</td>
                <td className="num" style={td}>
                  {sign(s.meanR.value)} / {sign(s.medianR)}
                </td>
                <td className="num" style={td}>{iv(s.meanX, 2, true)}</td>
                <td className="num" style={td}>{iv(s.meanNet, 2, true)}</td>
                <td className="num" style={td}>
                  {sign(s.meanMfe)} / {sign(s.meanMae)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HistoricalTable({ hist, live, h }: { hist: Historical; live: Record<GroupKey, HorizonStats>; h: Horizon }) {
  return (
    <div className="scroll-x">
      <table style={{ fontSize: 12 }} aria-label="Historical versus live">
        <thead>
          <tr className="text-muted">
            <th style={{ ...th, textAlign: "left" }}>Group</th>
            <th style={th}>Historical n (sessions)</th>
            <th style={th}>Live n (sessions)</th>
            <th style={th}>Adverse %: historical → live</th>
            <th style={th}>Confirmed %: historical → live</th>
            <th style={th}>Mean vs N500 (pp): historical → live</th>
            <th style={th}>Tradable net %: historical → live</th>
          </tr>
        </thead>
        <tbody>
          {HIST_GROUPS.map((g) => {
            const H = hist.groups[g]?.[`h${h}`];
            const L = live[g];
            if (!H) return null;
            return (
              <tr key={g} style={{ borderTop: "1px solid var(--color-border)" }}>
                <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }}>{GROUP_TEXT[g]}</td>
                <td className="num" style={td}>
                  {H.complete} ({hist.groups[g].sessions})
                </td>
                <td className="num" style={td}>
                  {L.complete} ({L.sessionsWithOutcomes})
                </td>
                <td className="num" style={td}>
                  {iv({ value: H.adverse.v, ci: H.adverse.ci })} → {iv(L.adverse)}
                </td>
                <td className="num" style={td}>
                  {iv({ value: H.confirmed.v, ci: H.confirmed.ci })} → {iv(L.confirmed)}
                </td>
                <td className="num" style={td}>
                  {iv({ value: H.meanX.v, ci: H.meanX.ci }, 2, true)} → {iv(L.meanX, 2, true)}
                </td>
                <td className="num" style={td}>
                  {iv({ value: H.net20.v, ci: H.net20.ci }, 2, true)} → {iv(L.meanNet, 2, true)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PredictionBrowser({ summary }: { summary: EvaluationSummary }) {
  const [group, setGroup] = useState<GroupKey>("C");
  const [date, setDate] = useState<string>("all");
  const sessions = officialSessions(summary);
  const rows = sessions
    .filter((s) => date === "all" || s.date === date)
    .flatMap((s) => s.predictions.filter(GROUP_FILTER[group]).map((p) => ({ s, p })))
    .sort((a, b) => b.s.date.localeCompare(a.s.date) || a.p.symbol.localeCompare(b.p.symbol));
  return (
    <>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 8, fontSize: 12.5 }}>
        <label>
          Group{" "}
          <select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            {GROUPS.map((g) => (
              <option key={g} value={g}>
                {GROUP_TEXT[g]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Session{" "}
          <select value={date} onChange={(e) => setDate(e.target.value)}>
            <option value="all">All official sessions</option>
            {sessions.map((s) => (
              <option key={s.date} value={s.date}>
                {s.date}
              </option>
            ))}
          </select>
        </label>
        <span className="text-muted">{rows.length} predictions</span>
      </div>
      <div className="scroll-x" style={{ maxHeight: 460, overflowY: "auto" }}>
        <table style={{ fontSize: 12 }} aria-label="Individual predictions and outcomes">
          <thead>
            <tr className="text-muted">
              <th style={{ ...th, textAlign: "left" }}>Date</th>
              <th style={{ ...th, textAlign: "left" }}>Stock</th>
              <th style={th}>Rank</th>
              <th style={th}>Day %</th>
              <th style={{ ...th, textAlign: "left" }}>Setup / evidence (score)</th>
              <th style={{ ...th, textAlign: "left" }}>Regime</th>
              {HORIZONS.map((h) => (
                <th key={h} style={th} title={`OD1 class, return % and vs NIFTY 500 (pp) at h=${h}`}>
                  h={h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ s, p }) => {
              const rank = p.lists.find(([l]) => l === (p.group === "gainer" ? "gainer" : "loser"))?.[1];
              return (
                <tr key={p.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ ...td, textAlign: "left" }}>{s.date}</td>
                  <td style={{ ...td, textAlign: "left", whiteSpace: "normal" }} title={`${p.name} · ${p.industry} · ${p.segment ?? "–"}`}>
                    <strong>{p.symbol}</strong>
                  </td>
                  <td className="num" style={td}>{rank ?? "–"}</td>
                  <td className="num" style={td}>{sign(p.changePct)}</td>
                  <td style={{ ...td, textAlign: "left" }}>
                    {p.setup} / {p.evidence} ({p.netScore ?? "–"})
                  </td>
                  <td style={{ ...td, textAlign: "left" }}>{s.regime ?? "–"}</td>
                  {HORIZONS.map((h) => {
                    const o = p.out[`h${h}`];
                    const hz = s.horizons[`h${h}`];
                    if (!o) return <td key={h} className="text-faint" style={td} title={hz?.reason ?? hz?.status}>{hz?.status === "blocked" ? "blocked" : "pending"}</td>;
                    if (o.s === "unavailable") return <td key={h} className="text-faint" style={td}>{o.why}</td>;
                    return (
                      <td key={h} style={td} title={`return ${sign(o.R)}%, vs N500 ${sign(o.X)}pp, tradable gross ${sign(o.T)}%; matured ${hz?.end}, processed ${hz?.processedAt?.slice(0, 10)}`}>
                        <span style={{ color: CLASS_COLOR[o.c ?? ""] ?? "inherit", fontWeight: 600 }}>{o.c}</span> <span className="num">{sign(o.R, 1)}</span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function EvaluationPanel() {
  const [summary, setSummary] = useState<EvaluationSummary | null>(null);
  const [hist, setHist] = useState<Historical | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [h, setH] = useState<Horizon>(1);
  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      fetch(`${DATA_BASE}/${RULE}.json`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`evaluation data: HTTP ${r.status}`)))),
      fetch(`${DATA_BASE}/historical-${RULE}.json`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([s, hh]) => {
        setSummary(s);
        setHist(hh);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(String(e instanceof Error ? e.message : e));
      });
    return () => ctl.abort();
  }, []);
  const stats = useMemo(() => (summary ? (Object.fromEntries(GROUPS.map((g) => [g, horizonStats(summary, g, h)])) as Record<GroupKey, HorizonStats>) : null), [summary, h]);
  if (error) return <div className="card" style={{ padding: 20 }}>Evaluation data could not be loaded ({error}). It is created by the scheduled data update.</div>;
  if (!summary || !stats) return <div className="card" style={{ padding: 20, textAlign: "center" }}>Loading evaluation…</div>;
  const ov = overview(summary);
  const cp = checkpointOf(stats.B.sessionsWithOutcomes);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 14, fontSize: 12.5, lineHeight: 1.5 }}>
        <strong>Live evaluation of the frozen prediction rule {summary.ruleVersion}</strong> — a research and learning tool, not a trading
        recommendation. Shares are observed frequencies of completed outcomes, not probabilities. Close-to-close and benchmark-relative
        returns are not tradable; the tradable column enters at the next open and pays {COST_BPS} bps. Continuous monitoring since{" "}
        {summary.policy.decidedAt} (outcomes from {summary.policy.outcomesFrom}); excluded:{" "}
        {summary.policy.excludedSessions.map((e) => e.sessionDate).join(", ") || "none"}.
        <div style={{ marginTop: 8 }}>
          <span className="badge badge-insufficient">
            checkpoint {cp.reached ?? 0}
            {cp.next ? ` → next ${cp.next}` : ""} sessions
          </span>{" "}
          {cp.message} Intervals (in brackets) resample whole sessions and appear from 5 sessions.
        </div>
      </div>

      <div className="card" style={{ padding: 14, fontSize: 12.5 }}>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span>
            Predictions captured: <strong>{ov.captured}</strong> in {ov.sessions} sessions
          </span>
          <span>
            Official sessions: <strong>{ov.official}</strong>
          </span>
          {HORIZONS.map((x) => (
            <span key={x}>
              h={x}: <strong>{ov.perH[`h${x}`].mature}</strong> mature, {ov.perH[`h${x}`].pending} pending
            </span>
          ))}
        </div>
        {ov.excluded.length > 0 && (
          <div className="text-muted" style={{ marginTop: 6 }}>
            Not in official statistics: {ov.excluded.map((e) => `${e.date} (${e.reason})`).join("; ")}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>Outcomes by group</strong>
          {HORIZONS.map((x) => (
            <button key={x} type="button" className={x === h ? "btn btn-primary" : "btn"} onClick={() => setH(x)}>
              h = {x}
            </button>
          ))}
          <span className="text-muted" style={{ fontSize: 11.5 }}>
            h = 1 and 5 are the headline horizons
          </span>
        </div>
        <GroupTable stats={GROUPS.map((g) => ({ g, s: stats[g] }))} />
        <div className="text-muted" style={{ fontSize: 11.5, marginTop: 6 }}>
          Class mix: <span style={{ color: CLASS_COLOR.confirmed }}>confirmed</span>, <span style={{ color: CLASS_COLOR.partial }}>partial</span>,{" "}
          <span style={{ color: CLASS_COLOR.sideways }}>sideways</span>, <span style={{ color: CLASS_COLOR.failed }}>failed</span>,{" "}
          <span style={{ color: CLASS_COLOR.reversal }}>reversal</span> (sealed OD1 protocol).
        </div>
      </div>

      {hist && (
        <div className="card" style={{ padding: 14 }}>
          <strong style={{ fontSize: 13 }}>Historical versus live (identical definitions, h = {h})</strong>
          <div className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
            Historical: {hist.period.first} to {hist.period.last} ({hist.period.sessions} sessions), in-sample and already examined. Live: official
            sessions only. Small live samples will differ from history by chance.
          </div>
          <HistoricalTable hist={hist} live={stats} h={h} />
        </div>
      )}

      <div className="card" style={{ padding: 14 }}>
        <strong style={{ fontSize: 13 }}>Prediction browser</strong>
        <div className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 8px" }}>
          Each prediction as recorded on its session date, and its outcome once each horizon matured (hover for returns and dates).
        </div>
        <PredictionBrowser summary={summary} />
      </div>
    </div>
  );
}
