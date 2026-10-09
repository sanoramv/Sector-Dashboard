import { useMemo, useState } from "react";
import type { StockScreenResult } from "../types/stockScreen";
import type { SectorMetrics } from "../types/metrics";
import type { IndustryMetrics } from "../types/industry";
import { formatMaybeNumber, formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

type SortDir = "asc" | "desc";

interface ColumnDef {
  key: string;
  label: string;
  helpKey?: string;
  accessor: (s: StockScreenResult) => number | null;
  render: (s: StockScreenResult, rank: number) => React.ReactNode;
  align?: "left" | "right";
}

function patternBadges(s: StockScreenResult): React.ReactNode {
  const items: string[] = [];
  if (s.distanceFrom52wHigh.available && s.distanceFrom52wHigh.value >= -5) items.push("52W");
  if (s.resistance.available && s.resistance.value.isApproaching) items.push("Res");
  if (s.consolidation.available && s.consolidation.value.isConsolidating) items.push("Cons");
  if (s.triangle.available && s.triangle.value.detected) items.push("Tri");
  if (items.length === 0) return <span className="text-faint">—</span>;
  return (
    <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
      {items.map((i) => (
        <span key={i} className="badge badge-sideways" style={{ fontSize: 10 }}>
          {i}
        </span>
      ))}
    </span>
  );
}

const COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", accessor: () => null, render: (_s, rank) => rank },
  {
    key: "symbol",
    label: "Symbol",
    accessor: (s) => s.symbol as unknown as number,
    render: (s) => (
      <div>
        <div style={{ fontWeight: 700 }}>{s.symbol}</div>
        <div className="text-faint" style={{ fontSize: 11 }}>
          {s.industry}
        </div>
      </div>
    ),
    align: "left",
  },
  {
    key: "close",
    label: "Close",
    accessor: (s) => (s.currentClose.available ? s.currentClose.value : null),
    render: (s) => <span className="num">{formatMaybeNumber(s.currentClose)}</span>,
  },
  {
    key: "d1",
    label: "1D",
    helpKey: "return1d",
    accessor: (s) => (s.returns.d1.available ? s.returns.d1.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.d1)}`}>{formatMaybePct(s.returns.d1)}</span>,
  },
  {
    key: "m1",
    label: "1M",
    helpKey: "return1m",
    accessor: (s) => (s.returns.m1.available ? s.returns.m1.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.m1)}`}>{formatMaybePct(s.returns.m1)}</span>,
  },
  {
    key: "m3",
    label: "3M",
    helpKey: "return3m",
    accessor: (s) => (s.returns.m3.available ? s.returns.m3.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.m3)}`}>{formatMaybePct(s.returns.m3)}</span>,
  },
  {
    key: "dist52w",
    label: "52W Dist",
    helpKey: "distance52w",
    accessor: (s) => (s.distanceFrom52wHigh.available ? s.distanceFrom52wHigh.value : null),
    render: (s) => <span className={`num ${signClass(s.distanceFrom52wHigh)}`}>{formatMaybePct(s.distanceFrom52wHigh)}</span>,
  },
  {
    key: "rs3m",
    label: "3M RS",
    helpKey: "relativePerformance",
    accessor: (s) => (s.relativePerformance3m.available ? s.relativePerformance3m.value : null),
    render: (s) => <span className={`num ${signClass(s.relativePerformance3m)}`}>{formatMaybePp(s.relativePerformance3m)}</span>,
  },
  {
    key: "patterns",
    label: "Patterns",
    accessor: () => null,
    render: (s) => patternBadges(s),
  },
  {
    key: "score",
    label: "Score",
    helpKey: "stockScore",
    accessor: (s) => s.score.pointsEarned,
    render: (s) => (
      <span className="num">
        {s.score.pointsEarned}/{s.score.pointsPossible}
      </span>
    ),
  },
];

export interface StockScreenerTableProps {
  stocks: StockScreenResult[];
  sectors: SectorMetrics[];
  industries: IndustryMetrics[];
  onSelect: (symbol: string) => void;
}

const LEADING_SCORE_THRESHOLD = 5;

export function StockScreenerTable({ stocks, sectors, industries, onSelect }: StockScreenerTableProps) {
  const [search, setSearch] = useState("");
  const [sectorFilter, setSectorFilter] = useState("all");
  const [industryFilter, setIndustryFilter] = useState("all");
  const [leadingOnly, setLeadingOnly] = useState(false);
  const [requireNear52w, setRequireNear52w] = useState(false);
  const [requireResistance, setRequireResistance] = useState(false);
  const [requireConsolidation, setRequireConsolidation] = useState(false);
  const [requireTriangle, setRequireTriangle] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const leadingSectorSlugs = useMemo(
    () => new Set(sectors.filter((s) => s.regime.regime === "bullish" || (s.regime.regime === "sideways" && s.score.pointsEarned >= LEADING_SCORE_THRESHOLD)).map((s) => s.slug)),
    [sectors],
  );
  const leadingIndustrySlugs = useMemo(
    () => new Set(industries.filter((i) => i.regime.regime === "bullish" || (i.regime.regime === "sideways" && i.score.pointsEarned >= LEADING_SCORE_THRESHOLD)).map((i) => i.slug)),
    [industries],
  );

  const industrySlugByName = useMemo(() => new Map(industries.map((i) => [i.name, i.slug])), [industries]);

  const filtered = useMemo(() => {
    return stocks.filter((s) => {
      if (search) {
        const q = search.toLowerCase();
        if (!s.symbol.toLowerCase().includes(q) && !s.companyName.toLowerCase().includes(q)) return false;
      }
      if (sectorFilter !== "all" && !s.sectorSlugs.includes(sectorFilter)) return false;
      if (industryFilter !== "all" && industrySlugByName.get(s.industry) !== industryFilter) return false;
      if (leadingOnly) {
        const inLeadingSector = s.sectorSlugs.some((slug) => leadingSectorSlugs.has(slug));
        const inLeadingIndustry = leadingIndustrySlugs.has(industrySlugByName.get(s.industry) ?? "");
        if (!inLeadingSector && !inLeadingIndustry) return false;
      }
      if (requireNear52w && !(s.distanceFrom52wHigh.available && s.distanceFrom52wHigh.value >= -5)) return false;
      if (requireResistance && !(s.resistance.available && s.resistance.value.isApproaching)) return false;
      if (requireConsolidation && !(s.consolidation.available && s.consolidation.value.isConsolidating)) return false;
      if (requireTriangle && !(s.triangle.available && s.triangle.value.detected)) return false;
      if (minScore > 0 && s.score.pointsEarned < minScore) return false;
      return true;
    });
  }, [
    stocks,
    search,
    sectorFilter,
    industryFilter,
    leadingOnly,
    leadingSectorSlugs,
    leadingIndustrySlugs,
    industrySlugByName,
    requireNear52w,
    requireResistance,
    requireConsolidation,
    requireTriangle,
    minScore,
  ]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const withValues = filtered.map((s) => ({ s, v: col.accessor(s) }));
    withValues.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      if (typeof a.v === "string" || typeof b.v === "string") {
        return String(a.v).localeCompare(String(b.v)) * (sortDir === "asc" ? 1 : -1);
      }
      return ((a.v as number) - (b.v as number)) * (sortDir === "asc" ? 1 : -1);
    });
    return withValues.map((w) => w.s);
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (key === "rank" || key === "patterns") return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setSectorFilter("all");
    setIndustryFilter("all");
    setLeadingOnly(false);
    setRequireNear52w(false);
    setRequireResistance(false);
    setRequireConsolidation(false);
    setRequireTriangle(false);
    setMinScore(0);
  }

  const filtersActive =
    search !== "" || sectorFilter !== "all" || industryFilter !== "all" || leadingOnly || requireNear52w || requireResistance || requireConsolidation || requireTriangle || minScore !== 0;

  const inputStyle: React.CSSProperties = { padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" };

  return (
    <section className="card" style={{ padding: 16 }}>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0 }}>
        Research screen over NIFTY 500 constituents. "Patterns" are disclosed, deterministic heuristics (near 52-week
        high, approaching a prior resistance level, a contracted trading range, or a simplified triangle
        trendline fit) - see Help for exact definitions. This is not a trading signal and does not predict
        direction; see the Backtest tab for out-of-sample evidence before treating any of these as effective.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search symbol or company…"
          aria-label="Search stocks"
          style={{ ...inputStyle, minWidth: 180 }}
        />
        <select value={sectorFilter} onChange={(e) => setSectorFilter(e.target.value)} aria-label="Filter by sector" style={inputStyle}>
          <option value="all">All sectors</option>
          {sectors.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.displayName} ({s.regime.regime}, {s.score.pointsEarned}/{s.score.pointsPossible})
            </option>
          ))}
        </select>
        <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} aria-label="Filter by industry" style={inputStyle}>
          <option value="all">All industries</option>
          {industries.map((i) => (
            <option key={i.slug} value={i.slug}>
              {i.name} ({i.regime.regime}, {i.score.pointsEarned}/{i.score.pointsPossible})
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Min score
          <select value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} aria-label="Filter by minimum score" style={inputStyle}>
            {[0, 2, 4, 6, 8, 10].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any" : `${n}+`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={resetFilters} disabled={!filtersActive}>
          Reset filters
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={leadingOnly} onChange={(e) => setLeadingOnly(e.target.checked)} />
          Leading sectors/industries only
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={requireNear52w} onChange={(e) => setRequireNear52w(e.target.checked)} />
          Near 52-week high
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={requireResistance} onChange={(e) => setRequireResistance(e.target.checked)} />
          Approaching resistance
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={requireConsolidation} onChange={(e) => setRequireConsolidation(e.target.checked)} />
          Consolidating
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={requireTriangle} onChange={(e) => setRequireTriangle(e.target.checked)} />
          Triangle detected
        </label>
        <span className="text-faint" style={{ fontSize: 12, marginLeft: "auto" }}>
          {sorted.length} of {stocks.length} stocks
        </span>
      </div>

      <div className="scroll-x">
        <table aria-label="Stock screening table">
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ textAlign: col.align === "left" ? "left" : "right", padding: "8px 10px", fontSize: 12, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      disabled={col.key === "rank" || col.key === "patterns"}
                      style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: col.key === "rank" ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {col.label}
                      {sortKey === col.key && <span aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>}
                    </button>
                    {col.helpKey && <MetricHelp content={METRIC_GLOSSARY[col.helpKey]} />}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((s, i) => (
              <tr
                key={s.symbol}
                onClick={() => onSelect(s.symbol)}
                tabIndex={0}
                role="button"
                aria-label={`View details for ${s.symbol}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(s.symbol);
                }}
                style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align === "left" ? "left" : "right", padding: "9px 10px", fontSize: 13 }}>
                    {col.render(s, i + 1)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 24, textAlign: "center" }} className="text-muted">
                  No stocks match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {sorted.length > 200 && (
          <p className="text-faint" style={{ fontSize: 12 }}>
            Showing the top 200 of {sorted.length} matches by the current sort - narrow your filters to see more precisely.
          </p>
        )}
      </div>
    </section>
  );
}
