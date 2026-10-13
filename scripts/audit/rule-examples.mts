/**
 * Phase 13 audit: prints real pass/fail examples (exact metrics and conditions)
 * for sector scores, stock scores and the pattern heuristics on the committed dataset.
 *   npx tsx scripts/audit/rule-examples.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? ".");
const { buildDashboardData } = await import(path.join(root, "src/lib/dashboard.ts"));
const { DEFAULT_SETTINGS } = await import(path.join(root, "src/types/config.ts"));
const D = path.join(root, "public/data");
const read = (f: string) => JSON.parse(readFileSync(path.join(D, f), "utf-8"));
const d = buildDashboardData({ manifest: read("manifest.json"), indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") }, DEFAULT_SETTINGS);
const f = (m: any, k = 2) => (m?.available ? (typeof m.value === "number" ? m.value.toFixed(k) : JSON.stringify(m.value)) : `n/a (${m?.reason})`);
for (const slug of ["pharma", "auto", "chemicals"]) {
  const s = d.sectors.find((x: any) => x.slug === slug);
  console.log(`\n## ${s.displayName} as of ${f(s.latestDate)} score ${s.score.pointsEarned}/${s.score.pointsPossible} regime ${s.regime.regime} (${s.regime.confidence})`);
  console.log(`  1M ${f(s.returns.m1)} 3M ${f(s.returns.m3)} 6M ${f(s.returns.m6)} RS3M ${f(s.relativeStrength.m3)} dist52 ${f(s.distanceFrom52wHigh)} b20 ${f(s.breadth.above20dma.pct)} (${s.breadth.above20dma.eligible}/${s.breadth.above20dma.total}) b50 ${f(s.breadth.above50dma.pct)} b200 ${f(s.breadth.above200dma.pct)} (${s.breadth.above200dma.eligible}/${s.breadth.above200dma.total})`);
  for (const c of s.score.conditions) console.log(`   [${c.passed === null ? "N/A " : c.passed ? "PASS" : "FAIL"}] ${c.label} (${c.points}pt)`);
  console.log("   reasons:", s.regime.reasons.join(" | "));
}
const scr = d.stockScreen;
const cnt = (p: (s: any) => boolean) => scr.filter(p).length;
console.log(`\nscreen n=${scr.length}; resistance approaching=${cnt((s) => s.resistance.available && s.resistance.value.isApproaching)} consolidating=${cnt((s) => s.consolidation.available && s.consolidation.value.isConsolidating)} triangle=${cnt((s) => s.triangle.available && s.triangle.value.detected)} (asc ${cnt((s) => s.triangle.available && s.triangle.value.type === "ascending")}, desc ${cnt((s) => s.triangle.available && s.triangle.value.type === "descending")}, sym ${cnt((s) => s.triangle.available && s.triangle.value.type === "symmetrical")}) triangleUnavailable=${cnt((s) => !s.triangle.available)}`);
const pick = (p: (s: any) => boolean, n: number) => scr.filter(p).slice(0, n);
const show = (s: any) => {
  console.log(`\n### ${s.symbol} as of ${f(s.latestDate)} close ${f(s.currentClose)} score ${s.score.pointsEarned}/${s.score.pointsPossible}`);
  if (s.resistance.available) console.log(`  resistance level ${s.resistance.value.level} (${s.resistance.value.levelDate}) dist ${s.resistance.value.distancePct.toFixed(2)}% approaching=${s.resistance.value.isApproaching}`);
  if (s.consolidation.available) console.log(`  consolidation recent ${s.consolidation.value.recentRangePct.toFixed(2)}% base ${s.consolidation.value.baselineRangePct.toFixed(2)}% ratio ${s.consolidation.value.contractionRatio.toFixed(3)} -> ${s.consolidation.value.isConsolidating}`);
  console.log(`  triangle ${f(s.triangle)}`);
  for (const c of s.score.conditions) console.log(`   [${c.passed === null ? "N/A " : c.passed ? "PASS" : "FAIL"}] ${c.label}`);
};
pick((s) => s.resistance.available && s.resistance.value.isApproaching, 1).forEach(show);
pick((s) => s.resistance.available && !s.resistance.value.isApproaching && s.resistance.value.distancePct > -4 && s.resistance.value.distancePct < -3, 1).forEach(show);
pick((s) => s.consolidation.available && s.consolidation.value.isConsolidating, 1).forEach(show);
pick((s) => s.triangle.available && s.triangle.value.type === "symmetrical", 1).forEach(show);
pick((s) => s.triangle.available && s.triangle.value.swingHighCount === 2 && s.triangle.value.detected, 1).forEach(show);
console.log("\ntriangle detections built on only 2 swing highs or 2 swing lows:", cnt((s) => s.triangle.available && s.triangle.value.detected && (s.triangle.value.swingHighCount === 2 || s.triangle.value.swingLowCount === 2)), "of", cnt((s) => s.triangle.available && s.triangle.value.detected));
