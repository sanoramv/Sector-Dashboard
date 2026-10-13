/**
 * Phase 13 audit: compares stored closes in public/data with Yahoo Finance's
 * daily chart API (an independent vendor feed, NOT an official NSE source) and
 * lists Yahoo's split events for each stock. Yahoo's "close" is split-adjusted,
 * so a constant ratio before an ex-date means our raw NSE price is unadjusted.
 * Audit/verification tool only - the dashboard never uses Yahoo data.
 *   npx tsx scripts/audit/yahoo-crosscheck.mts RELIANCE TCS ^CRSLDX:nifty500 ^CNXIT:it
 * Stocks are given as NSE symbols; indices as <yahooSymbol>:<our slug>.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const D = path.resolve("public/data");
const idx = JSON.parse(readFileSync(path.join(D, "index-series.json"), "utf-8"));
const stocks = JSON.parse(readFileSync(path.join(D, "stocks.json"), "utf-8"));
const marketDate: string = idx.nifty500.bars[idx.nifty500.bars.length - 1].date;
const toIst = (t: number) => new Date((t + 19800) * 1000).toISOString().slice(0, 10);

for (const arg of process.argv.slice(2)) {
  const [ySym, slug] = arg.includes(":") ? arg.split(":") : [`${arg}.NS`, undefined];
  const bars = slug ? idx[slug]?.bars : stocks[arg]?.bars;
  if (!bars) {
    console.log(`${arg}: not in dataset`);
    continue;
  }
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ySym)}?range=2y&interval=1d&events=split`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const r = ((await res.json()) as any).chart?.result?.[0];
  if (!r?.timestamp) {
    console.log(`${arg}: no Yahoo data (HTTP ${res.status})`);
    continue;
  }
  const q = r.indicators.quote[0];
  const y = new Map<string, { close: number; volume: number }>();
  r.timestamp.forEach((t: number, i: number) => {
    if (q.close[i] != null) y.set(toIst(t), { close: q.close[i], volume: q.volume[i] });
  });
  let matched = 0;
  let within = 0;
  const off: string[] = [];
  for (const b of bars) {
    const yb = y.get(b.date);
    if (!yb) continue;
    matched += 1;
    const diff = (b.close / yb.close - 1) * 100;
    if (Math.abs(diff) <= 0.05) within += 1;
    else off.push(`${b.date}:${diff.toFixed(2)}%`);
  }
  const ours = new Set(bars.map((b: { date: string }) => b.date));
  const tradedMissing = [...y.entries()].filter(([d, v]) => d >= bars[0].date && d <= marketDate && !ours.has(d) && v.volume > 0).length;
  const splits = r.events?.splits ? Object.values(r.events.splits).map((e: any) => `${toIst(e.date)} ${e.splitRatio}`) : [];
  console.log(
    `${arg.padEnd(18)} closes within 0.05%: ${within}/${matched}; sessions Yahoo shows traded (volume>0) but we lack: ${tradedMissing}; Yahoo split events: ${splits.join("; ") || "none"}` +
      (off.length ? `\n   differing dates: ${off.length} (first ${off[0]}, last ${off[off.length - 1]})` : ""),
  );
}
