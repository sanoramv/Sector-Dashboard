/**
 * Independent historical validation (B5) - research only. Frozen plan: docs/research/HISTORICAL_VALIDATION.md §1.
 *
 *   npx tsx scripts/research/historical-validation.mts --out research-data/historical-validation.json [--reps 1000]
 *     [--dir research-data/nse] [--signals-only]
 *
 * Builds the dataset from the local, manifest-verified NSE archive with the PRODUCTION ingest functions, a
 * semi-annual turnover-rank universe (no look-ahead), then runs the study's unchanged row builder and experiments
 * (breakout-characteristics.mts) on the new period, plus the pre-declared C/E/D items. Never reads or writes public/
 * market data except today's constituent classification (industry, sector-index lists) as the plan states.
 * `--signals-only` stops before any outcome is summarised (signal counts and coverage only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import type { RawDataset } from "../../src/types/dataset.ts";
import type { ConstituentRef, IndexSeries, SectorConstituents, StockSeries } from "../../src/types/market.ts";
import type { ActivityRow } from "../../src/types/activity.ts";
import { DEFAULT_SETTINGS } from "../../src/types/config.ts";
import { BENCHMARK, SECTOR_UNIVERSE } from "../../src/config/sectorUniverse.ts";
import { MARKET_CONTEXT_INDICES } from "../../src/config/marketIndices.ts";
import { prepareUniverse } from "../../src/lib/momentum/universe.ts";
import { parseCsvObjects } from "../lib/csv.mts";
import { ingestIndexOutcome, ingestStockOutcome, finalizeBars } from "../lib/ingest.mts";
import { interpretArchive } from "../lib/archives.mts";
import type { RefreshState } from "../lib/refresh-state.mts";
import { canonicalJson } from "../ledger/canonical.mts";
import { BINS, Boot, CHANGE_BUCKETS, HORIZONS, METRIC, bh, bucketOf, buildRows, diff, est, pctile, ratio, runStudy, summarise, sums, type H, type Row } from "./breakout-characteristics.mts";

export const PLAN = "docs/research/HISTORICAL_VALIDATION.md";
export const FENCE = "2025-08-23"; // every outcome window must end on or before 2025-08-22
export const EXCLUDED_SESSIONS = ["2021-11-04"]; // Muhurat session without an equity file
export const MIN_PRIOR_SESSIONS = 255;
export const UNIVERSE_SIZE = 750;
export const RANK_WINDOW = 120;
export const MIN_TRADED = 108;
export const ETF_PATTERN = /(BEES|ETF|IETF)$|ETF|^(LIQUID|GOLD|SILVER)|NIFTY|SENSEX|NEXT50|MON100|MAFANG|MAHKTECH|^NV20|^CPSE|BHARAT22|ICICIB22|^SETF|LIQ$/;
export const EQUIVALENCE_PP = 5;
const TRACKED = new Set(["EQ", "BE", "BZ", "RR"]);

type Manifest = { kind: string; date: string; status: string; sha256?: string };

function readArchive(dir: string) {
  const lines = readFileSync(path.join(dir, "manifest.jsonl"), "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Manifest);
  const last = new Map<string, Manifest>();
  for (const e of lines) last.set(`${e.kind}|${e.date}`, e);
  const read = (e: Manifest) => {
    const raw = gunzipSync(readFileSync(path.join(dir, e.kind, e.date.slice(0, 4), `${e.date}.csv.gz`)));
    if (createHash("sha256").update(raw).digest("hex") !== e.sha256) throw new Error(`${e.kind} ${e.date}: sha256 mismatch - re-run history-validate.mts`);
    return raw.toString("utf-8");
  };
  const state = { archives: { index: {}, stocks: {} } } as unknown as RefreshState;
  const indexSeries: Record<string, IndexSeries> = {};
  const defs = [BENCHMARK, ...SECTOR_UNIVERSE, ...MARKET_CONTEXT_INDICES].map((d) => ({ slug: d.slug, nseIndexName: d.nseIndexName }));
  const stocks: Record<string, StockSeries> = {};
  const activity: Record<string, ActivityRow[]> = {};
  const eqTurnover = new Map<string, Map<string, number>>(); // date -> symbol -> TURNOVER_LACS (EQ rows)
  const everyone = { has: () => true } as unknown as Set<string>;
  const entries = [...last.values()].filter((e) => e.status === "ok").sort((a, b) => a.date.localeCompare(b.date));
  for (const e of entries) {
    if (EXCLUDED_SESSIONS.includes(e.date)) continue;
    let text = read(e);
    if (e.kind === "index") {
      // documented quirk (HISTORICAL_DATA.md): month-first "Index Date"; rewrite only when the swap is exactly the requested date
      const r = interpretArchive("index", text, e.date);
      const swapped = `${e.date.slice(0, 4)}-${e.date.slice(8, 10)}-${e.date.slice(5, 7)}`;
      if (r.kind === "later-session" && r.fileDate === swapped) text = text.split(`${e.date.slice(5, 7)}-${e.date.slice(8, 10)}-${e.date.slice(0, 4)}`).join(`${e.date.slice(8, 10)}-${e.date.slice(5, 7)}-${e.date.slice(0, 4)}`);
      ingestIndexOutcome(indexSeries, state, e.date, { kind: "ok", text, status: 200, attempts: 1, elapsedMs: 0 }, { defs, benchmarkIndexName: BENCHMARK.nseIndexName, checkedAt: "research" });
    } else {
      const ent = ingestStockOutcome(stocks, state, e.date, { kind: "ok", text, status: 200, attempts: 1, elapsedMs: 0 }, { requiredSymbols: everyone, trackedSeries: TRACKED, symbolSetHash: "research", expectedSymbols: 0, minCoverage: 0, checkedAt: "research", activity });
      if (ent.status !== "ok") continue;
      const t = new Map<string, number>();
      for (const row of parseCsvObjects(text)) if (row.SERIES === "EQ") t.set(row.SYMBOL, Number(row.TURNOVER_LACS));
      eqTurnover.set(e.date, t);
    }
  }
  for (const s of Object.values(indexSeries)) s.bars = finalizeBars(s.bars, "0000-00-00");
  for (const s of Object.values(stocks)) s.bars = finalizeBars(s.bars, "0000-00-00");
  for (const k of Object.keys(activity)) activity[k] = finalizeBars(activity[k], "0000-00-00");
  const calendar = indexSeries[BENCHMARK.slug].bars.map((b) => b.date);
  return { indexSeries, stocks, activity, eqTurnover, calendar };
}

export function isEtf(symbol: string, etfList: Set<string>, equityList: Set<string>): boolean {
  return etfList.has(symbol) || (!equityList.has(symbol) && ETF_PATTERN.test(symbol));
}

/** Semi-annual periods effective the first session of April / October; ranking window ends the last session of Feb / Aug. */
export function periods(calendar: string[]) {
  const out: Array<{ effective: string; windowEnd: string; window: string[] }> = [];
  const years = [...new Set(calendar.map((d) => Number(d.slice(0, 4))))];
  for (const y of years)
    for (const [effMonth, endMonth] of [["04", "02"], ["10", "08"]] as const) {
      const effective = calendar.find((d) => d >= `${y}-${effMonth}-01`);
      const ends = calendar.filter((d) => d < `${y}-${endMonth === "02" ? "03" : "09"}-01`);
      if (!effective || ends.length < RANK_WINDOW) continue;
      const windowEnd = ends[ends.length - 1];
      out.push({ effective, windowEnd, window: ends.slice(-RANK_WINDOW) });
    }
  return out.sort((a, b) => a.effective.localeCompare(b.effective));
}

