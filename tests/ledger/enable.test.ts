import { describe, expect, it } from "vitest";
import { checkEnableDate, expectedEnableDate, type EnableInputs } from "../../scripts/ledger/enable.mts";

const base: EnableInputs = { latestMarketDate: "2026-10-29", statuses: {} };

describe("ledger:enable accepts only the next eligible session", () => {
  it("accepts the next session after the latest published date", () => {
    expect(checkEnableDate("2026-10-30", base)).toEqual({ ok: true, expected: "2026-10-30" });
    expect(checkEnableDate("2026-11-02", { ...base, latestMarketDate: "2026-10-30" })).toEqual({ ok: true, expected: "2026-11-02" }); // Friday -> Monday
  });
  it("accepts a pending-publication next day (published data not yet there)", () => {
    expect(checkEnableDate("2026-10-30", { ...base, statuses: { "2026-10-30": "pending-publication" } }).ok).toBe(true);
  });
  it("rejects past dates and the latest published date itself, naming the expected date", () => {
    for (const d of ["2025-01-01", "2026-10-28", "2026-10-29"]) {
      const r = checkEnableDate(d, base);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/on or before the latest published market date 2026-10-29/);
      expect(!r.ok && r.reason).toMatch(/--from 2026-10-30/);
    }
  });
  it("rejects a skipped session or a postponed activation", () => {
    const r = checkEnableDate("2026-11-02", base);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/not the next eligible session.*2026-10-30/);
  });
  it("skips a known exchange holiday and a weekend", () => {
    const hol: EnableInputs = { ...base, statuses: { "2026-10-30": "non-trading" } };
    expect(expectedEnableDate(hol)).toEqual({ ok: true, expected: "2026-11-02" });
    expect(checkEnableDate("2026-11-02", hol).ok).toBe(true);
    expect(checkEnableDate("2026-10-30", hol).ok).toBe(false); // the holiday itself
    expect(expectedEnableDate({ ...base, latestMarketDate: "2026-10-30" })).toEqual({ ok: true, expected: "2026-11-02" });
  });
  it("honours a declared weekend special session only through an override", () => {
    expect(expectedEnableDate({ ...base, latestMarketDate: "2026-10-30", overrides: new Set(["2026-10-31"]) })).toEqual({ ok: true, expected: "2026-10-31" });
  });
  it("fails safely on an unresolved or inconsistent calendar and when the latest date is unknown", () => {
    expect(checkEnableDate("2026-10-30", { ...base, statuses: { "2026-10-30": "unresolved" } }).ok).toBe(false);
    expect(checkEnableDate("2026-10-30", { ...base, statuses: { "2026-10-30": "trading" } }).ok).toBe(false);
    expect(checkEnableDate("2026-10-30", { ...base, latestMarketDate: null }).ok).toBe(false);
    expect(checkEnableDate("2026-10-30", { ...base, latestMarketDate: "garbage" }).ok).toBe(false);
  });
  it("rejects invalid dates and an already captured date", () => {
    for (const d of ["", "2026-13-01", "2026-02-30", "tomorrow", "2026-1-5"]) expect(checkEnableDate(d, base).ok, d).toBe(false);
    expect(checkEnableDate("2026-10-30", { ...base, capturedDates: new Set(["2026-10-30"]) }).ok).toBe(false);
  });
  it("there is no override flag in the CLI", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile("scripts/ledger-protocol.mts", "utf-8");
    expect(src).not.toMatch(/args\.(force|override|allowPast)|args\["(force|override|allow-past)"\]/);
  });
});
