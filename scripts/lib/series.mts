import { readFile } from "node:fs/promises";
import type { SectorConstituents } from "../../src/types/market.ts";

// "EQ" covers ordinary equity shares; "RR" covers REITs/InvITs (e.g. BAGMANE,
// BIRET, EMBASSY), which are legitimate index constituents but trade under a
// different NSE series code, not "EQ". "BE"/"BZ" are NSE's trade-for-trade
// series: a stock placed under surveillance moves from EQ to BE/BZ and keeps
// trading there. The 2026-10 audit found NIFTY 500 constituents (HFCL,
// MTARTECH, STLTECH, SCHNEIDER) trading normally - verified against an
// independent source - while their EQ rows stopped, which an EQ/RR-only
// filter silently turned into stale or gappy series. A stock is only ever in
// one of these series on a given day, so no date gets two rows.
export const TRACKED_SERIES = new Set(["EQ", "RR", "BE", "BZ"]);

/**
 * Columns extracted from each bhavcopy row, part of the refresh-state hash:
 * adding trading activity (volume, turnover, delivery %) for the Next-Day
 * Momentum page re-extracts older dates once, from the same official files.
 */
export const STOCK_EXTRACT_FIELDS = "ohlc+activity-v1";

/** Every symbol in any tracked constituent list (sectors, NIFTY 500, market-cap segments). */
export async function loadRequiredSymbols(constituentsPath: string): Promise<Set<string>> {
  const constituents: Record<string, SectorConstituents> = JSON.parse(await readFile(constituentsPath, "utf-8"));
  const symbols = new Set<string>();
  for (const sector of Object.values(constituents)) {
    for (const c of sector.constituents) symbols.add(c.symbol);
  }
  return symbols;
}
