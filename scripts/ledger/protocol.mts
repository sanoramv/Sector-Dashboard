/**
 * Frozen protocol (OD1) and the sealed holdout definition. These are governance records, not results: nothing here
 * computes an outcome. The definitions are copied from design §15 and hashed; any change changes the hash and is
 * detected by the guard and the governance tests.
 */
import { sha256Canonical } from "./canonical.mts";
import { LEDGER_SCHEMA_VERSION } from "./constants.mts";

export const OD1_DEFINITIONS = {
  id: "od1",
  horizons: { stored: [1, 2, 5, 10], headline: [1, 5], unit: "NIFTY 500 trading sessions after the prediction date" },
  sigma: {
    measure: "population standard deviation (divisor N)",
    window: 20,
    input: "daily simple percentage changes (close_i / close_{i-1} - 1) x 100",
    sessions: "the 20 sessions ending at t-1; day t excluded; comparable bars only",
    source: "volatility20, frozen in the prediction record",
    minComparableBars: 22,
    outcomeWindowVolatilityUsedForClassification: false,
  },
  epsilon: { formula: "max(k * sigma * sqrt(h), floorPct)", k: 0.5, floorPct: 0.2, floorIsIndependentOfCostAssumption: true },
  quantities: {
    R_h: "(C(t+h) / C(t) - 1) x 100",
    X_h: "R_h - (NIFTY500 close(t+h) / NIFTY500 close(t) - 1) x 100",
    "H*": "highest high over sessions t+1..t+h",
    "L*": "lowest low over sessions t+1..t+h",
    H_t: "high of the prediction day",
    L_t: "low of the prediction day",
  },
  gainers: {
    conditions: { P: "R_h >= +eps_h", E: "X_h > 0", N: "H* > H_t", D: "R_h <= -eps_h", B: "L* < L_t" },
    firstMatchWins: [
      { id: "inconclusive", rule: "window invalid" },
      { id: "reversal", rule: "D and B" },
      { id: "failed", rule: "D and not B" },
      { id: "confirmed", rule: "P and E and N" },
      { id: "partial", rule: "not D, and at least one of P, E, N but not all three" },
      { id: "sideways", rule: "none of the above" },
    ],
  },
  losers: {
    conditions: { P: "R_h <= -eps_h", E: "X_h < 0", N: "L* < L_t", D: "R_h >= +eps_h", B: "H* > H_t" },
    firstMatchWins: [
      { id: "inconclusive", rule: "window invalid" },
      { id: "reversal", rule: "D and B" },
      { id: "failed", rule: "D and not B" },
      { id: "confirmed", rule: "P and E and N" },
      { id: "partial", rule: "not D, and at least one of P, E, N but not all three" },
      { id: "sideways", rule: "none of the above" },
    ],
  },
  group: "sign of the day-t change; unchanged stocks are not in the pool",
  invalidWindow: ["sigma unavailable (insufficient-history)", "a bar missing in t+1..t+h (no-bar)", "any bar in t+1..t+h in a different comparable price segment than bar t (discontinuity); the raw unadjusted return is stored", "pending until the calendar has passed t+h and the archives are ok"],
  flags: { abnormalGap: "|O(t+1)/C(t) - 1| >= 3 sigma", volWindowOutlier: "max |daily change| in the sigma window >= 3.5 sigma" },
  separateFromClassification: ["tradable return C(t+h)/O(t+1) - 1 minus cost", "MFE/MAE", "industry-relative return"],
  headline: {
    measures: ["confirmedShare", "adverseShare"],
    adverse: ["failed", "reversal"],
    descriptive: ["partial", "sideways"],
    perHorizon: "each horizon on its own; 1-session and 5-session results are never combined",
    directions: "gainers and losers reported side by side; no pooled headline",
    denominator: {
      completedOutcomes: "stock-days whose outcome status for the horizon is complete (class in confirmed, partial, failed, reversal, sideways)",
      confirmedShare: "N_confirmed / N_complete",
      adverseShare: "(N_failed + N_reversal) / N_complete",
      unavailableAndPendingExcluded: true,
      reportedBesideEveryPercentage: ["numerator", "N_complete", "coverage", "N_unavailable", "N_pending"],
      coverage: "N_complete / (N_complete + N_unavailable)",
      identity: "N_stock_days = N_complete + N_unavailable + N_pending",
      uniqueStockDay: "one stock on several lists on one date is one stock-day; list memberships and ranks stay in the record",
    },
  },
  meaning: "A deterministic, versioned description of what a price did over 1 or 5 sessions after a classification date, measured against a volatility-scaled materiality band fixed from information available at the classification date. Confirmed is not a probability, a predictive confidence or a profitable trading signal.",
} as const;

