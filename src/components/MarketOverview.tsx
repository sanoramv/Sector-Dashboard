import type { MarketOverview as MarketOverviewData } from "../types/metrics";
import { formatMaybePct, signClass } from "../lib/format";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

function ReturnCell({ label, glossaryKey, value }: { label: string; glossaryKey: string; value: Parameters<typeof formatMaybePct>[0] }) {
  return (
    <div>
      <div className="text-faint" style={{ display: "flex", alignItems: "center", gap: 4 }}>
        {label}
        <MetricHelp content={METRIC_GLOSSARY[glossaryKey]} />
      </div>
      <div className={`num ${signClass(value)}`} style={{ fontSize: 15, fontWeight: 700 }}>
        {formatMaybePct(value)}
      </div>
    </div>
  );
}

export function MarketOverview({ overview }: { overview: MarketOverviewData }) {
  const total = overview.bullishCount + overview.sidewaysCount + overview.bearishCount + overview.insufficientDataCount;
  return (
    <section className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
        Market Overview
        <span className="text-faint" style={{ fontSize: 12, fontWeight: 400 }}>
          — {overview.benchmarkDisplayName}
        </span>
      </h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
          gap: 14,
          marginBottom: 16,
        }}
      >
        <ReturnCell label="1D" glossaryKey="return1d" value={overview.benchmarkReturns.d1} />
        <ReturnCell label="1W" glossaryKey="return1w" value={overview.benchmarkReturns.w1} />
        <ReturnCell label="1M" glossaryKey="return1m" value={overview.benchmarkReturns.m1} />
        <ReturnCell label="3M" glossaryKey="return3m" value={overview.benchmarkReturns.m3} />
        <ReturnCell label="6M" glossaryKey="return6m" value={overview.benchmarkReturns.m6} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 12,
        }}
      >
        <RegimeCountTile label="Bullish" count={overview.bullishCount} total={total} cls="badge-bullish" />
        <RegimeCountTile label="Sideways / Mixed" count={overview.sidewaysCount} total={total} cls="badge-sideways" />
        <RegimeCountTile label="Bearish" count={overview.bearishCount} total={total} cls="badge-bearish" />
        <RegimeCountTile label="Insufficient Data" count={overview.insufficientDataCount} total={total} cls="badge-insufficient" />
      </div>

      {overview.broadMarketBreadth && (
        <div style={{ marginTop: 16, display: "flex", gap: 24, flexWrap: "wrap" }}>
          <BreadthStat label="% Above 20DMA" glossaryKey="breadth20" value={overview.broadMarketBreadth.above20dma.pct} />
          <BreadthStat label="% Above 50DMA" glossaryKey="breadth50" value={overview.broadMarketBreadth.above50dma.pct} />
          <BreadthStat label="% Above 200DMA" glossaryKey="breadth200" value={overview.broadMarketBreadth.above200dma.pct} />
        </div>
      )}

      <p className="text-faint" style={{ fontSize: 11.5, marginTop: 14, marginBottom: 0 }}>
        Sectors with insufficient data are excluded from the bullish/sideways/bearish counts above. NIFTY Bank, PSU
        Bank, Private Bank and Healthcare are tracked individually in the table below but excluded from these
        headline counts because their constituents overlap substantially with NIFTY Financial Services and NIFTY
        Pharma respectively (to avoid double-counting the same underlying stocks).
      </p>
    </section>
  );
}

function RegimeCountTile({ label, count, total, cls }: { label: string; count: number; total: number; cls: string }) {
  return (
    <div className="card" style={{ padding: "10px 14px" }}>
      <div className="text-faint" style={{ fontSize: 11.5 }}>
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 800 }}>
          {count}
        </span>
        <span className="text-faint" style={{ fontSize: 11.5 }}>
          / {total}
        </span>
        <span className={`badge ${cls}`} style={{ marginLeft: "auto" }} aria-hidden="true">
          &nbsp;
        </span>
      </div>
    </div>
  );
}

function BreadthStat({ label, glossaryKey, value }: { label: string; glossaryKey: string; value: Parameters<typeof formatMaybePct>[0] }) {
  return (
    <div>
      <div className="text-faint" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11.5 }}>
        {label}
        <MetricHelp content={METRIC_GLOSSARY[glossaryKey]} />
      </div>
      <div className="num" style={{ fontSize: 15, fontWeight: 700 }}>
        {value.available ? `${value.value.toFixed(1)}%` : "N/A"}
      </div>
    </div>
  );
}
