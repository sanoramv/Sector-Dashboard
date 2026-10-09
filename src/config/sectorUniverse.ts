/**
 * The NSE sector universe this dashboard tracks.
 *
 * This is the single source of truth for which indices exist in the app - both
 * the Node data-fetch scripts (scripts/*.mts) and the frontend import this file,
 * so adding/removing a sector never requires touching calculation or UI code.
 *
 * Verified against live NSE sources on 2026-10-09:
 * - `nseIndexName` must match the "Index Name" column exactly as published in
 *   NSE's daily all-indices closing archive (ind_close_all_DDMMYYYY.csv), served
 *   from https://nsearchives.nseindia.com/content/indices/.
 * - `constituentFile` must match the exact filename published under
 *   https://niftyindices.com/IndexConstituent/ (filenames are inconsistent -
 *   verified individually, not pattern-generated).
 *
 * Sectors NOT included here (NIFTY Capital Goods, NIFTY Power, NIFTY Construction,
 * NIFTY Insurance, NIFTY Telecommunications) exist as indices but are not part of
 * NSE's daily all-indices closing archive, and niftyindices.com's historical-data
 * API (Backpage.aspx/getHistoricaldatatabletoString) rejected server-side requests
 * in testing. Rather than fabricate data for them, they are tracked in
 * UNAVAILABLE_SECTORS below so the app can disclose them honestly. See README.md
 * "Data sources and limitations" for details and how to add a working source.
 */

export interface SectorDefinition {
  /** Stable identifier used in URLs, cache keys and file names. */
  slug: string;
  /** Short label shown in the UI. */
  displayName: string;
  /** Exact "Index Name" string as it appears in NSE's ind_close_all archive. */
  nseIndexName: string;
  /** Exact filename under https://niftyindices.com/IndexConstituent/ */
  constituentFile: string;
  /**
   * When true, this sector is excluded from the Market Overview's headline
   * bullish/sideways/bearish counts because its constituents substantially
   * overlap another sector already counted (avoids double-counting breadth
   * and regime signals derived from the same underlying stocks). It still
   * appears in the full ranking table.
   */
  excludeFromHeadlineCount?: boolean;
  /** Human-readable reason for excludeFromHeadlineCount, shown as a footnote. */
  overlapNote?: string;
}

export const BENCHMARK: SectorDefinition = {
  slug: "nifty500",
  displayName: "NIFTY 500 (Broad Market)",
  nseIndexName: "Nifty 500",
  constituentFile: "ind_nifty500list.csv",
};

export const SECTOR_UNIVERSE: SectorDefinition[] = [
  { slug: "auto", displayName: "NIFTY Auto", nseIndexName: "Nifty Auto", constituentFile: "ind_niftyautolist.csv" },
  {
    slug: "bank",
    displayName: "NIFTY Bank",
    nseIndexName: "Nifty Bank",
    constituentFile: "ind_niftybanklist.csv",
    excludeFromHeadlineCount: true,
    overlapNote: "Constituents overlap substantially with NIFTY Financial Services; excluded from headline counts to avoid double-counting.",
  },
  {
    slug: "financial-services",
    displayName: "NIFTY Financial Services",
    nseIndexName: "Nifty Financial Services",
    constituentFile: "ind_niftyfinancelist.csv",
  },
  {
    slug: "fmcg",
    displayName: "NIFTY FMCG",
    nseIndexName: "Nifty FMCG",
    constituentFile: "ind_niftyfmcglist.csv",
  },
  {
    slug: "healthcare",
    displayName: "NIFTY Healthcare",
    nseIndexName: "Nifty Healthcare Index",
    constituentFile: "ind_niftyhealthcarelist.csv",
    excludeFromHeadlineCount: true,
    overlapNote: "Constituents overlap substantially with NIFTY Pharma; excluded from headline counts to avoid double-counting.",
  },
  { slug: "it", displayName: "NIFTY IT", nseIndexName: "Nifty IT", constituentFile: "ind_niftyitlist.csv" },
  { slug: "metal", displayName: "NIFTY Metal", nseIndexName: "Nifty Metal", constituentFile: "ind_niftymetallist.csv" },
  {
    slug: "oil-gas",
    displayName: "NIFTY Oil & Gas",
    nseIndexName: "Nifty Oil & Gas",
    constituentFile: "ind_niftyoilgaslist.csv",
  },
  { slug: "pharma", displayName: "NIFTY Pharma", nseIndexName: "Nifty Pharma", constituentFile: "ind_niftypharmalist.csv" },
  { slug: "realty", displayName: "NIFTY Realty", nseIndexName: "Nifty Realty", constituentFile: "ind_niftyrealtylist.csv" },
  {
    slug: "psu-bank",
    displayName: "NIFTY PSU Bank",
    nseIndexName: "Nifty PSU Bank",
    constituentFile: "ind_niftypsubanklist.csv",
    excludeFromHeadlineCount: true,
    overlapNote: "Constituents overlap substantially with NIFTY Bank and NIFTY Financial Services; excluded from headline counts to avoid double-counting.",
  },
  {
    slug: "private-bank",
    displayName: "NIFTY Private Bank",
    nseIndexName: "Nifty Private Bank",
    constituentFile: "ind_nifty_privatebanklist.csv",
    excludeFromHeadlineCount: true,
    overlapNote: "Constituents overlap substantially with NIFTY Bank and NIFTY Financial Services; excluded from headline counts to avoid double-counting.",
  },
  {
    slug: "consumer-durables",
    displayName: "NIFTY Consumer Durables",
    nseIndexName: "Nifty Consumer Durables",
    constituentFile: "ind_niftyconsumerdurableslist.csv",
  },
  { slug: "media", displayName: "NIFTY Media", nseIndexName: "Nifty Media", constituentFile: "ind_niftymedialist.csv" },
  {
    slug: "chemicals",
    displayName: "NIFTY Chemicals",
    nseIndexName: "Nifty Chemicals",
    constituentFile: "ind_niftyChemicals_list.csv",
  },
];

export interface UnavailableSector {
  slug: string;
  displayName: string;
  reason: string;
}

/** Sectors named in the product brief that are intentionally NOT shown with data. */
export const UNAVAILABLE_SECTORS: UnavailableSector[] = [
  { slug: "capital-goods", displayName: "NIFTY Capital Goods", reason: "Not published in NSE's daily all-indices closing archive; no verified browser/server-accessible historical data source yet." },
  { slug: "power", displayName: "NIFTY Power", reason: "Not published in NSE's daily all-indices closing archive; no verified browser/server-accessible historical data source yet." },
  { slug: "construction", displayName: "NIFTY Construction", reason: "Not published in NSE's daily all-indices closing archive; no verified browser/server-accessible historical data source yet." },
  { slug: "insurance", displayName: "NIFTY Insurance", reason: "Not published in NSE's daily all-indices closing archive; no verified browser/server-accessible historical data source yet." },
  { slug: "telecom", displayName: "NIFTY Telecommunications", reason: "Not published in NSE's daily all-indices closing archive; no verified browser/server-accessible historical data source yet." },
];

export function findSectorBySlug(slug: string): SectorDefinition | undefined {
  return SECTOR_UNIVERSE.find((s) => s.slug === slug);
}
