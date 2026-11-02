/** Effective configuration recorded in every daily header: actual values, never a hash alone (design §4). */
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/types/config.ts";
import { MOMENTUM_RULES } from "../../src/lib/momentum/classify.ts";
import { ASSESSMENT_RULES } from "../../src/lib/momentum/assess.ts";
import { FEATURE_RULES } from "../../src/lib/momentum/features.ts";
import { PRICE_BREAK_RATIO, STALE_AFTER_CALENDAR_DAYS, UNVERIFIED_DISCONTINUITY_RATIO } from "../../src/lib/calculations/validation.ts";
import { SESSION_LOOKBACK } from "../../src/lib/calculations/returns.ts";
import { TRIANGLE_MAX_PIVOT_DEVIATION_PCT, TRIANGLE_MIN_CONFIRMING_PIVOTS } from "../../src/lib/calculations/patterns.ts";
import { LITERAL_CONSTANTS, POOL, READINESS, SETTINGS_READ_BY_MOMENTUM } from "./constants.mts";

export interface EffectiveConfig {
  settings: AppSettings;
  settingsReadByMomentum: string[];
  rules: { MOMENTUM_RULES: unknown; ASSESSMENT_RULES: unknown; FEATURE_RULES: unknown };
  calcConstants: Record<string, unknown>;
  literalConstants: Record<string, unknown>;
  pool: { gainers: number; losers: number; volume: number };
  readiness: Record<string, unknown>;
}

/** A deep copy of the defaults: the ledger never sees a user's browser Settings, and cannot mutate the shared object. */
export function cloneDefaultSettings(): AppSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function buildEffectiveConfig(settings: AppSettings = cloneDefaultSettings()): EffectiveConfig {
  return {
    settings,
    settingsReadByMomentum: [...SETTINGS_READ_BY_MOMENTUM],
    rules: { MOMENTUM_RULES: structuredClone(MOMENTUM_RULES), ASSESSMENT_RULES: structuredClone(ASSESSMENT_RULES), FEATURE_RULES: structuredClone(FEATURE_RULES) },
    calcConstants: {
      PRICE_BREAK_RATIO,
      UNVERIFIED_DISCONTINUITY_RATIO,
      STALE_AFTER_CALENDAR_DAYS,
      SESSION_LOOKBACK: { ...SESSION_LOOKBACK },
      TRIANGLE_MIN_CONFIRMING_PIVOTS,
      TRIANGLE_MAX_PIVOT_DEVIATION_PCT,
    },
    literalConstants: structuredClone(LITERAL_CONSTANTS) as unknown as Record<string, unknown>,
    pool: { ...POOL },
    readiness: {
      R4: { ...READINESS.R4 },
      R5: { tolerancePct: READINESS.R5.tolerancePct, nominal: { ...READINESS.R5.nominal } },
      R9: { ...READINESS.R9 },
      R11: { ...READINESS.R11 },
    },
  };
}

/** Wraps `target` in a Proxy that records every leaf path read; the wrapped object still returns the real values. */
export function auditedSettings<T extends object>(target: T): { settings: T; reads: Set<string> } {
  const reads = new Set<string>();
  const wrap = (o: object, prefix: string): object =>
    new Proxy(o, {
      get(t, k, r) {
        const v = Reflect.get(t, k, r);
        if (typeof k !== "string") return v;
        const p = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === "object") return wrap(v as object, p);
        reads.add(p);
        return v;
      },
    });
  return { settings: wrap(target, "") as T, reads };
}

/** Configuration that participates in the rule-version hash: everything effective, excluding run-specific fields. */
export const configForHash = (c: EffectiveConfig) => ({
  settings: c.settings,
  rules: c.rules,
  calcConstants: c.calcConstants,
  literalConstants: c.literalConstants,
  pool: c.pool,
  readiness: c.readiness,
});
