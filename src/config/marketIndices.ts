/**
 * Broad-market indices tracked for market context only (not sectors, not
 * market-cap panels). "Index Name" strings verified against NSE's
 * ind_close_all_27102026.csv on 2026-10-28.
 */
export interface MarketIndexDefinition {
  slug: string;
  displayName: string;
  nseIndexName: string;
}

export const MARKET_CONTEXT_INDICES: MarketIndexDefinition[] = [{ slug: "nifty50", displayName: "NIFTY 50", nseIndexName: "Nifty 50" }];
