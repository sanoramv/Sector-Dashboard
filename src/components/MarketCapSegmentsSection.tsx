import type { MarketCapSegmentMetrics } from "../types/marketCapSegment";
import { MarketCapSegmentPanel } from "./MarketCapSegmentPanel";
import { MetricHelp } from "./MetricHelp";
import { METRIC_GLOSSARY } from "../content/metricGlossary";

export function MarketCapSegmentsSection({ segments }: { segments: MarketCapSegmentMetrics[] }) {
  if (segments.length === 0) {
    return null;
  }

  return (
    <section style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 4px", display: "flex", alignItems: "center", gap: 6 }}>
        Market Capitalisation Segments
        <MetricHelp content={METRIC_GLOSSARY.marketCapSegment} />
      </h2>
      <p className="text-faint" style={{ fontSize: 11.5, margin: "0 0 10px" }}>
        Four official NSE benchmarks, each with its own index-level returns and real constituent-stock breadth.{" "}
        <strong>NIFTY Midcap 150 and NIFTY Smallcap 250 are both subsets of NIFTY 500</strong> (every one of their
        constituents is also a NIFTY 500 constituent) - do not add their counts to NIFTY 500's as if they were
        additional companies. <strong>NIFTY Microcap 250 is a separate universe with zero overlap</strong> with
        NIFTY 500 (verified). A benchmark can rise even while many of its own constituents sit below their moving
        averages - breadth and index-level return are reported separately and can disagree; neither is "more
        correct" than the other.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {segments.map((seg) => (
          <MarketCapSegmentPanel key={seg.slug} segment={seg} />
        ))}
      </div>
    </section>
  );
}
