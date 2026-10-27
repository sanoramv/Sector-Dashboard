import { useEffect, useMemo, useState } from "react";
import type { RawDataset } from "../types/dataset";
import type { AppSettings } from "../types/config";
import type { MomentumCandidate, MomentumLabel, SizeSegment } from "../types/momentum";
import { loadMomentumSupplements, type MomentumSupplements } from "../lib/providers/momentumData";
import { prepareUniverse, comparableBarsUpTo } from "../lib/momentum/universe";
import { marketContextAt } from "../lib/momentum/market";
import { DEFAULT_TOP_N, discover } from "../lib/momentum/discovery";
import { DEFAULT_FILTERS, matchesFilters, type MomentumFilters } from "../lib/momentum/filters";
import { filingsForSession } from "../lib/momentum/news";
import { momentumFreshnessNotices } from "../lib/momentum/freshness";
import { LABEL_TEXT } from "../lib/momentum/classify";
import { runMomentumEvaluation, type EvaluationConfig, type EvaluationResult } from "../lib/momentum/evaluation";
import { formatDateHuman, formatDateTimeHuman } from "../lib/format";
import { MomentumTable } from "./MomentumTable";
import { MomentumDetailPanel } from "./MomentumDetailPanel";
import { MomentumEvaluationPanel } from "./MomentumEvaluationPanel";
import { RegimeBadge } from "./RegimeBadge";

export interface MomentumPanelProps {
  rawDataset: RawDataset;
  settings: AppSettings;
  dataStatus: string;
}

const LABELS: MomentumLabel[] = ["momentum-continuation", "possible-breakout", "possible-reversal", "extended-reversal-risk", "weak-momentum", "mixed-signals", "insufficient-evidence"];
const SEGMENTS: Array<{ value: SizeSegment; label: string }> = [
  { value: "large", label: "Large (NIFTY 500 ex Midcap/Smallcap)" },
  { value: "mid", label: "Midcap 150" },
  { value: "small", label: "Smallcap 250" },
  { value: "micro", label: "Microcap 250" },
];

const NOTICE_BG = { info: "var(--color-accent-bg)", warning: "var(--color-insufficient-bg)", error: "var(--color-bearish-bg)" } as const;

