import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { buildEffectiveConfig, cloneDefaultSettings, configForHash, auditedSettings } from "../../scripts/ledger/config.mts";
import { LITERAL_CONSTANTS, SETTINGS_READ_BY_MOMENTUM } from "../../scripts/ledger/constants.mts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";

describe("effective configuration", () => {
  it("is a deep copy: mutating it never touches the shared defaults", () => {
    const c = buildEffectiveConfig();
    c.settings.regime.breadthThresholdPct = 999;
    expect(DEFAULT_SETTINGS.regime.breadthThresholdPct).not.toBe(999);
    expect(cloneDefaultSettings()).toEqual(DEFAULT_SETTINGS);
  });
  it("never reads browser/user settings", async () => {
    const src = await readFile("scripts/ledger/config.mts", "utf-8");
    expect(src).not.toMatch(/localStorage|sessionStorage|window\./);
  });
  it("every audited settings leaf changes the recorded configuration hash", () => {
    const base = sha256Canonical(configForHash(buildEffectiveConfig()));
    for (const leaf of SETTINGS_READ_BY_MOMENTUM) {
      const c = buildEffectiveConfig();
      const parts = leaf.split(".");
      let o: any = c.settings;
      for (const p of parts.slice(0, -1)) o = o[p];
      const key = parts[parts.length - 1];
      o[key] = typeof o[key] === "number" ? o[key] + 1 : `${o[key]}x`;
      expect(sha256Canonical(configForHash(c)), leaf).not.toBe(base);
    }
  });
  it("records the literal constants with their approved values", () => {
    expect(buildEffectiveConfig().literalConstants).toEqual(LITERAL_CONSTANTS);
    expect(LITERAL_CONSTANTS.POOL_SIZES).toEqual({ gainers: 50, losers: 50, volume: 50 });
  });
  it("the declared settings-read list has 11 leaves, all existing in the defaults", () => {
    expect(SETTINGS_READ_BY_MOMENTUM).toHaveLength(11);
    const { settings, reads } = auditedSettings(cloneDefaultSettings());
    for (const leaf of SETTINGS_READ_BY_MOMENTUM) leaf.split(".").reduce((o: any, k) => o[k], settings);
    expect([...reads].sort()).toEqual([...SETTINGS_READ_BY_MOMENTUM].sort());
  });
  it("literal constants stay in parity with the source files", async () => {
    const d = await readFile("src/lib/momentum/discovery.ts", "utf-8");
    const h = await readFile("src/lib/calculations/distanceFromHigh.ts", "utf-8");
    expect(d).toMatch(new RegExp(`const MIN_PEERS = ${LITERAL_CONSTANTS.MIN_PEERS};`));
    expect(h).toMatch(new RegExp(`const TRADING_DAYS_PER_YEAR = ${LITERAL_CONSTANTS.TRADING_DAYS_PER_YEAR};`));
    expect(h).toMatch(new RegExp(`const MIN_CALENDAR_DAYS_FOR_52W = ${LITERAL_CONSTANTS.MIN_CALENDAR_DAYS_FOR_52W};`));
    expect(h).toMatch(new RegExp(`TRADING_DAYS_PER_YEAR \\* ${LITERAL_CONSTANTS.SPARSE_WINDOW_FACTOR}`));
  });
});
