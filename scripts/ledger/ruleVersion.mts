/**
 * Deterministic rule-version hash (design §5): a token-stream hash over the verified import graph of the
 * momentum calculation path. Comments, JSDoc and whitespace are not tokens; compiled JavaScript is never hashed.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { canonicalJson, sha256Hex } from "./canonical.mts";
import { RULE_VERSION_COUNTER, TOKENIZER_ID } from "./constants.mts";

/** The seven entry points of the momentum path; the file list below is their verified transitive import closure. */
export const RULE_ENTRY_POINTS = [
  "src/lib/momentum/discovery.ts",
  "src/lib/momentum/market.ts",
  "src/lib/momentum/universe.ts",
  "src/lib/momentum/features.ts",
  "src/lib/momentum/assess.ts",
  "src/lib/momentum/classify.ts",
  "src/lib/activity.ts",
];

/** 17 runtime files + 5 type-only contract files = 22 (design §5.1). `marketCapSegments.ts` is deliberately absent. */
export const RULE_FILES: readonly string[] = [
  "src/config/marketIndices.ts",
  "src/config/sectorUniverse.ts",
  "src/lib/activity.ts",
  "src/lib/calculations/breadth.ts",
  "src/lib/calculations/distanceFromHigh.ts",
  "src/lib/calculations/patterns.ts",
  "src/lib/calculations/regime.ts",
  "src/lib/calculations/relativeStrength.ts",
  "src/lib/calculations/returns.ts",
  "src/lib/calculations/validation.ts",
  "src/lib/momentum/assess.ts",
  "src/lib/momentum/classify.ts",
  "src/lib/momentum/discovery.ts",
  "src/lib/momentum/features.ts",
  "src/lib/momentum/market.ts",
  "src/lib/momentum/universe.ts",
  "src/types/metrics.ts",
  "src/types/activity.ts",
  "src/types/config.ts",
  "src/types/dataset.ts",
  "src/types/market.ts",
  "src/types/momentum.ts",
];

/** Text of every leaf token in source order. Comments and JSDoc are trivia, not tokens. */
export function tokenize(text: string): string[] {
  const sf = ts.createSourceFile("x.ts", text, ts.ScriptTarget.ESNext, false, ts.ScriptKind.TS);
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    const kids = n.getChildren(sf).filter((c) => !(c.kind >= ts.SyntaxKind.FirstJSDocNode && c.kind <= ts.SyntaxKind.LastJSDocNode));
    if (kids.length === 0) {
      if (n.kind !== ts.SyntaxKind.EndOfFileToken) out.push(n.getText(sf));
    } else kids.forEach(walk);
  };
  walk(sf);
  return out;
}

export const tokenHash = (text: string): string => sha256Hex(tokenize(text).join("\u0001"));

export interface RuleFileHash {
  path: string;
  tokenHash: string;
}

export async function hashRuleFiles(root: string, files: readonly string[] = RULE_FILES): Promise<RuleFileHash[]> {
  const out: RuleFileHash[] = [];
  for (const f of [...files].sort()) out.push({ path: f, tokenHash: tokenHash(await readFile(path.join(root, f), "utf-8")) });
  return out;
}

/** `mv<N>-<8 hex>` over the sorted file hashes plus the canonical configuration. */
export function computeRuleVersion(ruleFiles: RuleFileHash[], configForHash: unknown, counter = RULE_VERSION_COUNTER): string {
  const sorted = [...ruleFiles].sort((a, b) => a.path.localeCompare(b.path));
  return `mv${counter}-${sha256Hex(canonicalJson({ files: sorted, config: configForHash, tokenizer: TOKENIZER_ID })).slice(0, 8)}`;
}

export const typescriptVersion = (): string => ts.version;

/** Import closure of `entries`, split into value-reachable (runtime) and type-only files. Paths are repo-relative. */
export async function computeImportGraph(root: string, entries: readonly string[] = RULE_ENTRY_POINTS): Promise<{ runtime: string[]; typeOnly: string[] }> {
  const seen = new Map<string, boolean>(); // path -> reachable at runtime
  async function resolve(from: string, spec: string): Promise<string | null> {
    if (!spec.startsWith(".")) return null;
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      try {
        await readFile(path.join(root, cand));
        if (/\.tsx?$/.test(cand)) return cand;
      } catch {
        /* try next */
      }
    }
    return null;
  }
  async function visit(file: string, runtime: boolean): Promise<void> {
    if (seen.has(file) && (seen.get(file) || !runtime)) return;
    seen.set(file, (seen.get(file) ?? false) || runtime);
    const text = await readFile(path.join(root, file), "utf-8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    for (const st of sf.statements) {
      let spec: string | null = null;
      let typeOnly = false;
      if (ts.isImportDeclaration(st) && ts.isStringLiteral(st.moduleSpecifier)) {
        spec = st.moduleSpecifier.text;
        const clause = st.importClause;
        if (clause?.isTypeOnly) typeOnly = true;
        else if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && clause.namedBindings.elements.length > 0) {
          typeOnly = clause.namedBindings.elements.every((e) => e.isTypeOnly);
        }
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
        spec = st.moduleSpecifier.text;
        typeOnly = st.isTypeOnly;
      }
      if (!spec) continue;
      const target = await resolve(file, spec);
      if (target) await visit(target, runtime && !typeOnly);
    }
  }
  for (const e of entries) await visit(e, true);
  const all = [...seen.entries()];
  return { runtime: all.filter(([, r]) => r).map(([p]) => p).sort(), typeOnly: all.filter(([, r]) => !r).map(([p]) => p).sort() };
}
