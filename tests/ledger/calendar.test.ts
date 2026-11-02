import { describe, expect, it } from "vitest";
import { addDays, cutoffAt, isWeekend, resolveCutoff } from "../../scripts/ledger/calendar.mts";

const at = (iso: string) => Date.parse(iso);

describe("cut-off", () => {
  it("is 09:00 IST = 03:30 UTC", () => expect(new Date(cutoffAt("2026-10-30")).toISOString()).toBe("2026-10-30T03:30:00.000Z"));
  it("weekend helpers", () => {
    expect(isWeekend("2026-10-31")).toBe(true);
    expect(isWeekend("2026-10-30")).toBe(false);
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
  });
  it("Thursday session: push before Friday 09:00 IST is on time with the earliest cut-off", () => {
    const r = resolveCutoff("2026-10-29", at("2026-10-30T03:29:59Z"), {});
    expect(r).toMatchObject({ kind: "final", via: "earliest" });
    expect(new Date((r as { cutoffMs: number }).cutoffMs).toISOString()).toBe("2026-10-30T03:30:00.000Z");
  });
  it("Friday session: the earliest next session is Monday", () => {
    const r = resolveCutoff("2026-10-30", at("2026-11-02T03:30:00Z"), {});
    expect(r).toMatchObject({ kind: "final", via: "earliest" });
    expect(new Date((r as { cutoffMs: number }).cutoffMs).toISOString()).toBe("2026-11-02T03:30:00.000Z");
  });
  it("a late push waits for the calendar and stays pending while the next day is unresolved", () => {
    expect(resolveCutoff("2026-10-29", at("2026-10-30T10:00:00Z"), {})).toMatchObject({ kind: "pending", waitingFor: "2026-10-30" });
  });
  it("trading next day fixes the cut-off; holiday is skipped", () => {
    expect(resolveCutoff("2026-10-29", at("2026-10-30T10:00:00Z"), { "2026-10-30": "trading" })).toMatchObject({ kind: "final", nextSession: "2026-10-30", via: "calendar" });
    const r = resolveCutoff("2026-10-29", at("2026-10-30T10:00:00Z"), { "2026-10-30": "non-trading", "2026-11-02": "trading" });
    expect(r).toMatchObject({ kind: "final", nextSession: "2026-11-02" });
    expect(resolveCutoff("2026-10-29", at("2026-10-30T10:00:00Z"), { "2026-10-30": "non-trading" })).toMatchObject({ kind: "pending", waitingFor: "2026-11-02" });
  });
  it("a Saturday special session is honoured only through an override", () => {
    const overrides = new Set(["2026-10-31"]);
    expect(resolveCutoff("2026-10-30", at("2026-10-31T10:00:00Z"), { "2026-10-31": "trading" }, overrides)).toMatchObject({ kind: "final", nextSession: "2026-10-31" });
    expect(resolveCutoff("2026-10-30", at("2026-11-02T10:00:00Z"), {})).toMatchObject({ kind: "pending", waitingFor: "2026-11-02" });
  });
});
