/**
 * Research-only integrity and coverage check of the local historical NSE archive (Track C, B4). Read-only on
 * research-data/; writes one JSON report outside public/.
 *
 *   npx tsx scripts/research/history-validate.mts [--dir research-data/nse] [--out research-data/validation-2020-2025.json]
 *
 * Checks: manifest vs files (existence, sha256, gunzip, CSV structure with the production parser); session date inside
 * each file (NSE serves the previous session's equity file on a holiday); trading calendar from the NIFTY 500 index
 * row; duplicates; OHLC sanity; corporate-action candidates from PREV_CLOSE(t) / CLOSE(t-1) for EQ-series stocks;
 * series changes; benchmark and sector-index coverage; symbols that stop trading (delisting/suspension candidates).
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { parseCsvObjects } from "../lib/csv.mts";
import { interpretArchive, validateArchiveText } from "../lib/archives.mts";

const args = process.argv.slice(2);
const opt = (n: string, d: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const DIR = path.resolve(opt("--dir", "research-data/nse"));
const OUT = path.resolve(opt("--out", "research-data/validation-2020-2025.json"));
if (OUT.split(path.sep).includes("public")) throw new Error("never write research output under public/");

type Entry = { kind: "stock" | "index"; date: string; status: string; bytes?: number; sha256?: string; at: string };
const lines = (await readFile(path.join(DIR, "manifest.jsonl"), "utf-8")).split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
// last entry per (kind, date) wins (errors are retried and re-recorded)
const last = new Map<string, Entry>();
for (const e of lines) last.set(`${e.kind}|${e.date}`, e);
const entries = [...last.values()].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
const statusCount: Record<string, Record<string, number>> = {};
for (const e of entries) (statusCount[e.kind] ??= {})[e.status] = (statusCount[e.kind][e.status] ?? 0) + 1;

const problems: string[] = [];
const notes: string[] = [];
const fileOf = (e: Entry) => path.join(DIR, e.kind, e.date.slice(0, 4), `${e.date}.csv.gz`);
const num = (s: string | undefined) => (s === undefined || s.trim() === "" || s.trim() === "-" ? null : Number(s.trim()));

// ---- per-file integrity and session dates ----
const indexDays = new Map<string, Record<string, string>[]>();
const stockDays = new Map<string, Record<string, string>[]>();
const stockEarlier: Array<{ requested: string; fileDate: string }> = [];
const indexEarlier: Array<{ requested: string; fileDate: string }> = [];
for (const e of entries.filter((x) => x.status === "ok")) {
  let buf: Buffer;
  try {
    buf = await readFile(fileOf(e));
  } catch {
    problems.push(`${e.kind} ${e.date}: manifest says ok but the file is missing`);
    continue;
  }
  const raw = gunzipSync(buf);
  // the manifest hashes the downloaded (uncompressed) bytes
  if (createHash("sha256").update(raw).digest("hex") !== e.sha256) problems.push(`${e.kind} ${e.date}: sha256 mismatch`);
  const text = raw.toString("utf-8").replace(/^\uFEFF/, "");
  // NSE stock files pad values with spaces after commas; normalise headers/values like the production parser sees them
  const normal = text
    .split(/\r?\n/)
    .map((l) => l.split(",").map((c) => c.trim()).join(","))
    .join("\n");
  const kind = e.kind === "stock" ? "stocks" : "index";
  const v = validateArchiveText(kind, normal);
  if (v) {
    problems.push(`${e.kind} ${e.date}: ${v}`);
    continue;
  }
  let r = interpretArchive(kind, normal, e.date);
  // Known NSE quirk (2023-04-06/10/11 index files): "Index Date" written mm-dd-yyyy. Accept only when the swapped date is
  // exactly the requested one, and record it.
  if (r.kind === "later-session" && kind === "index" && r.fileDate === `${e.date.slice(0, 4)}-${e.date.slice(8, 10)}-${e.date.slice(5, 7)}`) {
    notes.push(`index ${e.date}: Index Date written month-first (${r.fileDate} as read); accepted as ${e.date}`);
    r = { kind: "match", rows: parseCsvObjects(normal) };
  }
  if (r.kind === "match") (e.kind === "stock" ? stockDays : indexDays).set(e.date, r.rows);
  else if (r.kind === "earlier-session") (e.kind === "stock" ? stockEarlier : indexEarlier).push({ requested: e.date, fileDate: r.fileDate });
  else problems.push(`${e.kind} ${e.date}: file carries a LATER session ${r.fileDate}`);
}

// ---- calendar: a trading session = an index file for that date with a NIFTY 500 row ----
const n500 = (rows: Record<string, string>[]) => rows.find((r) => r["Index Name"].trim().toLowerCase() === "nifty 500");
const calendar = [...indexDays.keys()].filter((d) => n500(indexDays.get(d)!)).sort();
const noN500 = [...indexDays.keys()].filter((d) => !n500(indexDays.get(d)!));
if (noN500.length) problems.push(`index files without a NIFTY 500 row: ${noN500.join(", ")}`);
const stockOnly = [...stockDays.keys()].filter((d) => !indexDays.has(d)).sort();
const indexOnly = calendar.filter((d) => !stockDays.has(d));
const missingKinds = entries.filter((e) => e.status !== "ok").map((e) => `${e.kind} ${e.date} ${e.status}`);

// ---- stock rows: duplicates, OHLC sanity, series ----
type Bar = { date: string; series: string; open: number; high: number; low: number; close: number; prev: number | null; vol: number | null; turnoverLacs: number | null; deliv: number | null };
const bySymbol = new Map<string, Bar[]>();
let dupRows = 0;
let badOhlc = 0;
const badOhlcSamples: string[] = [];
const rowCounts: number[] = [];
const eqCounts: number[] = [];
for (const d of [...stockDays.keys()].sort()) {
  const rows = stockDays.get(d)!;
  rowCounts.push(rows.length);
  const seen = new Set<string>();
  let eq = 0;
  for (const r of rows) {
    const sym = r.SYMBOL.trim();
    const ser = r.SERIES.trim();
    const k = `${sym}|${ser}`;
    if (seen.has(k)) dupRows++;
    seen.add(k);
    if (!["EQ", "BE", "BZ", "RR"].includes(ser)) continue;
    if (ser === "EQ") eq++;
    const b: Bar = { date: d, series: ser, open: num(r.OPEN_PRICE)!, high: num(r.HIGH_PRICE)!, low: num(r.LOW_PRICE)!, close: num(r.CLOSE_PRICE)!, prev: num(r.PREV_CLOSE), vol: num(r.TTL_TRD_QNTY), turnoverLacs: num(r.TURNOVER_LACS), deliv: num(r.DELIV_PER) };
    if (!(b.low > 0 && b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open, b.close))) {
      badOhlc++;
      if (badOhlcSamples.length < 10) badOhlcSamples.push(`${d} ${sym} ${ser} o${b.open} h${b.high} l${b.low} c${b.close}`);
    }
    const list = bySymbol.get(sym) ?? [];
    if (list.length && list[list.length - 1].date === d) continue; // same symbol in two tracked series: keep the first (reported below)
    list.push(b);
    bySymbol.set(sym, list);
  }
  eqCounts.push(eq);
}

// ---- corporate-action candidates and series changes ----
const caCandidates: Array<{ symbol: string; date: string; factor: number; prevClose: number; lastClose: number; gapSessions: number }> = [];
const seriesChanges: Array<{ symbol: string; date: string; from: string; to: string }> = [];
const calIndex = new Map(calendar.map((d, i) => [d, i]));
for (const [sym, bars] of bySymbol) {
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1];
    const b = bars[i];
    if (a.series !== b.series) seriesChanges.push({ symbol: sym, date: b.date, from: a.series, to: b.series });
    if (b.prev === null || !(a.close > 0)) continue;
    const factor = b.prev / a.close;
    if (Math.abs(factor - 1) > 0.02) caCandidates.push({ symbol: sym, date: b.date, factor: Math.round(factor * 1e6) / 1e6, prevClose: b.prev, lastClose: a.close, gapSessions: (calIndex.get(b.date) ?? 0) - (calIndex.get(a.date) ?? 0) });
  }
}

// ---- coverage: symbols that stop trading before the end; benchmark and sector indices ----
const lastDay = calendar[calendar.length - 1];
const stopped = [...bySymbol.entries()].filter(([, b]) => b[b.length - 1].date < (calendar[calendar.length - 21] ?? lastDay)).length;
const started = [...bySymbol.entries()].filter(([, b]) => b[0].date > (calendar[20] ?? calendar[0])).length;
const indexNames = new Map<string, number>();
for (const d of calendar) for (const r of indexDays.get(d)!) indexNames.set(r["Index Name"].trim(), (indexNames.get(r["Index Name"].trim()) ?? 0) + 1);
const sectorLike = [...indexNames.entries()].filter(([n]) => /^nifty (auto|bank|financial services|fmcg|it|media|metal|pharma|psu bank|private bank|realty|healthcare index|consumer durables|oil & gas|energy|infrastructure|commodities|india consumption|cpse|pse|mnc|services sector|midcap 150|smallcap 250|microcap 250|50|500)$/i.test(n)).map(([n, c]) => ({ name: n, sessions: c })).sort((a, b) => a.name.localeCompare(b.name));

// ---- holiday duplicates: stock files whose content date is earlier than requested ----
const stockOnlyExplained = stockOnly.length; // match-date stock files without an index file (should be 0)

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)];
const report = {
  generatedAt: new Date().toISOString(),
  dir: path.relative(process.cwd(), DIR),
  manifest: { lines: lines.length, entries: entries.length, statusCount },
  calendar: { sessions: calendar.length, first: calendar[0], last: lastDay },
  stockFiles: { matched: stockDays.size, earlierSession: stockEarlier.length, earlierSamples: stockEarlier.slice(0, 50), rowsMedian: pct(rowCounts, 0.5), rowsMin: Math.min(...rowCounts), eqMedian: pct(eqCounts, 0.5), eqMin: Math.min(...eqCounts) },
  indexFiles: { matched: indexDays.size, earlierSession: indexEarlier.length },
  gaps: { stockMatchedWithoutIndex: stockOnly, sessionsWithoutStockFile: indexOnly, nonOk: missingKinds },
  rows: { duplicateSymbolSeries: dupRows, badOhlc, badOhlcSamples },
  symbols: { total: bySymbol.size, stoppedBeforeEnd: stopped, startedAfterBeginning: started },
  corporateActionCandidates: { count: caCandidates.length, splitsOrBonus: caCandidates.filter((c) => c.factor < 0.9).length, samples: caCandidates.filter((c) => c.factor < 0.9).slice(0, 25), all: caCandidates },
  seriesChanges: { count: seriesChanges.length, samples: seriesChanges.slice(0, 20) },
  indices: { distinct: indexNames.size, keyIndices: sectorLike },
  problems,
  notes,
};
void stockOnlyExplained;
await writeFile(OUT, JSON.stringify(report, null, 1) + "\n");
const { all: _all, ...caShort } = report.corporateActionCandidates;
console.log(JSON.stringify({ ...report, corporateActionCandidates: caShort, stockFiles: { ...report.stockFiles, earlierSamples: report.stockFiles.earlierSamples.slice(0, 5) }, indices: { distinct: report.indices.distinct, keyIndices: report.indices.keyIndices.length } }, null, 1));
