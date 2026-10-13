/**
 * Phase 13 audit: recomputes sector returns, 3M relative performance, 52-week-high
 * distance and 50-DMA breadth, plus sample stock metrics, WITHOUT the app's
 * calculation code, and compares them with buildDashboardData's output.
 * This checks the implementation against its documented formulas; it does not
 * check the data against an outside source (see yahoo-crosscheck.mts).
 *   npx tsx scripts/audit/independent-recompute.mts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? ".");
const { buildDashboardData } = await import(path.join(root, "src/lib/dashboard.ts"));
const { DEFAULT_SETTINGS } = await import(path.join(root, "src/types/config.ts"));
const D = path.join(root, "public/data");
const read = (f: string) => JSON.parse(readFileSync(path.join(D, f), "utf-8"));
const ds = { manifest: read("manifest.json"), indexSeries: read("index-series.json"), constituents: read("constituents.json"), stocks: read("stocks.json") };
const dash = buildDashboardData(ds, DEFAULT_SETTINGS);
const v = (m: any) => (m?.available ? m.value : null);
const ret = (c: number[], n: number) => (c.length > n ? (c.at(-1)! / c[c.length - 1 - n] - 1) * 100 : null);
const sma = (c: number[], n: number) => (c.length >= n ? c.slice(-n).reduce((a, b) => a + b, 0) / n : null);
const bench = ds.indexSeries.nifty500.bars.map((b: any) => b.close);
const calendar: string[] = ds.indexSeries.nifty500.bars.map((b: any) => b.date);
const marketDate = calendar[calendar.length - 1];
// Independent statement of the spec: prices are only comparable since the latest
// (a) open+close move of 40%+ either way, (b) open+close fall of 15%+, or
// (c) calendar session missing between two bars (within the calendar's range).
function comparableTail(bars: any[]): any[] {
  let start = 0;
  for (let i = 1; i < bars.length; i++) {
    const p = bars[i - 1], b = bars[i];
    const gap = p.date >= calendar[0] && b.date <= marketDate && calendar.some((d) => d > p.date && d < b.date);
    const rc = b.close / p.close, ro = b.open / p.close;
    const big = (rc <= 0.6 && ro <= 0.6) || (rc >= 1 / 0.6 && ro >= 1 / 0.6);
    const fall = rc <= 0.85 && ro <= 0.85;
    if (gap || big || fall) start = i;
  }
  return bars.slice(start);
}
const isStaleDate = (d: string) => (Date.parse(marketDate) - Date.parse(d)) / 864e5 > 7;
let checks = 0, fails = 0;
const cmp = (label: string, mine: number | null, app: number | null) => {
  checks++;
  const ok = mine === null ? app === null : app !== null && Math.abs(mine - app) < 1e-6;
  if (!ok) fails++;
  console.log(`${ok ? "OK  " : "DIFF"} ${label.padEnd(34)} independent=${mine === null ? "n/a" : mine.toFixed(4)} app=${app === null ? "n/a" : app.toFixed(4)}`);
};
for (const slug of ["auto", "it", "bank", "pharma", "chemicals"]) {
  const bars = ds.indexSeries[slug].bars; const c = bars.map((b: any) => b.close);
  const s = dash.sectors.find((x: any) => x.slug === slug);
  console.log(`--- ${slug} as of ${bars.at(-1).date} close ${c.at(-1)}`);
  for (const [k, n] of [["d1", 1], ["w1", 5], ["m1", 21], ["m3", 63], ["m6", 126]] as const) cmp(`${slug} ${k} return`, ret(c, n), v(s.returns[k]));
  cmp(`${slug} 3M rel vs N500`, ret(c, 63) !== null ? ret(c, 63)! - ret(bench, 63)! : null, v(s.relativeStrength.m3));
  const last = Date.parse(bars.at(-1).date); const span = (last - Date.parse(bars[0].date)) / 864e5;
  const win = bars.filter((b: any) => Date.parse(b.date) >= last - 365 * 864e5);
  cmp(`${slug} dist 52w high`, span >= 350 ? (c.at(-1)! / Math.max(...win.map((b: any) => b.high)) - 1) * 100 : null, v(s.distanceFrom52wHigh));
  // breadth 50: constituents with a bar within 7 days, no >=40% open+close break in their last 50 bars
  const asOf = bars.at(-1).date; let el = 0, ab = 0;
  for (const con of ds.constituents[slug].constituents) {
    const sb = (ds.stocks[con.symbol]?.bars ?? []).filter((b: any) => b.date <= asOf);
    if (!sb.length || (Date.parse(asOf) - Date.parse(sb.at(-1).date)) / 864e5 > 7) continue;
    const cc = comparableTail(sb).map((b: any) => b.close); const m = sma(cc, 50); if (m === null) continue; el++; if (cc.at(-1)! > m) ab++;
  }
  cmp(`${slug} % above 50DMA`, el ? (ab / el) * 100 : null, v(s.breadth.above50dma.pct));
  console.log(`     eligible 50DMA independent=${el} app=${s.breadth.above50dma.eligible} of ${s.breadth.above50dma.total}`);
}
for (const sym of ["RELIANCE", "TCS", "SBIN", "HDFCBANK", "KOTAKBANK", "HFCL", "TRENT", "OLAELEC"]) {
  const st = dash.stockScreen.find((x: any) => x.symbol === sym); if (!st) { console.log(sym, "not in screen"); continue; }
  const c = ds.stocks[sym].bars.map((b: any) => b.close);
  console.log(`--- ${sym} app latestDate=${v(st.latestDate)} status=${st.dataQuality.status} bars used=${st.priceSeries.length}/${c.length}`);
  const raw = ds.stocks[sym].bars;
  const stale = isStaleDate(raw[raw.length - 1].date);
  const usedBars = comparableTail(raw);
  checks++;
  const sameBars = stale || (usedBars.length === st.priceSeries.length && usedBars[0].date === st.priceSeries[0].date);
  if (!sameBars) fails++;
  console.log(`${sameBars ? "OK  " : "DIFF"} ${`${sym} comparable bars used`.padEnd(34)} independent=${stale ? "stale" : `${usedBars.length} from ${usedBars[0].date}`} app=${st.priceIntegrity.state} ${st.priceSeries.length}`);
  const used = stale ? [] : usedBars.map((b: any) => b.close);
  cmp(`${sym} m1 return`, stale ? null : ret(used, 21), v(st.returns.m1));
  cmp(`${sym} m3 return`, stale ? null : ret(used, 63), v(st.returns.m3));
  cmp(`${sym} above 50DMA (1/0)`, sma(used, 50) === null ? null : used.at(-1)! > sma(used, 50)! ? 1 : 0, st.above50dma.available ? (st.above50dma.value ? 1 : 0) : null);
  console.log(`     raw-series m3 (pre-fix behaviour) = ${ret(c, 63)?.toFixed(2)}`);
}
console.log(`\n${checks - fails}/${checks} independent checks agree`);
console.log("market overview:", JSON.stringify({ bull: dash.overview.bullishCount, side: dash.overview.sidewaysCount, bear: dash.overview.bearishCount, insuf: dash.overview.insufficientDataCount }));
console.log("sectors:", dash.sectors.map((s: any) => `${s.slug}:${s.regime.regime}:${s.score.pointsEarned}/${s.score.pointsPossible}`).join(" "));