export function MomentumPanel({ rawDataset, settings, dataStatus }: MomentumPanelProps) {
  const [supplements, setSupplements] = useState<MomentumSupplements | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [topN, setTopN] = useState(DEFAULT_TOP_N);
  const [filters, setFilters] = useState<MomentumFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<MomentumCandidate | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    loadMomentumSupplements(ctrl.signal).then(setSupplements, () => undefined);
    return () => ctrl.abort();
  }, []);

  const universe = useMemo(
    () => (supplements ? prepareUniverse(rawDataset, supplements.activity.status === "ok" ? supplements.activity.value : null) : null),
    [rawDataset, supplements],
  );
  const latestDate = universe?.calendar[universe.calendar.length - 1] ?? rawDataset.manifest.latestMarketDate;
  const date = selectedDate ?? latestDate;
  const market = useMemo(() => (universe ? marketContextAt(universe, date, settings) : null), [universe, date, settings]);
  const discovery = useMemo(
    () => (universe && market ? discover(universe, date, settings, market.regime.regime, topN) : null),
    [universe, market, date, settings, topN],
  );
  const industries = useMemo(() => [...new Set(universe?.stocks.map((s) => s.industry) ?? [])].sort(), [universe]);

  const gainers = useMemo(() => discovery?.gainers.filter((c) => matchesFilters(c, filters)) ?? [], [discovery, filters]);
  const losers = useMemo(() => discovery?.losers.filter((c) => matchesFilters(c, filters)) ?? [], [discovery, filters]);

  const notices = momentumFreshnessNotices(rawDataset.manifest, date, latestDate, dataStatus, {
    activity: supplements ? supplements.activity.status : "loading",
    announcements: supplements ? supplements.announcements.status : "loading",
  });
  const announcements = supplements?.announcements.status === "ok" ? supplements.announcements.value : null;
  const lastFeedRead = announcements?.checks.find((c) => c.outcome === "ok")?.checkedAt ?? null;

  function runEvaluation(config: EvaluationConfig) {
    if (!universe) return;
    setRunning(true);
    setTimeout(() => {
      setEvaluation(runMomentumEvaluation(universe, settings, config));
      setRunning(false);
    }, 20);
  }

  const input: React.CSSProperties = { padding: "6px 9px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };
  const set = <K extends keyof MomentumFilters>(k: K, v: MomentumFilters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  if (!supplements || !universe || !market || !discovery) {
    return (
      <div className="card" style={{ padding: 24, textAlign: "center" }} aria-live="polite">
        Loading volume and filings data for the Next-Day Momentum research page…
      </div>
    );
  }

  const calIdx = universe.calendarIndex.get(date) ?? universe.calendar.length - 1;
  const detail = selected
    ? (() => {
        const stock = universe.bySymbol.get(selected.symbol);
        const i = stock?.indexByDate.get(selected.date);
        if (!stock || i === undefined) return null;
        return {
          bars: comparableBarsUpTo(stock, i),
          activity: stock.activityByDate,
          filings: filingsForSession(announcements, selected.symbol, selected.date, universe.calendar[calIdx - 1] ?? null, universe.calendar[calIdx + 1] ?? null, new Date()),
          history: evaluation?.byGroupLabel.find((r) => r.key.group === selected.group && r.key.label === selected.label)?.stats ?? null,
        };
      })()
    : null;

  return (
    <div>
      <section className="card" style={{ padding: 14, marginBottom: 16, fontSize: 12.5 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>Next-Day Momentum research</h2>
        <p style={{ margin: "0 0 8px" }}>
          Top gainers and losers of one NSE session, with the evidence for and against the move continuing into the next
          session, and how similar setups actually did historically. A research tool that describes conditions - it does
          not predict tomorrow's prices, and gives no buy/sell, entry, stop-loss or target levels.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }} className="text-muted">
          <div>
            <strong>Session:</strong> {formatDateHuman(date)} (end of day){date === latestDate ? " — latest in the data" : ""}
          </div>
          <div>
            <strong>Prices &amp; volume:</strong> NSE equity bhavcopy (official), via the scheduled pipeline
            {rawDataset.manifest.refresh ? ` · refresh ${rawDataset.manifest.refresh.outcome}, evaluated ${formatDateTimeHuman(rawDataset.manifest.refresh.evaluatedAt)}` : ""}
          </div>
          <div>
            <strong>Universe:</strong> {universe.stocks.length} stocks — NIFTY 500 + Microcap 250 lists (the Nifty Total Market components), as fetched{" "}
            {formatDateHuman(universe.constituentsFetchedAt?.slice(0, 10))}
          </div>
          <div>
            <strong>Filings:</strong> NSE announcements feed{lastFeedRead ? `, last read ${formatDateTimeHuman(lastFeedRead)}` : " — not yet collected"}
          </div>
        </div>
        <p className="text-faint" style={{ margin: "8px 0 0", fontSize: 11.5 }}>
          Not Groww's live list: Groww has no public API for its top gainers/losers (its Trade API is a paid, per-account
          service), so the lists are computed from NSE's official end-of-day files and can differ from intraday lists or
          from Groww's own universe and timing.
        </p>
      </section>

      {notices.map((n, i) => (
        <div key={i} className="card" role={n.level === "error" ? "alert" : undefined} style={{ padding: 10, marginBottom: 10, fontSize: 12.5, background: NOTICE_BG[n.level] }}>
          {n.text}
        </div>
      ))}

      <section className="card" style={{ padding: 14, marginBottom: 16 }} aria-label="Market overview for the session">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center", fontSize: 13 }}>
          <div>
            <span className="text-faint">Market regime (NIFTY 500): </span>
            <RegimeBadge regime={market.regime.regime} />
          </div>
          <div>
            <span className="text-faint">NIFTY 500 that day: </span>
            <span className="num">{market.benchmarkReturns.d1.available ? `${market.benchmarkReturns.d1.value >= 0 ? "+" : ""}${market.benchmarkReturns.d1.value.toFixed(2)}%` : "N/A"}</span>
          </div>
          <div>
            <span className="text-faint">Above 50-DMA: </span>
            <span className="num">{market.breadth.above50dma.pct.available ? `${market.breadth.above50dma.pct.value.toFixed(0)}%` : "N/A"}</span>
            <span className="text-faint"> of {market.breadth.above50dma.eligible} NIFTY 500 stocks</span>
          </div>
          <div className="text-faint">
            {discovery.eligibleCount} of {discovery.universeSize} stocks ranked · {discovery.noSessionCount} had no bar this session · {discovery.excluded.length} excluded for price discontinuities
          </div>
        </div>
      </section>

      <section className="card" style={{ padding: 14, marginBottom: 16 }} aria-label="Filters">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: 13 }}>
          <label>
            Session{" "}
            <select style={input} value={date} onChange={(e) => setSelectedDate(e.target.value)} aria-label="Session date">
              {[...universe.calendar].reverse().slice(0, 260).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            List size{" "}
            <select style={input} value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  top {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Min move{" "}
            <select style={input} value={filters.minAbsChangePct} onChange={(e) => set("minAbsChangePct", Number(e.target.value))}>
              {[0, 2, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : `≥ ${n}%`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Rel. volume{" "}
            <select style={input} value={filters.minRelativeVolume} onChange={(e) => set("minRelativeVolume", Number(e.target.value))}>
              {[0, 1, 1.5, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "any" : `≥ ${n}x`}
                </option>
              ))}
            </select>
          </label>
          <select style={input} value={filters.industry} onChange={(e) => set("industry", e.target.value)} aria-label="Filter by industry">
            <option value="all">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <select style={input} value={filters.segment} onChange={(e) => set("segment", e.target.value as MomentumFilters["segment"])} aria-label="Filter by size segment">
            <option value="all">All sizes</option>
            {SEGMENTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <select
            style={input}
            value={filters.maxBelowResistancePct === null ? "any" : String(filters.maxBelowResistancePct)}
            onChange={(e) => set("maxBelowResistancePct", e.target.value === "any" ? null : Number(e.target.value))}
            aria-label="Distance from resistance"
          >
            <option value="any">Any distance from resistance</option>
            <option value="0">At/above resistance</option>
            <option value="3">Within 3% below or above</option>
            <option value="5">Within 5% below or above</option>
            <option value="10">Within 10% below or above</option>
          </select>
          <select style={input} value={filters.pattern} onChange={(e) => set("pattern", e.target.value as MomentumFilters["pattern"])} aria-label="Filter by pattern">
            <option value="any">Any pattern</option>
            <option value="breakout-today">Closed above resistance</option>
            <option value="retest">Breakout retest held</option>
            <option value="near-52w-high">Within 5% of 52-week high</option>
            <option value="consolidation-before">Consolidating before the move</option>
            <option value="triangle-before">Confirmed triangle before the move</option>
          </select>
          <select style={input} value={filters.label} onChange={(e) => set("label", e.target.value as MomentumFilters["label"])} aria-label="Filter by research label">
            <option value="all">All labels</option>
            {LABELS.map((l) => (
              <option key={l} value={l}>
                {LABEL_TEXT[l]}
              </option>
            ))}
          </select>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={filters.liquidOnly} onChange={(e) => set("liquidOnly", e.target.checked)} />
            Liquid only
          </label>
          <button type="button" className="btn" onClick={() => setFilters(DEFAULT_FILTERS)}>
            Reset
          </button>
        </div>
        <p className="text-faint" style={{ fontSize: 11.5, margin: "8px 0 0" }}>
          Lists are ranked by the day's % change, as on a broker's movers page - not by any score. Size uses current index
          membership (no market-cap figures are in the data). "Liquid only" hides stocks with under ₹1 crore median daily
          turnover and trade-for-trade (BE/BZ) stocks.
        </p>
      </section>

      <MomentumTable title={`Top ${topN} gainers — ${formatDateHuman(date)}`} group="gainer" candidates={gainers} totalBeforeFilters={discovery.gainers.length} onSelect={setSelected} />
      <MomentumTable title={`Top ${topN} losers — ${formatDateHuman(date)}`} group="loser" candidates={losers} totalBeforeFilters={discovery.losers.length} onSelect={setSelected} />

      {discovery.excluded.length > 0 && (
        <section className="card" style={{ padding: 12, marginBottom: 16, fontSize: 12.5 }}>
          <strong>Not ranked this session ({discovery.excluded.length}):</strong>{" "}
          <span className="text-muted">the bar starts a price discontinuity, so its change against the previous bar is not a comparable move.</span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {discovery.excluded.map((e) => (
              <li key={e.symbol}>
                <strong>{e.symbol}</strong>
                {e.rawChangePct !== null ? ` (unadjusted ${e.rawChangePct >= 0 ? "+" : ""}${e.rawChangePct.toFixed(1)}%)` : ""} — {e.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      <MomentumEvaluationPanel result={evaluation} running={running} onRun={runEvaluation} />

      {selected && detail && (
        <MomentumDetailPanel
          candidate={selected}
          bars={detail.bars}
          activityByDate={detail.activity}
          filings={detail.filings}
          history={detail.history}
          historyRan={evaluation !== null}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
