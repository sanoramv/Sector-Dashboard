import { useMemo, useState } from "react";
import type { EvidenceCategory, MomentumCandidate, MomentumLabel } from "../types/momentum";
import { CATEGORY_TEXT } from "../lib/momentum/assess";
import { LABEL_DEFINITION, LABEL_TEXT } from "../lib/momentum/classify";
import { sortCandidates, type SortKey } from "../lib/momentum/filters";

export const LABEL_BADGE: Record<MomentumLabel, string> = {
  "momentum-continuation": "badge-bullish",
  "possible-breakout": "badge-bullish",
  "possible-reversal": "badge-sideways",
  "extended-reversal-risk": "badge-bearish",
  "weak-momentum": "badge-bearish",
  "mixed-signals": "badge-sideways",
  "insufficient-evidence": "badge-insufficient",
};

export const CATEGORY_BADGE: Record<EvidenceCategory, string> = {
  continuation: "badge-bullish",
  mixed: "badge-sideways",
  "exhaustion-reversal": "badge-bearish",
  insufficient: "badge-insufficient",
};

const fmtPct = (n: number | null, digits = 2) => (n === null ? "N/A" : `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`);
const signCls = (n: number | null) => (n === null ? "text-faint" : n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-muted");

interface Col {
  key: SortKey | "rank" | "label" | "category";
  label: string;
  title?: string;
  align?: "left";
  render: (c: MomentumCandidate) => React.ReactNode;
}

const COLUMNS: Col[] = [
  { key: "rank", label: "#", title: "Rank by daily % change on this list", render: (c) => c.rank },
  {
    key: "symbol",
    label: "Symbol",
    align: "left",
    render: (c) => (
      <div>
        <div style={{ fontWeight: 700 }}>{c.symbol}</div>
        <div className="text-faint" style={{ fontSize: 11, maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.companyName}>
          {c.companyName}
        </div>
        <div className="text-faint" style={{ fontSize: 10.5 }}>
          {c.industry}
          {c.segment ? ` · ${c.segment}` : ""}
        </div>
      </div>
    ),
  },
  { key: "change", label: "Change", title: "Previous close to close, %", render: (c) => <span className={`num ${signCls(c.price.dailyChangePct)}`}>{fmtPct(c.price.dailyChangePct)}</span> },
  {
    key: "closeLocation",
    label: "Close in range",
    title: "Where the close sat in the day's high-low range: 100% = at the high, 0% = at the low",
    render: (c) => <span className="num">{c.price.closeLocation === null ? "N/A" : `${Math.round(c.price.closeLocation * 100)}%`}</span>,
  },
  {
    key: "rvol",
    label: "Rel. volume",
    title: "Today's volume / average of the previous 20 sessions",
    render: (c) =>
      c.activity.relativeVolume.available ? (
        <span className="num">{c.activity.relativeVolume.value.toFixed(1)}x</span>
      ) : (
        <span className="text-faint" title={c.activity.relativeVolume.reason}>
          N/A
        </span>
      ),
  },
  {
    key: "turnover",
    label: "Turnover",
    title: "Traded value today, Rs crore",
    render: (c) => (
      <span className="num">
        {c.activity.turnoverCr === null ? "N/A" : `₹${c.activity.turnoverCr >= 100 ? c.activity.turnoverCr.toFixed(0) : c.activity.turnoverCr.toFixed(1)} cr`}
        {c.activity.liquidityWarnings.length > 0 && (
          <span className="badge badge-insufficient" style={{ fontSize: 9.5, marginLeft: 4 }} title={c.activity.liquidityWarnings.join(" ")}>
            {c.activity.tradeForTrade ? c.activity.series : "thin"}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "dist52w",
    label: "vs 52W high",
    render: (c) => (c.price.distanceFrom52wHigh.available ? <span className="num">{fmtPct(c.price.distanceFrom52wHigh.value, 1)}</span> : <span className="text-faint" title={c.price.distanceFrom52wHigh.reason}>N/A</span>),
  },
  {
    key: "resistance",
    label: "vs resistance",
    title: "Close vs the highest high of the prior 60 sessions. Positive = closed above it (breakout).",
    render: (c) => (c.patterns.resistance.available ? <span className={`num ${signCls(c.patterns.resistance.value.distancePct)}`}>{fmtPct(c.patterns.resistance.value.distancePct, 1)}</span> : <span className="text-faint">N/A</span>),
  },
  {
    key: "vsPeers",
    label: "vs industry",
    title: "Stock's change minus the median change of its NSE-industry peers in the universe",
    render: (c) => (
      <span className="num" title={c.context.peerMedianChangePct === null ? "too few peers" : `peer median ${fmtPct(c.context.peerMedianChangePct)} across ${c.context.peerCount} peers - ${c.context.moveScope}`}>
        {c.context.stockVsPeersPp === null ? "N/A" : `${c.context.stockVsPeersPp >= 0 ? "+" : ""}${c.context.stockVsPeersPp.toFixed(1)}pp`}
      </span>
    ),
  },
  {
    key: "category",
    label: "Evidence",
    align: "left",
    title: "Evidence category from per-dimension component scores (for losers: downside continuation vs rebound risk). Describes evidence, not an outcome.",
    render: (c) => (
      <span className={`badge ${CATEGORY_BADGE[c.assessment.category]}`} style={{ fontSize: 10.5, whiteSpace: "nowrap" }} title={c.assessment.rationale}>
        {CATEGORY_TEXT[c.group][c.assessment.category]}
      </span>
    ),
  },
  {
    key: "label",
    label: "Setup",
    align: "left",
    render: (c) => (
      <span className={`badge ${LABEL_BADGE[c.label]}`} style={{ fontSize: 10.5, whiteSpace: "nowrap" }} title={LABEL_DEFINITION[c.label]}>
        {LABEL_TEXT[c.label]}
      </span>
    ),
  },
  {
    key: "evidence",
    label: "Score",
    title: "Net component points toward continuation of today's direction (an evidence tally, not a probability).",
    render: (c) => (c.assessment.category === "insufficient" ? <span className="text-faint">—</span> : <span className="num">{c.assessment.total > 0 ? "+" : ""}{c.assessment.total}</span>),
  },
  {
    key: "continuation",
    label: "For / against",
    title: "Number of factors supporting continuation of today's direction / reversal. A count, not a probability.",
    render: (c) => (
      <span className="num" style={{ whiteSpace: "nowrap" }}>
        <span className="text-pos">{c.continuationFactors.length}</span> / <span className="text-neg">{c.reversalFactors.length}</span>
      </span>
    ),
  },
];

export interface MomentumTableProps {
  title: string;
  /** Default sort direction by change: gainers largest first, losers most negative first; "mixed" lists sort by relative volume. */
  group: "gainer" | "loser" | "mixed";
  description?: string;
  /** Overrides the initial sort (the user can still re-sort). */
  defaultSort?: { key: SortKey; dir: "asc" | "desc" };
  candidates: MomentumCandidate[];
  totalBeforeFilters: number;
  onSelect: (c: MomentumCandidate) => void;
}

export function MomentumTable({ title, group, description, defaultSort, candidates, totalBeforeFilters, onSelect }: MomentumTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>(defaultSort?.key ?? (group === "mixed" ? "rvol" : "change"));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSort?.dir ?? (group === "loser" ? "asc" : "desc"));
  const sorted = useMemo(() => sortCandidates(candidates, sortKey, sortDir), [candidates, sortKey, sortDir]);

  function toggle(key: Col["key"]) {
    if (key === "rank" || key === "label" || key === "category") return;
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  return (
    <section className="card" style={{ padding: 14, marginBottom: 16 }} aria-label={title}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>{title}</h2>
        <span className="text-faint" style={{ fontSize: 12 }}>
          {candidates.length} of {totalBeforeFilters} shown · "Score" and "For / against" are evidence tallies, not probabilities
        </span>
      </div>
      {description && (
        <p className="text-faint" style={{ fontSize: 11.5, margin: "0 0 8px" }}>
          {description}
        </p>
      )}
      <div className="scroll-x">
        <table aria-label={title}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  title={col.title}
                  style={{ textAlign: col.align ?? "right", padding: "7px 8px", fontSize: 11.5, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}
                  aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button
                    type="button"
                    onClick={() => toggle(col.key)}
                    disabled={col.key === "rank" || col.key === "label" || col.key === "category"}
                    style={{ background: "none", border: "none", padding: 0, font: "inherit", color: "inherit", cursor: col.key === "rank" || col.key === "label" || col.key === "category" ? "default" : "pointer" }}
                  >
                    {col.label}
                    {sortKey === col.key && <span aria-hidden="true">{sortDir === "asc" ? " ↑" : " ↓"}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => (
              <tr
                key={c.symbol}
                onClick={() => onSelect(c)}
                tabIndex={0}
                role="button"
                aria-label={`View research details for ${c.symbol}`}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect(c);
                }}
                style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
              >
                {COLUMNS.map((col) => (
                  <td key={col.key} style={{ textAlign: col.align ?? "right", padding: "8px 8px", fontSize: 12.5, verticalAlign: "top" }}>
                    {col.render(c)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length} style={{ padding: 20, textAlign: "center" }} className="text-muted">
                  No stocks on this list match the current filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
