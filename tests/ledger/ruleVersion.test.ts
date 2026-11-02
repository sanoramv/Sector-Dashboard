import { describe, expect, it } from "vitest";
import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RULE_ENTRY_POINTS, RULE_FILES, computeImportGraph, computeRuleVersion, hashRuleFiles, tokenHash } from "../../scripts/ledger/ruleVersion.mts";
import { buildEffectiveConfig, configForHash } from "../../scripts/ledger/config.mts";
import { computeVersion } from "../../scripts/ledger/capture.mts";

const GOLDEN = "mv1-8ecef864";

describe("token hash", () => {
  const base = "export const A = 1; // note\nexport function f(x: number) { return x * A; }\n";
  it("ignores whitespace, comments and JSDoc", () => {
    const reformatted = "/** doc */\nexport   const A =\n  1;\n/* c */ export function f(x: number)\n{\n  return x*A;\n}\n";
    expect(tokenHash(reformatted)).toBe(tokenHash(base));
  });
  it("changes with any threshold, operator or identifier", () => {
    const h = tokenHash(base);
    expect(tokenHash(base.replace("= 1", "= 2"))).not.toBe(h);
    expect(tokenHash(base.replace("x * A", "x + A"))).not.toBe(h);
    expect(tokenHash(base.replace("function f", "function g"))).not.toBe(h);
  });
  it("is stable across runs", () => expect(tokenHash(base)).toBe(tokenHash(base)));
});

describe("rule version over the real repository", () => {
  it("matches the golden value and is reproducible", async () => {
    const a = await computeVersion(path.resolve("."));
    const b = await computeVersion(path.resolve("."));
    expect(a.ruleVersion).toBe(b.ruleVersion);
    expect(a.ruleVersion).toBe(GOLDEN);
    expect(a.ruleFiles).toHaveLength(RULE_FILES.length);
  });
  it("the declared file list is exactly the verified import closure (17 runtime + 5 type-only)", async () => {
    const g = await computeImportGraph(path.resolve("."), RULE_ENTRY_POINTS);
    expect(g.runtime).toHaveLength(17);
    expect(g.typeOnly).toHaveLength(5);
    expect([...g.runtime, ...g.typeOnly].sort()).toEqual([...RULE_FILES].sort());
    expect(RULE_FILES).not.toContain("src/lib/marketCapSegments.ts");
  });
  it("changes with a rule file edit or a configuration edit, not with unrelated files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "rv-"));
    try {
      for (const f of RULE_FILES) {
        await cp(path.resolve(f), path.join(root, f), { recursive: true }).catch(async () => {
          const { mkdir } = await import("node:fs/promises");
          await mkdir(path.dirname(path.join(root, f)), { recursive: true });
          await cp(path.resolve(f), path.join(root, f));
        });
      }
      const cfg = configForHash(buildEffectiveConfig());
      const v0 = computeRuleVersion(await hashRuleFiles(root), cfg);
      expect(v0).toBe(GOLDEN);
      // unrelated file: invisible
      await writeFile(path.join(root, "unrelated.ts"), "export const x = 1;");
      expect(computeRuleVersion(await hashRuleFiles(root), cfg)).toBe(v0);
      // comment-only edit: invisible
      const f = path.join(root, "src/lib/momentum/classify.ts");
      const src = await readFile(f, "utf-8");
      await writeFile(f, `// harmless comment\n${src}`);
      expect(computeRuleVersion(await hashRuleFiles(root), cfg)).toBe(v0);
      // semantic edit: new version
      await writeFile(f, src.replace(/(\d+)(?!.*\d)/s, (m) => String(Number(m) + 1)).replace(/\b0\.5\b/, "0.6"));
      const changed = src.match(/\d/) ? computeRuleVersion(await hashRuleFiles(root), cfg) : v0;
      expect(changed).not.toBe(v0);
      // config edit: new version
      const s = buildEffectiveConfig();
      s.settings.regime.breadthThresholdPct += 1;
      await writeFile(f, src);
      expect(computeRuleVersion(await hashRuleFiles(root), configForHash(s))).not.toBe(v0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
