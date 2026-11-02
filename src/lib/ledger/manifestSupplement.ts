/**
 * Optional ledger summary that the capture job adds to `manifest.json -> supplements.ledger`.
 *
 * Declared here by module augmentation, NOT in src/types/dataset.ts: that file is one of the 22 rule files hashed into
 * the Momentum rule version, and the design forbids changing any file of the rule path in Phase A1.
 * Nothing in the application reads this field; it exists for operators and the watchdog.
 */
import type {} from "../../types/dataset";

export interface LedgerSupplement {
  status: "ok" | "idle" | "not-enabled" | "waiting" | "blocked" | "anomaly" | "error";
  lastSuccessfulSessionDate: string | null;
  lastAttemptAt: string | null;
  recoveryRequired: number;
  capturedSessions: number;
  liveReceipts: number;
  liveLateReceipts: number;
  updatedAt: string;
}

declare module "../../types/dataset" {
  interface SupplementStatus {
    ledger?: LedgerSupplement;
  }
}
