import { useMemo, useState } from "react";
import type { IndustryMetrics } from "../types/industry";
import { formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { RegimeBadge } from "./RegimeBadge";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

type SortDir = "asc" | "desc";

interface ColumnDef {
  key: string;
  label: string;
  helpKey?: string;
  accessor: (s: IndustryMetrics) => number | null;
  render: (s: IndustryMetrics, rank: number) => React.ReactNode;
  align?: "left" | "right";
}

const COLUMNS: ColumnDef[] = [
  { key: "rank", label: "#", accessor: () => null, render: (_s, rank) => rank },
  {
    key: "name",
    label: "Industry",
    accessor: (s) => s.name as unknown as number,
    render: (s) => <span style={{ fontWeight: 600 }}>{s.name}</span>,
    align: "left",
  },
  {
    key: "count",
    label: "Stocks",
    accessor: (s) => s.stockCount,
    render: (s) => <span className="num">{s.stockCount}</span>,
  },
  {
    key: "m1",
    label: "Avg 1M",
    helpKey: "return1m",
    accessor: (s) => (s.returns.m1.available ? s.returns.m1.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.m1)}`}>{formatMaybePct(s.returns.m1)}</span>,
  },
  {
    key: "m3",
    label: "Avg 3M",
    helpKey: "return3m",
    accessor: (s) => (s.returns.m3.available ? s.returns.m3.value : null),
    render: (s) => <span className={`num ${signClass(s.returns.m3)}`}>{formatMaybePct(s.returns.m3)}</span>,
  },
  {
    key: "m6",
    label: "Avg 6M",
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
    key: "dist52w",
    label: "Avg 52W Dist",
    helpKey: "distance52w",
    accessor: (s) => (s.distanceFrom52wHigh.available ? s.distanceFrom52wHigh.value : null),
    render: (s) => <span className={`num ${signClass(s.distanceFrom52wHigh)}`}>{formatMaybePct(s.distanceFrom52wHigh)}</span>,
  },
  {
    key: "rs3m",
    label: "Avg 3M RS",
    helpKey: "relativePerformance",
    accessor: (s) => (s.relativePerformance3m.available ? s.relativePerformance3m.value : null),
    render: (s) => <span className={`num ${signClass(s.relativePerformance3m)}`}>{formatMaybePp(s.relativePerformance3m)}</span>,
  },
  {
    key: "score",
    label: "Score",
    helpKey: "strengthScore",
    accessor: (s) => s.score.pointsEarned,
    render: (s) => (
      <span className="num">
        {s.score.pointsEarned}/{s.score.pointsPossible}
      </span>
    ),
  },
  {
    key: "regime",
    label: "Regime",
    helpKey: "regime",
    accessor: (s) => ({ bullish: 3, sideways: 2, bearish: 1, "insufficient-data": 0 })[s.regime.regime],
    render: (s) => <RegimeBadge regime={s.regime.regime} />,
  },
];

export interface IndustryTableProps {
  industries: IndustryMetrics[];
  onSelect: (slug: string) => void;
}

export function IndustryTable({ industries, onSelect }: IndustryTableProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("count");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const filtered = useMemo(
    () => industries.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())),
    [industries, search],
  );

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
    if (key === "rank") return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section className="card" style={{ padding: 16 }}>
      <p className="text-faint" style={{ fontSize: 12, marginTop: 0 }}>
        NSE does not publish a price index for most industry classifications, so the return/distance figures below
        are a computed <strong>equal-weighted average across each industry's own constituent stocks</strong> - a
        transparent derived aggregate, not an official NSE index value. Breadth uses the same real-constituent
        mechanism as the sector table. Industries with very few constituents are marked "Insufficient data" since an
        average over 1-2 stocks isn't a meaningful signal.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search industries…"
          aria-label="Search industries"
          style={{ padding: "7px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text)", minWidth: 180 }}
        />
        <span className="text-faint" style={{ fontSize: 12, marginLeft: "auto" }}>
          {sorted.length} of {industries.length} industries
        </span>
      </div>

      <div className="scroll-x">
        <table aria-label="Industry ranking table">
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
                  }}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      disabled={col.key === "rank"}
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
            {sorted.map((s, i) => (
              <tr
                key={s.slug}
                onClick={() => onSelect(s.slug)}
                tabIndex={0}
                role="button"
                aria-label={`View details for ${s.name}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(s.slug);
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
          </tbody>
        </table>
      </div>
    </section>
  );
}
