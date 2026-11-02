import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { OD1_DEFINITIONS, OD1_LABELS, buildHoldoutFile, buildOd1File, checkHoldoutTransition, checkProtocolIntegrity, od1DefinitionsSha256 } from "../../scripts/ledger/protocol.mts";
import { sha256Canonical } from "../../scripts/ledger/canonical.mts";

describe("OD1 protocol and holdout", () => {
  it("the definitions hash is frozen (golden)", () => {
    expect(od1DefinitionsSha256()).toBe(sha256Canonical(OD1_DEFINITIONS));
    expect(od1DefinitionsSha256()).toMatch(/^[0-9a-f]{64}$/);
  });
  it("label changes do not change the definitions hash", () => {
    const before = od1DefinitionsSha256();
    const original = { ...OD1_LABELS };
    (OD1_LABELS as any).__probe = "x";
    expect(od1DefinitionsSha256()).toBe(before);
    delete (OD1_LABELS as any).__probe;
    expect(OD1_LABELS).toEqual(original);
  });
  it("committed protocol files match the code", async () => {
    const od1 = JSON.parse(await readFile("public/data/ledger/protocol/od1.json", "utf-8"));
    const holdout = JSON.parse(await readFile("public/data/ledger/holdout.json", "utf-8"));
    expect(od1).toEqual(buildOd1File());
    expect(holdout).toEqual(buildHoldoutFile());
    expect(checkProtocolIntegrity(od1, holdout)).toEqual([]);
    expect(holdout.status).toBe("sealed");
    expect(holdout.startDate).toBeNull();
  });
  it("integrity check detects tampering and missing files", () => {
    const od1 = buildOd1File();
    const h = buildHoldoutFile();
    expect(checkProtocolIntegrity(null, h)).not.toEqual([]);
    expect(checkProtocolIntegrity(od1, null)).not.toEqual([]);
    expect(checkProtocolIntegrity({ ...od1, definitionsSha256: "0".repeat(64) }, h)).not.toEqual([]);
    expect(checkProtocolIntegrity(od1, { ...h, protocol: { ...h.protocol, definitionsSha256: "0".repeat(64) } })).not.toEqual([]);
  });
  it("holdout transitions: create sealed, no edits, unblind only with authorisation", () => {
    const h = buildHoldoutFile();
    expect(checkHoldoutTransition(null, h)).toEqual([]);
    expect(checkHoldoutTransition(null, { ...h, status: "unblinded" })).not.toEqual([]);
    expect(checkHoldoutTransition(h, { ...h, startDate: "2026-11-02" })).not.toEqual([]);
    expect(checkHoldoutTransition(h, { ...h, gate: { ...h.gate, minCompletedLiveSessions: 10 } })).not.toEqual([]);
    const un = { ...h, status: "unblinded" as const, unblinded: { authorisedBy: "u", authorisedAt: "t", completedLiveSessions: 250, exemptionsCount: 0 } };
    expect(checkHoldoutTransition(h, un)).toEqual([]);
    expect(checkHoldoutTransition(un, h)).not.toEqual([]);
    expect(checkHoldoutTransition(h, { ...un, unblinded: { ...un.unblinded, completedLiveSessions: 249 } })).not.toEqual([]);
  });
  it("the gate is a minimum review gate, not a significance claim", () => expect(buildHoldoutFile().gate.note).toMatch(/minimum review gate/));
});
