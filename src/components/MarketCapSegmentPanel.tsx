import type { MarketCapSegmentMetrics } from "../types/marketCapSegment";
import { formatDateHuman, formatMaybePct, formatMaybePp, signClass } from "../lib/format";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";
import { RegimeBadge } from "./RegimeBadge";

function ReturnCell({ label, glossaryKey, value }: { label: string; glossaryKey: string; value: Parameters<typeof formatMaybePct>[0] }) {
  return (
    <div>
      <div className="text-faint" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
        {label}
        <MetricHelp content={METRIC_GLOSSARY[glossaryKey]} />
      </div>
      <div className={`num ${signClass(value)}`} style={{ fontSize: 14, fontWeight: 700 }}>
        {formatMaybePct(value)}
      </div>
    </div>
  );
}

function BreadthCell({ label, glossaryKey, pct, eligible, total }: { label: string; glossaryKey: string; pct: Parameters<typeof formatMaybePct>[0]; eligible: number; total: number }) {
  return (
    <div>
      <div className="text-faint" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
        {label}
        <MetricHelp content={METRIC_GLOSSARY[glossaryKey]} />
      </div>
      <div className="num" style={{ fontSize: 14, fontWeight: 700 }}>
        {formatMaybePct(pct, 1)}
      </div>
      <div className="text-faint" style={{ fontSize: 10.5 }}>
        {eligible}/{total} eligible
      </div>
    </div>
  );
}

function RsCell({ label, value }: { label: string; value: Parameters<typeof formatMaybePp>[0] }) {
  return (
    <div>
      <div className="text-faint" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div className={`num ${signClass(value)}`} style={{ fontSize: 13, fontWeight: 600 }}>
        {formatMaybePp(value)}
      </div>
    </div>
  );
}

export function MarketCapSegmentPanel({ segment }: { segment: MarketCapSegmentMetrics }) {
  const { metrics, coverage } = segment;
  const asOfDate = metrics.latestDate.available ? metrics.latestDate.value : null;
  const isUnavailable = metrics.dataQuality.status === "unavailable";

  return (
    <section className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ fontSize: 13.5, margin: 0, fontWeight: 700 }}>{segment.panelLabel}</h3>
          {segment.isSelfBenchmark ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span className="badge badge-sideways">Benchmark</span>
              <MetricHelp content={METRIC_GLOSSARY.marketCapSelfBenchmark} />
            </span>
          ) : (
            <RegimeBadge regime={metrics.regime.regime} />
          )}
        </div>
        <div className="text-faint" style={{ fontSize: 11, marginTop: 2 }}>
          as of {asOfDate ? formatDateHuman(asOfDate) : "N/A"}
          {metrics.currentClose.available && <> · close <span className="num">{metrics.currentClose.value.toFixed(2)}</span></>}
        </div>
      </div>

      {isUnavailable ? (
        <div className="card" style={{ padding: 10, background: "var(--color-bearish-bg)", fontSize: 12.5 }}>
          No valid data available for this segment right now.
          {metrics.dataQuality.missing.length > 0 && (
            <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
              {metrics.dataQuality.missing.slice(0, 3).map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(54px, 1fr))", gap: 8 }}>
            <ReturnCell label="1D" glossaryKey="return1d" value={metrics.returns.d1} />
            <ReturnCell label="1W" glossaryKey="return1w" value={metrics.returns.w1} />
            <ReturnCell label="1M" glossaryKey="return1m" value={metrics.returns.m1} />
            <ReturnCell label="3M" glossaryKey="return3m" value={metrics.returns.m3} />
            <ReturnCell label="6M" glossaryKey="return6m" value={metrics.returns.m6} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            <BreadthCell label="%>20D" glossaryKey="breadth20" pct={metrics.breadth.above20dma.pct} eligible={metrics.breadth.above20dma.eligible} total={metrics.breadth.above20dma.total} />
            <BreadthCell label="%>50D" glossaryKey="breadth50" pct={metrics.breadth.above50dma.pct} eligible={metrics.breadth.above50dma.eligible} total={metrics.breadth.above50dma.total} />
            <BreadthCell label="%>200D" glossaryKey="breadth200" pct={metrics.breadth.above200dma.pct} eligible={metrics.breadth.above200dma.eligible} total={metrics.breadth.above200dma.total} />
          </div>

          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 10 }}>
            {segment.isSelfBenchmark ? (
              <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>
                Relative performance isn't shown here - this panel IS the NIFTY 500 benchmark that every other panel
                is measured against.
              </p>
            ) : (
              <>
                <div className="text-faint" style={{ fontSize: 11, marginBottom: 6, display: "flex", alignItems: "center", gap: 4 }}>
                  Relative performance vs NIFTY 500
                  <MetricHelp content={METRIC_GLOSSARY.relativePerformance} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  <RsCell label="1W" value={metrics.relativeStrength.w1} />
                  <RsCell label="1M" value={metrics.relativeStrength.m1} />
                  <RsCell label="3M" value={metrics.relativeStrength.m3} />
                  <RsCell label="6M" value={metrics.relativeStrength.m6} />
                </div>
              </>
            )}
          </div>

          {!segment.isSelfBenchmark && (
            <p className="text-faint" style={{ fontSize: 11, margin: 0 }}>
              {metrics.regime.reasons[0]}
            </p>
          )}
        </>
      )}

      <div className="text-faint" style={{ fontSize: 10.5, borderTop: "1px solid var(--color-border)", paddingTop: 8, marginTop: "auto" }}>
        <div>
          {coverage.symbolsWithHistory} of {coverage.totalConstituents} constituents have price history
          {coverage.missingHistoryCount > 0 && <> ({coverage.missingHistoryCount} missing)</>}.
        </div>
        <div style={{ marginTop: 4 }}>{segment.overlapNote}</div>
      </div>
    </section>
  );
}
