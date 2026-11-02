/** Canonical JSON and hashing used by every ledger artefact (stable key order, no whitespace). */
import { createHash } from "node:crypto";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => [k, canonicalize(o[k])]),
    );
  }
  return value;
}

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalize(value));

export const sha256Hex = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");

export const sha256Canonical = (value: unknown): string => sha256Hex(canonicalJson(value));
