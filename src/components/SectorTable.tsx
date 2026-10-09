import { useMemo, useState } from "react";
import type { Regime, SectorMetrics } from "../types/metrics";
import { formatMaybeNumber, formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { RegimeBadge } from "./RegimeBadge";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

type SortDir = "asc" | "desc";

interface ColumnDef {
  key: string;
  label: string;
  helpKey?: string;
  accessor: (s: SectorMetrics) => number | null;
  render: (s: SectorMetrics, rank: number) => React.ReactNode;
  align?: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  {
    key: "rank",
    label: "#",
    accessor: () => null,
    render: (_s, rank) => rank,
  },
  {
    key: "name",
    label: "Sector",
    accessor: (s) => (s.displayName as unknown as number) ?? null,
    render: (s) => (
      <span style={{ fontWeight: 600 }}>
        {s.displayName}
        {s.overlapNote && <span className="text-faint" title={s.overlapNote} style={{ marginLeft: 4 }}>ⓘ</span>}
      </span>
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
    key: "w1",
    label: "1W",
    helpKey: "return1w",
    accessor: (s) => (s.returns.w1.available ? s.returns.w1.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.w1)}`}>{formatMaybePct(s.returns.w1)}</span>,
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
    key: "m6",
    label: "6M",
    helpKey: "return6m",
    accessor: (s) => (s.returns.m6.available ? s.returns.m6.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.m6)}`}>{formatMaybePct(s.returns.m6)}</span>,
  },
  {
    key: "b20",
    label: "%>20D",
    helpKey: "breadth20",
    accessor: (s) => (s.breadth.above20dma.pct.available ? s.breadth.above20dma.pct.value : null),
    render: (s) => <span className="num">{formatMaybePct(s.breadth.above20dma.pct, 0)}</span>,
  },
  {
    key: "b50",
    label: "%>50D",
    helpKey: "breadth50",
    accessor: (s) => (s.breadth.above50dma.pct.available ? s.breadth.above50dma.pct.value : null),
    render: (s) => <span className="num">{formatMaybePct(s.breadth.above50dma.pct, 0)}</span>,
  },
  {
    key: "b200",
    label: "%>200D",
    helpKey: "breadth200",
    accessor: (s) => (s.breadth.above200dma.pct.available ? s.breadth.above200dma.pct.value : null),
    render: (s) => <span className="num">{formatMaybePct(s.breadth.above200dma.pct, 0)}</span>,
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
    accessor: (s) => (s.relativeStrength.m3.available ? s.relativeStrength.m3.value : null),
    render: (s) => <span className={`num ${signClass(s.relativeStrength.m3)}`}>{formatMaybePp(s.relativeStrength.m3)}</span>,
  },
  {
    key: "score",
    label: "Score",
    helpKey: "strengthScore",
    accessor: (s) => s.score.pointsEarned,
    render: (s) => (
      <span className="num" title={`${s.score.completenessPct.toFixed(0)}% of scoring points could be evaluated`}>
        {s.score.pointsEarned}/{s.score.pointsPossible}
        {s.score.completenessPct < 100 && <span className="text-faint"> ({s.score.completenessPct.toFixed(0)}%)</span>}
      </span>
    ),
  },
  {
    key: "regime",
    label: "Regime",
    helpKey: "regime",
    accessor: (s) => REGIME_ORDER[s.regime.regime],
    render: (s) => <RegimeBadge regime={s.regime.regime} />,
  },
  {
    key: "dq",
    label: "Data Quality",
    accessor: (s) => DQ_ORDER[s.dataQuality.status],
    render: (s) => (
      <span
        className={`badge ${s.dataQuality.status === "complete" ? "badge-bullish" : s.dataQuality.status === "partial" ? "badge-insufficient" : "badge-bearish"}`}
        title={s.dataQuality.missing.length > 0 ? `Missing: ${s.dataQuality.missing.join("; ")}` : "All metrics available"}
      >
        {s.dataQuality.status}
      </span>
    ),
  },
];

