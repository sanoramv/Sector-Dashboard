/**
 * Shadow prediction rules (v1) — EXPERIMENTAL, prospective only.
 * Pre-declared in docs/research/SHADOW_PREDICTIONS.md (committed before any capture). Any change to this file changes
 * every shadow version identifier (the file's sha256 is part of the identifier): never edit it to "fix" a version.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Canonical, sha256Hex } from "../ledger/canonical.mts";

export const SHADOW_SCHEME = "v1";
export const SHADOW_DEFINITIONS_FILE = "scripts/shadow/definitions.mts";
/** production gainer pool (top-50 list) */
export const MV1_POOL = 50;
export const CAP_CHANGE_PCT = 10;
export const MAX_DISTANCE_PCT = 7;

/** What a rule may look at: the production candidate's own fields on the session (nothing after the close). */
export interface ShadowInput {
  rank: number;
  changePct: number;
  label: string;
  breakoutToday: boolean | null;
  distancePct: number | null;
}

export type VariantId = "bo-wide" | "bo-raw" | "bo-cap10";

export interface Variant {
  id: VariantId;
  /** exact text of the pre-declared table row */
  definition: string;
  include: (r: ShadowInput) => boolean;
}

export const VARIANTS: readonly Variant[] = [
  { id: "bo-wide", definition: "label = possible-breakout, any rank", include: (r) => r.label === "possible-breakout" },
  {
    id: "bo-raw",
    definition: "patterns.breakoutToday = true (close above the prior 60-session high) AND change < 10 AND distance < 7",
    include: (r) => r.breakoutToday === true && r.changePct < CAP_CHANGE_PCT && r.distancePct !== null && r.distancePct < MAX_DISTANCE_PCT,
  },
  { id: "bo-cap10", definition: "label = possible-breakout AND gainer rank <= 50 AND change < 10", include: (r) => r.label === "possible-breakout" && r.rank <= MV1_POOL && r.changePct < CAP_CHANGE_PCT },
];

/** The production comparator: the "Possible breakout setup" rows of the mv1 top-50 gainer list. */
export const isMv1Breakout = (r: Pick<ShadowInput, "rank" | "label">) => r.label === "possible-breakout" && r.rank <= MV1_POOL;

export async function shadowRuleFileSha256(repoRoot: string): Promise<string> {
  return sha256Hex(await readFile(path.join(repoRoot, SHADOW_DEFINITIONS_FILE)));
}

export function versionIdOf(v: Pick<Variant, "id" | "definition">, mv1RuleVersion: string, ruleFileSha256: string): string {
  const h = sha256Canonical({ variant: v.id, definition: v.definition, mv1RuleVersion, shadowRuleFileSha256: ruleFileSha256 });
  return `${v.id}-${SHADOW_SCHEME}-${h.slice(0, 8)}`;
}

export async function shadowVersions(repoRoot: string, mv1RuleVersion: string): Promise<Array<Variant & { versionId: string }>> {
  const fileSha = await shadowRuleFileSha256(repoRoot);
  return VARIANTS.map((v) => ({ ...v, versionId: versionIdOf(v, mv1RuleVersion, fileSha) }));
}