export function rankUniverse(window: string[], eqTurnover: Map<string, Map<string, number>>, excluded: (s: string) => boolean): string[] {
  const per = new Map<string, number[]>();
  for (const d of window) for (const [s, t] of eqTurnover.get(d) ?? []) if (Number.isFinite(t)) (per.get(s) ?? per.set(s, []).get(s)!).push(t);
  const med = (xs: number[]) => {
    const a = [...xs].sort((p, q) => p - q);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  return [...per.entries()]
    .filter(([s, xs]) => xs.length >= MIN_TRADED && !excluded(s))
    .map(([s, xs]) => ({ s, m: med(xs) }))
    .sort((a, b) => b.m - a.m || a.s.localeCompare(b.s))
    .slice(0, UNIVERSE_SIZE)
    .map((x) => x.s);
}

/** Bootstrap difference keeping the replicate distribution (one-sided p). */
function diffDist(X: Row[], Y: Row[], S: number, h: H, metric: keyof typeof METRIC, boot: Boot) {
  const a = sums(X, S, (r) => METRIC[metric](r, h));
  const b = sums(Y, S, (r) => METRIC[metric](r, h));
  const d = diff(a, b, boot);
  const ds = boot.draws.map((dr) => {
    const p = ratio(a, dr);
    const q = ratio(b, dr);
    return p === null || q === null ? null : p - q;
  }).filter((x): x is number => x !== null);
  return { ...d, pLe0: ds.length ? ds.filter((x) => x <= 0).length / ds.length : null };
}
const halvesOf = (X: Row[], Y: Row[] | null, S: number, half: number, h: H, metric: keyof typeof METRIC) => {
  const part = (first: boolean) => {
    const keep = (r: Row) => (first ? r.s < half : r.s >= half);
    const a = ratio(sums(X.filter(keep), S, (r) => METRIC[metric](r, h)));
    if (!Y) return a;
    const b = ratio(sums(Y.filter(keep), S, (r) => METRIC[metric](r, h)));
    return a === null || b === null ? null : a - b;
  };
  return [part(true), part(false)] as [number | null, number | null];
};
const equivalence = (ci: [number, number] | null) => (!ci ? "inconclusive" : ci[0] >= -EQUIVALENCE_PP && ci[1] <= EQUIVALENCE_PP ? "replicated" : ci[0] > 0 || ci[1] < 0 ? "contradicted" : "inconclusive");

async function main() {
  const args = process.argv.slice(2);
  const opt = (n: string, d?: string) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const out = opt("--out");
  if (!out) throw new Error("--out <file.json> is required");
  if (path.resolve(out).startsWith(path.join(repoRoot, "public") + path.sep)) throw new Error("--out must not write under public/");
  const reps = Number(opt("--reps", "1000"));
  const signalsOnly = args.includes("--signals-only");
  const dir = path.resolve(repoRoot, opt("--dir", "research-data/nse")!);
  const { computeVersion } = await import("../ledger/capture.mts");
  const { ruleVersion } = await computeVersion(repoRoot);
  if (ruleVersion !== "mv1-8ecef864") throw new Error(`rule version ${ruleVersion}, expected mv1-8ecef864`);
  const t0 = Date.now();

  const arc = readArchive(dir);
  const ref = path.join(repoRoot, "research-data", "reference");
  const etfList = new Set(parseCsvObjects(readFileSync(path.join(ref, "eq_etfseclist.csv"), "utf-8")).map((r) => r.Symbol));
  const equityList = new Set(parseCsvObjects(readFileSync(path.join(ref, "EQUITY_L.csv"), "utf-8")).map((r) => r.SYMBOL));
  const today = JSON.parse(readFileSync(path.join(repoRoot, "public", "data", "constituents.json"), "utf-8")) as Record<string, SectorConstituents>;
  const industryOf = new Map<string, ConstituentRef>();
  for (const l of Object.values(today)) for (const c of l.constituents ?? []) if (!industryOf.has(c.symbol)) industryOf.set(c.symbol, c);
  const ref8 = (f: string) => createHash("sha256").update(readFileSync(path.join(ref, f))).digest("hex");
  if (!ref8("eq_etfseclist.csv").startsWith("c2b95e57") || !ref8("EQUITY_L.csv").startsWith("9df2b889")) throw new Error("reference lists differ from the frozen plan's hashes");

  const cal = arc.calendar;
  const firstObs = cal[MIN_PRIOR_SESSIONS];
  const lastObs = cal[cal.length - 11];
  const ps = periods(cal);
  const settings = structuredClone(DEFAULT_SETTINGS);
  const allRows: Row[] = [];
  const allSessions: string[] = [];
  const periodInfo: unknown[] = [];
  const manifest = { schemaVersion: 2, generatedAt: "research", latestMarketDate: cal[cal.length - 1], source: { name: "NSE archives (research)", indexDataUrl: "", constituentDataUrl: "", equityDataUrl: "" }, sectors: [], benchmark: BENCHMARK.slug, warnings: [] };
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k];
    const from = p.effective > firstObs ? p.effective : firstObs;
    const to = ps[k + 1]?.effective ?? "9999-12-31";
    if (to <= firstObs || from > lastObs) continue;
    const toCapped = to > lastObs ? cal[cal.indexOf(lastObs) + 1] : to;
    const members = rankUniverse(p.window, arc.eqTurnover, (s) => isEtf(s, etfList, equityList));
    const refOf = (s: string): ConstituentRef => industryOf.get(s) ?? { symbol: s, companyName: s, industry: `Unknown (${s})` };
    const list = (slug: string, a: number, b: number): SectorConstituents => ({ slug, constituents: members.slice(a, b).map(refOf) } as SectorConstituents);
    const constituents: Record<string, SectorConstituents> = { nifty500: list("nifty500", 0, 500), midcap150: list("midcap150", 100, 250), smallcap250: list("smallcap250", 250, 500), microcap250: list("microcap250", 500, 750) };
    for (const def of SECTOR_UNIVERSE) if (today[def.slug]) constituents[def.slug] = today[def.slug];
    const symbols = new Set([...members, ...SECTOR_UNIVERSE.flatMap((d) => (today[d.slug]?.constituents ?? []).map((c) => c.symbol))]);
    const stocks: Record<string, StockSeries> = {};
    const activity: Record<string, ActivityRow[]> = {};
    for (const s of symbols) if (arc.stocks[s]) (stocks[s] = arc.stocks[s]), (activity[s] = arc.activity[s] ?? []);
    const dataset = { manifest, indexSeries: arc.indexSeries, constituents, stocks } as unknown as RawDataset;
    const u = prepareUniverse(dataset, activity);
    const { rows, sessions } = buildRows(u, settings, FENCE, { from, to: toCapped });
    const offset = allSessions.length;
    for (const r of rows) r.s += offset;
    allRows.push(...rows);
    allSessions.push(...sessions);
    const known = members.filter((s) => industryOf.has(s)).length;
    periodInfo.push({ effective: p.effective, windowEnd: p.windowEnd, observed: [sessions[0], sessions[sessions.length - 1]], sessions: sessions.length, members: members.length, knownClassification: known, etfExcluded: [...new Set([...p.window.flatMap((d) => [...(arc.eqTurnover.get(d)?.keys() ?? [])])])].filter((s) => isEtf(s, etfList, equityList)).length });
    console.log(`period ${p.effective}: ${members.length} members (${known} with today's classification), ${sessions.length} sessions, ${rows.length} gainer rows`);
  }
  const S = allSessions.length;
  const half = Math.floor(S / 2);
  const BO_all = allRows.filter((r) => r.label === "possible-breakout");
  const RAW_BO = allRows.filter((r) => r.rawBreakout);
  const signals = {
    sessions: S,
    first: allSessions[0],
    last: allSessions[S - 1],
    gainerRows: allRows.length,
    perSession: { Aplus: allRows.length / S, B: allRows.filter((r) => r.rank <= 50).length / S, BO_all: BO_all.length / S, BO_top50: BO_all.filter((r) => r.rank <= 50).length / S, RAW_BO: RAW_BO.length / S },
    insufficientShare: allRows.filter((r) => r.label === "insufficient-evidence").length / allRows.length,
    noSectorIndexShare: allRows.filter((r) => r.f.sectorRs === "none").length / allRows.length,
    regimes: Object.fromEntries(["bullish", "sideways", "bearish", "insufficient-data"].map((g) => [g, new Set(allRows.filter((r) => r.regime === g).map((r) => r.s)).size])),
  };
  console.log(`rows ${allRows.length} over ${S} sessions (${signals.first}..${signals.last}) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const meta = { plan: PLAN, fence: FENCE, ruleVersion, reps, universe: { size: UNIVERSE_SIZE, window: RANK_WINDOW, minTraded: MIN_TRADED }, periods: periodInfo, firstObs, lastObs };
  if (signalsOnly) {
    writeFileSync(out, JSON.stringify({ meta, signals }, null, 1) + "\n");
    console.log(JSON.stringify(signals, null, 1));
    return;
  }

  const study = runStudy(allRows, allSessions, reps);
  const boot = new Boot(S, reps);
  const nonBear = (r: Row) => r.regime === "bullish" || r.regime === "sideways";
  const chg = (r: Row) => bucketOf(r.changePct, CHANGE_BUCKETS);
  const C = [
    { id: "C1", what: "BO_all h1 adverse, bearish - (bullish+sideways)", d: diffDist(BO_all.filter((r) => r.regime === "bearish"), BO_all.filter(nonBear), S, 1, "adverse", boot), halves: halvesOf(BO_all.filter((r) => r.regime === "bearish"), BO_all.filter(nonBear), S, half, 1, "adverse") },
    { id: "C2", what: "Aplus h1 adverse, bearish - (bullish+sideways)", d: diffDist(allRows.filter((r) => r.regime === "bearish"), allRows.filter(nonBear), S, 1, "adverse", boot), halves: halvesOf(allRows.filter((r) => r.regime === "bearish"), allRows.filter(nonBear), S, half, 1, "adverse") },
    { id: "C3", what: "BO_all h1 adverse, change >= 10 - change 0-2", d: diffDist(BO_all.filter((r) => chg(r) === 4), BO_all.filter((r) => chg(r) === 0), S, 1, "adverse", boot), halves: halvesOf(BO_all.filter((r) => chg(r) === 4), BO_all.filter((r) => chg(r) === 0), S, half, 1, "adverse") },
    // one-sided p = P(bootstrap diff <= 0) for C1-C3; P(bootstrap mean <= 0) for C4 below
  ].map((c) => ({ ...c, oneSidedP: c.d.pLe0 }));
  const rawX = sums(RAW_BO, S, (r) => METRIC.meanX(r, 10));
  const c4est = est(rawX, boot);
  const c4draws = boot.draws.map((dr) => ratio(rawX, dr)).filter((x): x is number => x !== null);
  const C4 = { id: "C4", what: "RAW_BO h10 mean X > 0", est: c4est, oneSidedP: c4draws.filter((x) => x <= 0).length / c4draws.length, halves: halvesOf(RAW_BO, null, S, half, 10, "meanX") };
  const pPass = bh([...C.map((c) => c.oneSidedP), C4.oneSidedP], 0.1);
  const verdictC = (point: number | null, halves: [number | null, number | null], pass: boolean) => (point !== null && point > 0 && pass && halves.every((x) => x !== null && x > 0) ? "replicated" : point !== null && point > 0 && pass ? "unstable (fails a half)" : "not replicated");
  const confirmatory = [...C.map((c, i) => ({ id: c.id, what: c.what, diff: c.d.d, ci: c.d.ci, n: [c.d.nX, c.d.nY], oneSidedP: c.oneSidedP, bhPass: pPass[i], halves: c.halves, verdict: verdictC(c.d.d, c.halves, pPass[i]) })), { id: "C4", what: C4.what, mean: C4.est.v, ci: C4.est.ci, n: C4.est.n, oneSidedP: C4.oneSidedP, bhPass: pPass[3], halves: C4.halves, verdict: verdictC(C4.est.v, C4.halves, pPass[3]) }];
  // all four horizons for C1-C3 (descriptive)
  const allH = Object.fromEntries(
    [
      ["C1", BO_all.filter((r) => r.regime === "bearish"), BO_all.filter(nonBear)],
      ["C2", allRows.filter((r) => r.regime === "bearish"), allRows.filter(nonBear)],
      ["C3", BO_all.filter((r) => chg(r) === 4), BO_all.filter((r) => chg(r) === 0)],
    ].map(([id, X, Y]) => [id as string, Object.fromEntries(HORIZONS.map((h) => [`h${h}`, diff(sums(X as Row[], S, (r) => METRIC.adverse(r, h)), sums(Y as Row[], S, (r) => METRIC.adverse(r, h)), boot)]))]),
  );
  const c4AllH = Object.fromEntries(HORIZONS.map((h) => [`h${h}`, est(sums(RAW_BO, S, (r) => METRIC.meanX(r, h)), boot)]));
  // E items
  const pairE = (name: string, X: Row[], Y: Row[]) => Object.fromEntries(HORIZONS.map((h) => [`h${h}`, diff(sums(X, S, (r) => METRIC.adverse(r, h)), sums(Y, S, (r) => METRIC.adverse(r, h)), boot)]));
  const E1 = pairE("BO_top50 - BO_out", BO_all.filter((r) => r.rank <= 50), BO_all.filter((r) => r.rank > 50));
  const E2 = pairE("BO_all - RAW_BO", BO_all, RAW_BO);
  const m1 = (study.matched.M1_change as Record<string, Record<string, { v: number | null; ci: [number, number] | null }>>);
  const hv = (study.exp3.matchedHighVsLow_B as Record<string, Record<string, { v: number | null; ci: [number, number] | null }>>);
  const equivalenceItems = [
    { id: "E1", what: "BO_top50 - BO_out adverse", h1: E1.h1, h5: E1.h5, verdict: [equivalence(E1.h1.ci), equivalence(E1.h5.ci)], allH: E1 },
    { id: "E2", what: "BO_all - RAW_BO adverse", h1: E2.h1, h5: E2.h5, verdict: [equivalence(E2.h1.ci), equivalence(E2.h5.ci)], allH: E2 },
    { id: "E3", what: "M1 matched effect (breakout - same session x change bucket non-breakout gainers), adverse", h1: m1.h1.adverse, verdict: [equivalence(m1.h1.adverse.ci)], allH: Object.fromEntries(HORIZONS.map((h) => [`h${h}`, m1[`h${h}`].adverse])) },
    { id: "E4", what: "high (>=3) - low (<=1) score top-50 gainers, same session x change bucket, adverse", h1: hv.h1.adverse, verdict: [equivalence(hv.h1.adverse.ci)], allH: Object.fromEntries(HORIZONS.map((h) => [`h${h}`, hv[`h${h}`].adverse])) },
  ];
  // D items
  const cons = BO_all.filter((r) => r.f.consolidating === true).length;
  const sectorBins = (study.exp2.sectorRs as { bins: Array<Record<string, unknown>> }).bins;
  const groupsD: Record<string, Row[]> = {
    Aplus: allRows, B: allRows.filter((r) => r.rank <= 50), BO_all, BO_top50: BO_all.filter((r) => r.rank <= 50), BO_out: BO_all.filter((r) => r.rank > 50), RAW_BO,
    "BO-wide": BO_all, "BO-raw": RAW_BO.filter((r) => r.changePct < 10 && typeof r.f.distRes === "number" && r.f.distRes < 7), "BO-cap10": BO_all.filter((r) => r.rank <= 50 && r.changePct < 10),
  };
  const tradable = Object.fromEntries(Object.entries(groupsD).map(([k, g]) => [k, Object.fromEntries(HORIZONS.map((h) => [`h${h}`, est(sums(g, S, (r) => METRIC.net20(r, h)), boot)]))]));
  const anyPositive = Object.values(tradable).some((g) => Object.values(g).some((e) => e.ci !== null && e.ci[0] > 0));
  const shadow = Object.fromEntries(["BO-wide", "BO-raw", "BO-cap10"].map((k) => [k, summarise(groupsD[k], S, boot)]));
  const descriptive = {
    D1: { consolidatingBreakouts: cons, breakouts: BO_all.length, sharePct: (100 * cons) / Math.max(1, BO_all.length) },
    D2: { sectorRsBins: sectorBins.map((b) => ({ label: b.label, stockDays: b.stockDays, ...Object.fromEntries(HORIZONS.map((h) => [`h${h}`, { adverse: (b[`h${h}`] as Record<string, { v: number | null }>).adverse.v, meanX: (b[`h${h}`] as Record<string, { v: number | null }>).meanX.v }])) })) },
    D3: { tradableNet20: tradable, verdict: anyPositive ? "contradicted (some group/horizon has a lower bound > 0)" : "replicated (no group/horizon has a positive lower bound)" },
  };
  const result = { meta, signals, confirmatory, confirmatoryAllHorizons: { ...allH, C4: c4AllH }, equivalence: equivalenceItems, descriptive, shadow, study };
  const digest = createHash("sha256").update(canonicalJson({ confirmatory, equivalence: equivalenceItems, D3: descriptive.D3.verdict, signals })).digest("hex");
  writeFileSync(out, JSON.stringify({ digest, ...result }, null, 1) + "\n");
  console.log(`result digest ${digest}; written ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  void BINS;
  void pctile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`::error::historical validation failed: ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  });
}
