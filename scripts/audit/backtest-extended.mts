/**
 * Phase 13 audit: runs the app's backtest on the committed dataset ("app" mode),
 * or an independent extended analysis ("ext" mode): next-open entry, break-aware
 * segments, return relative to NIFTY 500 over identical dates, non-overlapping
 * signals, and an early/late period split. Add "baseline" after "ext" for the
 * always-true baseline.
 *   npx tsx scripts/audit/backtest-extended.mts . app
 *   npx tsx scripts/audit/backtest-extended.mts . ext [baseline]
 */
import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? ".");
const { runAllBacktests, DEFAULT_BACKTEST_CONFIG } = await import(path.join(root, "src/lib/backtest/runAll.ts"));
const { BACKTEST_RULES } = await import(path.join(root, "src/lib/backtest/rules.ts"));
const { DEFAULT_SETTINGS } = await import(path.join(root, "src/types/config.ts"));
const { validateBars } = await import(path.join(root, "src/lib/calculations/validation.ts"));
const val = await import(path.join(root, "src/lib/calculations/validation.ts"));
const D = path.join(root, "public/data");
const read = (f: string) => JSON.parse(readFileSync(path.join(D, f), "utf-8"));
const dataset = { manifest: read("manifest.json"), indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") };
const mode = process.argv[3] ?? "app";
const H = DEFAULT_BACKTEST_CONFIG.holdingSessions, COST = DEFAULT_BACKTEST_CONFIG.costBps;

if (mode === "app") {
  const t0 = Date.now();
  const res = runAllBacktests(dataset, DEFAULT_SETTINGS, DEFAULT_BACKTEST_CONFIG);
  console.log(`app backtest (hold=${H}, cost=${COST}bps) in ${Date.now() - t0}ms`);
  for (const r of res) {
    const s = r.signalStats, b = r.baselineStats;
    console.log(`${r.ruleName.padEnd(48)} n=${String(s?.n ?? 0).padStart(6)} win=${s?.winRatePct.toFixed(1)}% avg=${s?.avgReturnPct.toFixed(3)} med=${s?.medianReturnPct.toFixed(3)} | base n=${b?.n} avg=${b?.avgReturnPct.toFixed(3)} edge=${s && b ? (s.avgReturnPct - b.avgReturnPct).toFixed(3) : "-"}`);
  }
} else {
  // Independent extended analysis: entry next-session open, exit close at t+H,
  // segment-aware (no window crosses a detected price break), benchmark-relative
  // over identical dates, overlapping vs non-overlapping, first vs second half.
  const split = val.splitAtPriceBreaks;
  const bench = validateBars(dataset.indexSeries.nifty500.bars).bars;
  const benchByDate = new Map<string, number>(bench.map((b: any, i: number) => [b.date, i] as [string, number]));
  const syms = dataset.constituents.nifty500.constituents.map((c: any) => c.symbol);
  const allDates = bench.map((b: any) => b.date);
  const mid = allDates[Math.floor(allDates.length * 0.6)];
  const ruleList = process.argv[4] === "baseline" ? [{ label: "BASELINE (always true)", makeSignal: () => () => true }] : BACKTEST_RULES;
  for (const rule of ruleList as any[]) {
    const sig = rule.makeSignal(DEFAULT_SETTINGS);
    const rows: Array<{ date: string; net: number; rel: number | null; sym: string }> = [];
    for (const sym of syms) {
      const raw = dataset.stocks[sym]?.bars ?? [];
      const { bars } = validateBars(raw, { splitAtBreaks: false });
      for (const seg of split(bars, allDates).segments) {
        for (let t = 0; t + H < seg.length; t++) {
          const bUpTo = bench.slice(0, (benchByDate.get(seg[t].date) ?? -1) + 1);
          const s = sig(seg.slice(0, t + 1), bUpTo);
          if (s !== true) continue;
          const entry = seg[t + 1].open, exit = seg[t + H].close;
          const net = (exit / entry - 1) * 100 - COST / 100;
          const bi = benchByDate.get(seg[t].date), be = benchByDate.get(seg[t + H].date);
          const rel = bi !== undefined && be !== undefined ? net - ((bench[be].close / bench[bi + 1].open - 1) * 100) : null;
          rows.push({ date: seg[t].date, net, rel, sym });
        }
      }
    }
    const stats = (xs: number[]) => { if (!xs.length) return "n=0"; const s = [...xs].sort((a, b) => a - b); const avg = xs.reduce((a, b) => a + b, 0) / xs.length; return `n=${xs.length} win=${(100 * xs.filter((x) => x > 0).length / xs.length).toFixed(1)}% avg=${avg.toFixed(2)} med=${s[s.length >> 1].toFixed(2)}`; };
    // non-overlapping: per symbol, take a signal only if >= H sessions after the last taken one
    const last = new Map<string, string>(); const nonOv: typeof rows = [];
    for (const r of [...rows].sort((a, b) => a.date.localeCompare(b.date))) { const p = last.get(r.sym); if (!p || allDates.indexOf(r.date) - allDates.indexOf(p) >= H) { nonOv.push(r); last.set(r.sym, r.date); } }
    const signalDates = new Set(rows.map((r) => r.date));
    console.log(`${rule.label}`);
    console.log(`   all overlapping   ${stats(rows.map((r) => r.net))} | vs NIFTY500 ${stats(rows.filter((r) => r.rel !== null).map((r) => r.rel!))}`);
    console.log(`   non-overlapping   ${stats(nonOv.map((r) => r.net))} | vs NIFTY500 ${stats(nonOv.filter((r) => r.rel !== null).map((r) => r.rel!))}`);
    console.log(`   first 60% (<${mid}) ${stats(rows.filter((r) => r.date < mid).map((r) => r.rel ?? NaN).filter(Number.isFinite))}  | last 40% ${stats(rows.filter((r) => r.date >= mid).map((r) => r.rel ?? NaN).filter(Number.isFinite))}  [rel]`);
    console.log(`   distinct signal dates=${signalDates.size} range=${[...signalDates].sort()[0]}..${[...signalDates].sort().at(-1)}`);
  }
}
