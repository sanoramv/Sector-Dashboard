/**
 * Ledger constants fixed by docs/design/MOMENTUM_LEDGER_DESIGN.md (Revision 4).
 * Nothing here is tuned; every value is quoted from the design.
 */
import { BENCHMARK, SECTOR_UNIVERSE } from "../../src/config/sectorUniverse.ts";
import { MARKET_CONTEXT_INDICES } from "../../src/config/marketIndices.ts";

export const LEDGER_SCHEMA_VERSION = 1;
export const DAILY_KIND = "momentum-ledger.daily";
export const RECEIPT_KIND = "momentum-ledger.receipt";
export const STATE_KIND = "momentum-ledger.state";
export const SOURCE_LIVE = "live-capture";
/** Manually bumped integer in `mv<N>-<hash>`. */
export const RULE_VERSION_COUNTER = 1;
export const TOKENIZER_ID = "token-v1";
export const DIGEST_ID = "digest-v1";

/** D1 pool sizes. */
export const POOL = { gainers: 50, losers: 50, volume: 50 } as const;

/** Non-exported literals of the momentum path, recorded verbatim (design §4.2). A parity test compares them with the source. */
export const LITERAL_CONSTANTS = {
  MIN_PEERS: 3,
  TRADING_DAYS_PER_YEAR: 252,
  MIN_CALENDAR_DAYS_FOR_52W: 350,
  SPARSE_WINDOW_FACTOR: 0.7,
  POOL_SIZES: { gainers: 50, losers: 50, volume: 50 },
  DEFAULT_TOP_N: 20,
} as const;

/** The 11 settings leaves the momentum path reads (verified with a recording Proxy; design §4.1). */
export const SETTINGS_READ_BY_MOMENTUM = [
  "regime.breadthThresholdPct",
  "regime.minBreadthMeasuresRequired",
  "screening.consolidationBaselineSessions",
  "screening.consolidationContractionRatio",
  "screening.consolidationLookbackSessions",
  "screening.resistanceLookbackSessions",
  "screening.resistanceProximityPct",
  "screening.triangleFlatSlopePctPerSession",
  "screening.triangleLookbackSessions",
  "screening.triangleMinPivots",
  "screening.trianglePivotSpacing",
] as const;

/** Readiness thresholds (design §10). */
export const READINESS = {
  R3: { minVolumeCoverage: 0.99 },
  R4: { fraction: 0.9, baselineSessions: 20 },
  R5: { tolerancePct: 5, nominal: { nifty500: 500, microcap250: 250, midcap150: 150, smallcap250: 250 } as Record<string, number> },
  R9: { margin: 1, baselineSessions: 20 },
  R10: { windowCalendarDays: 365, checkedSessions: 10 },
  R11: { warnCount: 3, sameRatioCount: 3, ratioDecimals: 2 },
} as const;

/** The 20 tracked index series (design R2): NIFTY 500, NIFTY 50, 15 sectoral indices, Midcap 150, Smallcap 250, Microcap 250. */
export const EXPECTED_INDEX_SLUGS: string[] = [
  BENCHMARK.slug,
  ...MARKET_CONTEXT_INDICES.map((i) => i.slug),
  ...SECTOR_UNIVERSE.map((s) => s.slug),
  "midcap150",
  "smallcap250",
  "microcap250",
].sort();

/** Lists that define the discovery universe (NIFTY 500 + Microcap 250) and the size segments. */
export const UNIVERSE_LIST_SLUGS = ["nifty500", "microcap250"] as const;
export const SEGMENT_LIST_SLUGS = ["midcap150", "smallcap250"] as const;

/** Publication cut-off: 09:00 IST (start of NSE pre-open) of the next NSE trading session. IST = UTC+05:30. */
export const CUTOFF_IST = { hour: 9, minute: 0 } as const;
export const IST_OFFSET_MINUTES = 330;
/** `unverified` dates are re-examined for this many days. */
export const UNVERIFIED_RETRY_DAYS = 14;

/** Directory layout under the ledger root (default public/data/ledger). */
export const DEFAULT_LEDGER_ROOT = "public/data/ledger";
export const ledgerPaths = (root = DEFAULT_LEDGER_ROOT) => ({
  root,
  predictionsDir: (ruleVersion: string) => `${root}/live/predictions/${ruleVersion}`,
  dailyFile: (ruleVersion: string, date: string) => `${root}/live/predictions/${ruleVersion}/${date}.json`,
  receiptFile: (date: string) => `${root}/live/receipts/${date}.json`,
  correctionFile: (ruleVersion: string, date: string, n: number) => `${root}/live/corrections/${ruleVersion}/${date}.v${n}.json`,
  state: `${root}/ledger-state.json`,
  holdout: `${root}/holdout.json`,
  protocolOd1: `${root}/protocol/od1.json`,
  versionRecord: (ruleVersion: string) => `${root}/protocol/versions/${ruleVersion}.json`,
  versionsDir: `${root}/protocol/versions`,
  calendarOverride: (date: string) => `${root}/protocol/calendar/${date}.json`,
  calendarDir: `${root}/protocol/calendar`,
  exemption: (sha: string) => `${root}/exemptions/${sha}.json`,
});
