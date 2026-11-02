import { describe, expect, it } from "vitest";
import { applyCaptureToState } from "../../scripts/ledger/run.mts";
import { emptyState } from "../../scripts/ledger/state.mts";

const ctx = { now: "2026-10-29T20:30:00Z", slot: "30 14 * * 1-5", ruleVersion: "mv1-x", enabledVersion: "mv1-x", enabledFrom: "2026-10-29", startedAt: "2026-10-29T20:29:00Z", captureSeconds: 12 };
const run = (sessions: any[], r10: any[] = []) => ({ sessions, r10Sessions: r10 }) as any;
const chk = (id: string, disposition = "none") => ({ id, status: "pass", disposition });

describe("applyCaptureToState", () => {
  it("a recorded session sets success fields and clears recovery", () => {
    const s = emptyState("t");
    s.recoveryRequired = ["2026-10-29"];
    const status = applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "recorded", reasons: [], warnings: [], checks: [chk("R1")] }]), ctx);
    expect(status).toBe("ok");
    expect(s).toMatchObject({ runStatus: "ok", lastSuccessfulSessionDate: "2026-10-29", recoveryRequired: [], enabledFrom: "2026-10-29" });
    expect(s.dates["2026-10-29"]).toMatchObject({ status: "recorded", publicationClass: "pending" });
    expect(s.dates["2026-10-29"].earliestCutoffUtc).toBe("2026-10-30T03:30:00.000Z");
  });
  it("an R11 flag becomes review-required but still counts as captured", () => {
    const s = emptyState("t");
    applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "recorded", reasons: [], warnings: ["R11"], checks: [chk("R11", "flag")] }]), ctx);
    expect(s.dates["2026-10-29"].status).toBe("review-required");
    expect(s.lastSuccessfulSessionDate).toBe("2026-10-29");
  });
  it("blocked / waiting / anomaly record the reasons and require recovery", () => {
    const s = emptyState("t");
    expect(applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "blocked", reasons: ["R3 low"], warnings: [], checks: [chk("R3", "blocked")] }]), ctx)).toBe("blocked");
    expect(s.recoveryRequired).toEqual(["2026-10-29"]);
    expect(s.lastFailure?.reasons).toEqual(["R3 low"]);
    expect(applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "anomaly", reasons: ["x"], warnings: [], checks: [] }]), ctx)).toBe("anomaly");
    expect(applyCaptureToState(emptyState("t"), run([{ date: "2026-10-29", outcome: "waiting", reasons: ["R1"], warnings: [], checks: [] }]), ctx)).toBe("waiting");
  });
  it("not-enabled changes no date records", () => {
    const s = emptyState("t");
    expect(applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "not-enabled", reasons: [], warnings: [], checks: [] }]), ctx)).toBe("not-enabled");
    expect(s.dates).toEqual({});
  });
  it("an existing record is never downgraded by a duplicate run", () => {
    const s = emptyState("t");
    applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "recorded", reasons: [], warnings: [], checks: [chk("R1")] }]), ctx);
    applyCaptureToState(s, run([{ date: "2026-10-29", outcome: "exists", reasons: [], warnings: [], checks: [] }]), { ...ctx, now: "2026-10-29T22:00:00Z" });
    expect(s.dates["2026-10-29"].status).toBe("recorded");
    expect(s.runs).toHaveLength(2);
  });
  it("R10 marks a past session source-revised without touching its capture fields", () => {
    const s = emptyState("t");
    applyCaptureToState(s, run([{ date: "2026-10-28", outcome: "recorded", reasons: [], warnings: [], checks: [chk("R1")] }]), ctx);
    applyCaptureToState(s, run([], [{ date: "2026-10-28", ok: false, changedSymbols: ["AAA"], changedIndices: [], removedFromSource: [] }]), ctx);
    expect(s.dates["2026-10-28"]).toMatchObject({ status: "source-revised", generatedAt: ctx.now });
    expect(s.dates["2026-10-28"].reasons[0]).toMatch(/AAA/);
  });
});
