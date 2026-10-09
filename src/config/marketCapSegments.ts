import { BENCHMARK } from "./sectorUniverse";

/**
 * Official NSE market-capitalisation segment benchmarks shown as the four
 * homepage overview panels. Verified against live NSE sources on 2026-10-10:
 * - `nseIndexName` matches the "Index Name" column exactly as published in
 *   NSE's daily all-indices closing archive (ind_close_all_DDMMYYYY.csv).
 * - `constituentFile` matches the exact filename published under
 *   https://niftyindices.com/IndexConstituent/ (verified individually -
 *   niftyindices.com's filenames are inconsistent, not pattern-generated;
 *   NIFTY Microcap 250's is notably `ind_niftymicrocap250_list.csv`, with an
 *   underscore before "list" unlike every other index on the site).
 *
 * Verified constituent-universe relationships (by actually diffing symbol
 * lists, not assumed from index names):
 * - NIFTY Midcap 150: all 150 constituents are also NIFTY 500 constituents
 *   (ranks roughly 101-250 by market cap within the NIFTY 500 universe).
 * - NIFTY Smallcap 250: all 251 constituents (as of this writing) are also
 *   NIFTY 500 constituents (ranks roughly 251-500).
 * - NIFTY Microcap 250: ZERO overlap with NIFTY 500 - a fully distinct
 *   universe of the next ~250 companies by market cap beyond the NIFTY 500
 *   cutoff. This dashboard never restricts its screening/breadth universe to
 *   NIFTY 500 for this segment; it fetches and tracks these symbols
 *   separately. Midcap150/Smallcap250/Smallcap/microcap pairwise overlap
 *   with each other is also zero (NSE's size-based indices partition the
 *   market by rank, they don't overlap one another).
 */

export interface MarketCapSegmentDefinition {
  slug: string;
  /** Label for the homepage overview panel, e.g. "NIFTY Midcap 150 — Midcaps". */
  panelLabel: string;
  /** Exact "Index Name" string as it appears in NSE's ind_close_all archive. */
  nseIndexName: string;
  /** Exact filename under https://niftyindices.com/IndexConstituent/ */
  constituentFile: string;
  /** True only for the NIFTY 500 segment itself - used to skip the self-referential "relative performance vs NIFTY 500" calculation and regime condition. */
  isSelfBenchmark: boolean;
  /** Human-readable disclosure of this segment's constituent-universe relationship to NIFTY 500, shown in the panel and Help. */
  overlapNote: string;
}

export const MARKET_CAP_SEGMENTS: MarketCapSegmentDefinition[] = [
  {
    slug: BENCHMARK.slug,
    panelLabel: "NIFTY 500 — Broad Market",
    nseIndexName: BENCHMARK.nseIndexName,
    constituentFile: BENCHMARK.constituentFile,
    isSelfBenchmark: true,
    overlapNote: "The broad-market benchmark itself - every other panel is measured relative to this one.",
  },
  {
    slug: "midcap150",
    panelLabel: "NIFTY Midcap 150 — Midcaps",
    nseIndexName: "Nifty Midcap 150",
    constituentFile: "ind_niftymidcap150list.csv",
    isSelfBenchmark: false,
    overlapNote: "All 150 constituents are also NIFTY 500 constituents (verified) - this segment is a strict subset of the broad market, not an additional universe.",
  },
  {
    slug: "smallcap250",
    panelLabel: "NIFTY Smallcap 250 — Smallcaps",
    nseIndexName: "Nifty Smallcap 250",
    constituentFile: "ind_niftysmallcap250list.csv",
    isSelfBenchmark: false,
    overlapNote: "All constituents are also NIFTY 500 constituents (verified) - this segment is a strict subset of the broad market, not an additional universe.",
  },
  {
    slug: "microcap250",
    panelLabel: "NIFTY Microcap 250 — Microcaps",
    nseIndexName: "Nifty Microcap 250",
    constituentFile: "ind_niftymicrocap250_list.csv",
    isSelfBenchmark: false,
    overlapNote: "Verified ZERO overlap with NIFTY 500 - a fully distinct universe of companies ranked just beyond the NIFTY 500 cutoff. Counting this segment's constituents together with the other three panels' would double-count nothing, but would also not represent 'all NSE-listed companies' - smaller/unlisted-adjacent companies exist beyond even this universe.",
  },
];

export function findMarketCapSegmentBySlug(slug: string): MarketCapSegmentDefinition | undefined {
  return MARKET_CAP_SEGMENTS.find((s) => s.slug === slug);
}