const REGIME_ORDER: Record<Regime, number> = { bullish: 3, sideways: 2, bearish: 1, "insufficient-data": 0 };
const DQ_ORDER: Record<string, number> = { complete: 2, partial: 1, unavailable: 0 };

export interface SectorTableProps {
  sectors: SectorMetrics[];
  onSelect: (slug: string) => void;
}

const REGIME_FILTERS: Array<{ value: Regime | "all"; label: string }> = [
  { value: "all", label: "All classifications" },
  { value: "bullish", label: "Bullish" },
  { value: "sideways", label: "Sideways / Mixed" },
  { value: "bearish", label: "Bearish" },
  { value: "insufficient-data", label: "Insufficient data" },
];

export function SectorTable({ sectors, onSelect }: SectorTableProps) {
  const [search, setSearch] = useState("");
  const [regimeFilter, setRegimeFilter] = useState<Regime | "all">("all");
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtersActive = search !== "" || regimeFilter !== "all" || minScore !== 0;

  const filtered = useMemo(() => {
    return sectors.filter((s) => {
      if (search && !s.displayName.toLowerCase().includes(search.toLowerCase())) return false;
      if (regimeFilter !== "all" && s.regime.regime !== regimeFilter) return false;
      if (minScore > 0 && s.score.pointsEarned < minScore) return false;
      return true;
    });
  }, [sectors, search, regimeFilter, minScore]);

  const sorted = useMemo(() => {
    const col = COLUMNS.find((c) => c.key === sortKey);
    if (!col) return filtered;
    const withValues = filtered.map((s) => ({ s, v: col.accessor(s) }));
    withValues.sort((a, b) => {
      if (a.v === null && b.v === null) return 0;
      if (a.v === null) return 1; // unavailable sorts last regardless of direction
      if (b.v === null) return -1;
      if (typeof a.v === "string" || typeof b.v === "string") {
        return String(a.v).localeCompare(String(b.v)) * (sortDir === "asc" ? 1 : -1);
      }
      return ((a.v as number) - (b.v as number)) * (sortDir === "asc" ? 1 : -1);
    });
    return withValues.map((w) => w.s);
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: string) {
    if (key === "rank") return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function resetFilters() {
    setSearch("");
    setRegimeFilter("all");
    setMinScore(0);
  }

  return (
    <section className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sectors…"
          aria-label="Search sectors"
          style={{
            padding: "7px 10px",
            borderRadius: 8,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
            minWidth: 160,
          }}
        />
        <select
          value={regimeFilter}
          onChange={(e) => setRegimeFilter(e.target.value as Regime | "all")}
          aria-label="Filter by classification"
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
        >
          {REGIME_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Min score
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            aria-label="Filter by minimum score"
            style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)" }}
          >
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any" : `${n}+`}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn" onClick={resetFilters} disabled={!filtersActive}>
          Reset filters
        </button>
        <span className="text-faint" style={{ fontSize: 12, marginLeft: "auto" }}>
          {sorted.length} of {sectors.length} sectors
        </span>
      </div>

      <div className="scroll-x">
        <table aria-label="Sector ranking table">
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{
                    textAlign: col.align === "left" ? "left" : "right",
                    padding: "8px 10px",
                    fontSize: 12,
                    color: "var(--color-text-muted)",
                    whiteSpace: "nowrap",
                    cursor: col.key === "rank" ? "default" : "pointer",
                  }}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        font: "inherit",
                        color: "inherit",
                        cursor: col.key === "rank" ? "default" : "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                      disabled={col.key === "rank"}
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
            {sorted.map((s, i) => (
              <tr
                key={s.slug}
                onClick={() => onSelect(s.slug)}
                tabIndex={0}
                role="button"
                aria-label={`View details for ${s.displayName}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(s.slug);
                }}
                style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                className="sector-row"
              >
                {COLUMNS.map((col) => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align === "left" ? "left" : "right", padding: "9px 10px", fontSize: 13 }}
                  >
                    {col.render(s, i + 1)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 24, textAlign: "center" }} className="text-muted">
                  No sectors match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
