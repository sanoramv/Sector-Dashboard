/**
 * Reproducible run of the Next-Day Momentum historical evaluation on the
 * published data (public/data), printing the same statistics the page shows.
 * Read-only; no network. Usage: npx tsx scripts/audit/momentum-evaluation.mts [--json out.json]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RawDataset } from "../../src/types/dataset.ts";
import type { StockActivityFile } from "../../src/types/activity.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { decodeAllActivity } from "../../src/lib/activity.ts";
import { prepareUniverse } from "../../src/lib/momentum/universe.ts";
import { runMomentumEvaluation, type OutcomeStats } from "../../src/lib/momentum/evaluation.ts";
import { LABEL_TEXT } from "../../src/lib/momentum/classify.ts";

const DATA = path.resolve("public/data");
const read = async <T,>(f: string): Promise<T> => JSON.parse(await readFile(path.join(DATA, f), "utf-8")) as T;

function row(name: string, s: OutcomeStats | null): string {
  if (!s) return `${name.padEnd(46)} (no observations)`;
  const ci = (c: [number, number] | null) => (c ? `[${c[0].toFixed(2)}, ${c[1].toFixed(2)}]` : "[n/a]");
  return (
    `${name.padEnd(46)} n=${String(s.n).padStart(5)} dates=${String(s.dates).padStart(3)} ` +
    `up=${s.pctPositive.toFixed(1).padStart(5)}% ${ci(s.pctPositiveCi).padEnd(16)} ` +
    `mean=${s.meanPct.toFixed(2).padStart(6)}% ${ci(s.meanCi).padEnd(16)} med=${s.medianPct.toFixed(2).padStart(6)}% ` +
    `p10=${s.p10.toFixed(2).padStart(6)} p90=${s.p90.toFixed(2).padStart(6)} down3=${s.pctDown3.toFixed(1).padStart(4)}% ` +
    `>N500=${s.pctOutperformNifty.toFixed(1).padStart(5)}% HH=${s.pctHigherHigh.toFixed(1).padStart(5)}% LL=${s.pctLowerLow.toFixed(1).padStart(5)}% ` +
    `gap=${s.meanGapPct.toFixed(2).padStart(6)} o2cNet=${s.meanOpenToCloseNetPct.toFixed(2).padStart(6)}% ` +
    `MFE=${s.meanMfePct.toFixed(2)} MAE=${s.meanMaePct.toFixed(2)}` +
    (s.sufficient ? "" : `  [INSUFFICIENT: ${s.insufficientReason}]`)
  );
}

async function main() {
  const dataset: RawDataset = {
    manifest: await read("manifest.json"),
    indexSeries: await read("index-series.json"),
    constituents: await read("constituents.json"),
    stocks: await read("stocks.json"),
  };
  const activity = decodeAllActivity(await read<StockActivityFile>("stock-activity.json"));
  const t0 = performance.now();
  const u = prepareUniverse(dataset, activity);
  const t1 = performance.now();
  const r = runMomentumEvaluation(u, DEFAULT_SETTINGS);
  const t2 = performance.now();

  console.log(`prepare ${(t1 - t0).toFixed(0)}ms, evaluation ${(t2 - t1).toFixed(0)}ms`);
  console.log(`data through ${dataset.manifest.latestMarketDate}; sessions ${r.sessionsEvaluated} (${r.firstDate}..${r.lastDate}); universe ${r.universeSize}; observations ${r.observations.length}`);
  console.log(`exclusions: ${JSON.stringify(r.exclusions)}`);
  console.log("\n== Baselines");
  console.log(row("All eligible universe stocks", r.baselineAllStocks));
  if (r.baselineNifty500) console.log(`NIFTY 500 next session: n=${r.baselineNifty500.n} up=${r.baselineNifty500.pctPositive.toFixed(1)}% mean=${r.baselineNifty500.meanPct.toFixed(3)}% median=${r.baselineNifty500.medianPct.toFixed(3)}%`);
  console.log("\n== By group");
  for (const g of r.byGroup) console.log(row(`top ${r.config.topN} ${g.key}s`, g.stats));
  console.log("\n== By group and label");
  for (const g of r.byGroupLabel) console.log(row(`${g.key.group} / ${LABEL_TEXT[g.key.label]}`, g.stats));
  console.log("\n== By evidence category");
  for (const g of r.byCategory) console.log(row(`${g.key.group} / ${g.key.category}`, g.stats));
  console.log("\n== Category precision/recall vs taking every top mover (base rate)");
  for (const c of r.classification) {
    console.log(
      `${c.group} ${c.category} -> ${c.target}: predicted ${c.predicted} (${c.predictedDates} dates) precision ${c.precision?.toFixed(1) ?? "n/a"}% ` +
        `${c.precisionCi ? `[${c.precisionCi[0].toFixed(1)}, ${c.precisionCi[1].toFixed(1)}]` : ""} recall ${c.recall?.toFixed(1) ?? "n/a"}% base rate ${c.baseRate.toFixed(1)}% lift ${c.liftPp?.toFixed(1) ?? "n/a"}pp`,
    );
  }
  console.log("\n== Category by chronological third");
  for (const g of r.byCategoryFold) console.log(row(`F${g.key.fold} ${g.key.group} / ${g.key.category}`, g.stats));
  console.log("\n== First appearance only (no consecutive-day repeats)");
  for (const g of r.firstAppearanceOnly) console.log(row(`${g.key}s`, g.stats));
  console.log("\n== By liquidity (median 20-session turnover)");
  for (const g of r.byLiquidity) console.log(row(`${g.key.group} / ${g.key.liquidity}`, g.stats));
  console.log("\n== By move magnitude");
  for (const g of r.byMagnitude) console.log(row(`${g.key.group} / ${g.key.magnitude}`, g.stats));
  console.log("\n== By NSE industry");
  for (const g of r.byIndustry) console.log(row(`${g.key.group} / ${g.key.industry}`.slice(0, 46), g.stats));
  console.log("\n== By market regime");
  for (const g of r.byRegime) console.log(row(`${g.key.group} / ${g.key.regime}`, g.stats));
  console.log("\n== By volume confirmation (RVOL >= 1.5)");
  for (const g of r.byVolume) console.log(row(`${g.key.group} / ${g.key.volume}`, g.stats));
  console.log("\n== Chronological folds");
  for (const g of r.byFold) console.log(row(`F${g.key.fold} ${g.key.from}..${g.key.to} ${g.key.group}${g.key.label ? " / " + LABEL_TEXT[g.key.label] : ""}`, g.stats));
  console.log("\n== Walk-forward: label frequency vs group frequency (target: next close > today's close)");
  for (const w of r.walkForward) {
    console.log(`${w.group}: scored=${w.scored} brier(label)=${w.brierLabelModel?.toFixed(4)} brier(group)=${w.brierGroupModel?.toFixed(4)} skill=${w.skill?.toFixed(4)}`);
    for (const b of w.reliability) console.log(`   predicted ${b.bin}: n=${b.n} mean predicted ${b.meanPredicted.toFixed(1)}% observed ${b.observed.toFixed(1)}%`);
  }
  console.log("\n== Walk-forward: evidence category frequency vs group frequency");
  for (const w of r.walkForwardCategory) console.log(`${w.group}: scored=${w.scored} brier(category)=${w.brierLabelModel?.toFixed(4)} brier(group)=${w.brierGroupModel?.toFixed(4)} skill=${w.skill?.toFixed(4)}`);
  const out = process.argv.indexOf("--json");
  if (out > 0 && process.argv[out + 1]) {
    const { observations: _omit, ...summary } = r;
    const strip = (w: (typeof r.walkForward)[number]) => ({ ...w, predictions: undefined });
    await writeFile(process.argv[out + 1], JSON.stringify({ ...summary, walkForward: r.walkForward.map(strip), walkForwardCategory: r.walkForwardCategory.map(strip) }, null, 1));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
