/**
 * Tests on the REAL published dataset (public/data as committed). Nothing is invented: the assertions are structural
 * or compare the ledger with the application's own calculation on the same data, so they hold as the data advances.
 * Nothing here backfills: capture runs into a temporary ledger and never touches public/data.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareUniverse } from "../../src/lib/momentum/universe";
import { discover, moversOn } from "../../src/lib/momentum/discovery";
import { marketContextAt } from "../../src/lib/momentum/market";
import { DEFAULT_SETTINGS } from "../../src/types/config";
import { loadSource, runCapture } from "../../scripts/ledger/capture.mts";
import { buildExcludedEvidence } from "../../scripts/ledger/record.mts";
import { checkR11 } from "../../scripts/ledger/readiness.mts";
import { validateDaily } from "../../scripts/ledger/validate.mts";
import { ledgerPaths, POOL } from "../../scripts/ledger/constants.mts";
import { makeEnv, tmpDir } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
let source: Awaited<ReturnType<typeof loadSource>>;
beforeAll(async () => {
  tmp = await tmpDir();
  source = await loadSource("public/data");
}, 120_000);
afterAll(async () => tmp.cleanup());

describe("real committed data", () => {
  it("captures recent real sessions into a temporary ledger; every record is schema-valid and equals the application's own result", async () => {
    const u = prepareUniverse(source.dataset, source.activity);
    const from = u.calendar[u.calendar.length - 6];
    const root = path.join(tmp.dir, "real");
    const env = await makeEnv(root, { enabledFrom: from, now: new Date() });
    const run = await runCapture(source, env);
    const recorded = run.sessions.filter((s) => s.outcome === "recorded");
    expect(recorded.length, `outcomes: ${run.sessions.map((s) => `${s.date}:${s.outcome}`).join(",")}`).toBeGreaterThan(0);
    for (const s of run.sessions) if (s.outcome !== "recorded") expect(s.reasons.length, s.date).toBeGreaterThan(0); // every non-capture is explained
    for (const s of recorded) {
      const daily = JSON.parse(await readFile(ledgerPaths(root).dailyFile(env.ruleVersion, s.date), "utf-8"));
      expect(validateDaily(daily, { date: s.date, ruleVersion: env.ruleVersion })).toEqual([]);
      // parity with the existing MomentumCandidate calculation on the same data
      const market = marketContextAt(u, s.date, DEFAULT_SETTINGS);
      const d = discover(u, s.date, DEFAULT_SETTINGS, market.regime.regime, POOL.gainers);
      expect(daily.header.lists.gainer).toEqual(d.gainers.map((c) => c.symbol));
      expect(daily.header.lists.loser).toEqual(d.losers.map((c) => c.symbol));
      expect(daily.header.lists.volume).toEqual(d.volumeMovers.map((c) => c.symbol));
      const bySymbol = new Map(daily.predictions.map((p: { symbol: string }) => [p.symbol, p]));
      for (const c of [...d.gainers, ...d.losers, ...d.volumeMovers]) {
        const p = bySymbol.get(c.symbol) as { lists: { netScore: number; setup: string }[]; classification?: { label?: string } };
        expect(p, c.symbol).toBeDefined();
        expect(p.lists.some((l) => l.netScore === c.assessment.total && l.setup === c.label), c.symbol).toBe(true);
      }
      expect(daily.header.market.regime).toBe(market.regime.regime);
    }
  }, 180_000);

  it("R11 never flags a historical session in the committed data before 2026-10-29 (the design's historical check)", async () => {
    const u = prepareUniverse(source.dataset, source.activity);
    const flagged: string[] = [];
    const counts = new Map<string, number>();
    for (const date of u.calendar.filter((d) => d <= "2026-10-29")) {
      const day = moversOn(u, date);
      const r = checkR11(buildExcludedEvidence(u, day.excluded, date));
      const n = (r.observed as { breakStarts: number }).breakStarts;
      counts.set(date, n);
      if (r.disposition === "flag") flagged.push(`${date} (${n})`);
    }
    expect(flagged).toEqual([]);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    expect(counts.size).toBeGreaterThan(250);
    // The four two-event sessions listed in the design (Revision 4 section 10.5): both stocks are recorded, no flag.
    const named: Record<string, string[]> = { "2025-09-22": ["ADANIPOWER", "SANDUMA"], "2025-09-23": ["PIDILITIND", "TIMETECHNO"], "2025-10-14": ["TATAINVEST", "GOKULAGRO"], "2025-12-05": ["CAMS", "HCC"] };
    for (const [date, symbols] of Object.entries(named)) {
      const ev = buildExcludedEvidence(u, moversOn(u, date).excluded, date).filter((e) => e.reason !== "first-bar-in-history");
      expect(ev.map((e) => e.symbol).sort(), date).toEqual([...symbols].sort());
      expect(checkR11(ev).disposition, date).not.toBe("flag");
    }
  }, 120_000);

  it("truncation invariance on REAL data: a session's predictions are identical whether or not later bars exist", async () => {
    const u = prepareUniverse(source.dataset, source.activity);
    const candidates = u.calendar.slice(-7, -1); // sessions that have at least one later session in the data
    let compared = 0;
    for (const date of candidates) {
      const cut = structuredClone(source);
      const upTo = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date <= date);
      for (const sr of Object.values(cut.dataset.indexSeries)) sr.bars = upTo(sr.bars);
      for (const sr of Object.values(cut.dataset.stocks)) sr.bars = upTo(sr.bars);
      for (const k of Object.keys(cut.activity)) cut.activity[k] = upTo(cut.activity[k]);
      for (const d of Object.keys(cut.refreshState.archives.index)) if (d > date) delete cut.refreshState.archives.index[d];
      for (const d of Object.keys(cut.refreshState.archives.stocks)) if (d > date) delete cut.refreshState.archives.stocks[d];
      cut.dataset.manifest.latestMarketDate = date;
      if (cut.dataset.manifest.refresh) cut.dataset.manifest.refresh = { ...cut.dataset.manifest.refresh, outcome: "complete", tradingDaysBehind: 0 };
      const rootCut = path.join(tmp.dir, `trunc-cut-${date}`);
      const rootFull = path.join(tmp.dir, `trunc-full-${date}`);
      const envCut = await makeEnv(rootCut, { enabledFrom: date });
      const envFull = await makeEnv(rootFull, { enabledFrom: date });
      const a = (await runCapture(cut, envCut)).sessions.find((x) => x.date === date)!;
      const b = (await runCapture(source, envFull)).sessions.find((x) => x.date === date)!;
      if (a.outcome !== "recorded" || b.outcome !== "recorded") continue; // not capturable on real data for an unrelated reason: say nothing about invariance
      const da = JSON.parse(await readFile(ledgerPaths(rootCut).dailyFile(envCut.ruleVersion, date), "utf-8"));
      const db = JSON.parse(await readFile(ledgerPaths(rootFull).dailyFile(envFull.ruleVersion, date), "utf-8"));
      expect(da.header.predictionsSha256, date).toBe(db.header.predictionsSha256);
      expect(da.predictions, date).toEqual(db.predictions);
      compared += 1;
    }
    expect(compared, "at least two real sessions must have been comparable").toBeGreaterThanOrEqual(2);
  }, 280_000);
});