/** Display names are outside the protocol hash: a label can change without touching any formula. */
export const OD1_LABELS = {
  inconclusive: "Inconclusive",
  reversal: "Reversal (losers: Rebound / reversal)",
  failed: "Failed continuation (losers: Failed downside continuation)",
  confirmed: "Confirmed continuation (losers: Confirmed downside continuation)",
  partial: "Partial continuation (losers: Partial downside continuation)",
  sideways: "Sideways",
} as const;

export const od1DefinitionsSha256 = (): string => sha256Canonical(OD1_DEFINITIONS);

export function buildOd1File() {
  return { kind: "momentum-ledger.protocol.od1", schemaVersion: LEDGER_SCHEMA_VERSION, definitions: OD1_DEFINITIONS, labels: OD1_LABELS, definitionsSha256: od1DefinitionsSha256() };
}

export interface HoldoutFile {
  kind: "momentum-ledger.holdout";
  schemaVersion: number;
  status: "sealed" | "unblinded";
  protocol: { id: string; file: string; definitionsSha256: string };
  gate: { minCompletedLiveSessions: number; completedLiveSession: string; note: string };
  startDate: string | null;
  unblinded: null | { authorisedBy: string; authorisedAt: string; completedLiveSessions: number; exemptionsCount: number };
  note: string;
}

export function buildHoldoutFile(): HoldoutFile {
  return {
    kind: "momentum-ledger.holdout",
    schemaVersion: LEDGER_SCHEMA_VERSION,
    status: "sealed",
    protocol: { id: "od1", file: "protocol/od1.json", definitionsSha256: od1DefinitionsSha256() },
    gate: {
      minCompletedLiveSessions: 250,
      completedLiveSession:
        "A live session (valid daily file with a receipt of class live) whose every prediction has OD1 outcomes for both h=1 and h=5 with status complete or unavailable (with a reason), none pending, and no anomaly flag. A missing or incomplete capture never counts.",
      note: "250 is a minimum review gate, not a guarantee of statistical significance. The system never unblinds on its own; unblinding needs the user's explicit authorisation.",
    },
    startDate: null,
    unblinded: null,
    note: "A governance control. The repository and market prices are public, so this seal does not make results unknowable; it prevents the system from computing or displaying live performance before authorisation.",
  };
}

/** The only permitted change to holdout.json: sealed -> unblinded with the protocol and gate unchanged and a complete authorisation record. */
export function checkHoldoutTransition(prev: HoldoutFile | null, next: HoldoutFile): string[] {
  if (prev === null) return next.status === "sealed" ? [] : ["holdout.json must be created sealed"];
  const problems: string[] = [];
  if (JSON.stringify(prev.protocol) !== JSON.stringify(next.protocol)) problems.push("holdout protocol reference changed");
  if (JSON.stringify(prev.gate) !== JSON.stringify(next.gate)) problems.push("holdout gate changed");
  if (prev.status === "unblinded") return JSON.stringify(prev) === JSON.stringify(next) ? [] : ["an unblinded holdout.json cannot change"];
  if (next.status === "sealed") return JSON.stringify(prev) === JSON.stringify(next) ? [] : [...problems, "a sealed holdout.json changed without unblinding"];
  const u = next.unblinded;
  if (!u || !u.authorisedBy || !u.authorisedAt || !(u.completedLiveSessions >= next.gate.minCompletedLiveSessions)) problems.push("unblinding requires an authorisation record and at least the gate's completed live sessions");
  return problems;
}

/** Verifies od1.json against the code constant and holdout.json against od1.json. */
export function checkProtocolIntegrity(od1: ReturnType<typeof buildOd1File> | null, holdout: HoldoutFile | null): string[] {
  const problems: string[] = [];
  if (!od1) return ["protocol/od1.json is missing"];
  if (od1.definitionsSha256 !== sha256Canonical(od1.definitions)) problems.push("od1.json definitionsSha256 does not match its definitions");
  if (od1.definitionsSha256 !== od1DefinitionsSha256()) problems.push("od1.json definitions differ from the frozen definitions in the code");
  if (!holdout) problems.push("holdout.json is missing");
  else if (holdout.protocol.definitionsSha256 !== od1.definitionsSha256) problems.push("holdout.json protocol hash does not match od1.json");
  return problems;
}
