/**
 * BL1: the constituent fingerprint covers EVERY constituent list the dashboard's universe code reads - the four main
 * lists AND every sector-index and context-index list - so a refresh of any of them is an explained
 * `existing-uncompared`, never a false permanent prediction anomaly.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadSource, runCapture, universeListIdentity, type CaptureSource } from "../../scripts/ledger/capture.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { SECTOR_UNIVERSE } from "../../src/config/sectorUniverse";
import { last, makeEnv, makeFixture, tmpDir, type Fixture } from "./fixture";

let tmp: Awaited<ReturnType<typeof tmpDir>>;
beforeAll(async () => (tmp = await tmpDir()));
afterAll(async () => tmp.cleanup());

const SECTOR = "healthcare"; // a real sector-index slug that the fixture has an index series for
const CONTEXT = "nifty50"; // the context index (MARKET_CONTEXT_INDICES)
const entry = (symbol: string) => ({ symbol, companyName: `${symbol} Ltd.`, industry: "Healthcare" });
const root = (n: string) => path.join(tmp.dir, n);
const sessionOf = (run: Awaited<ReturnType<typeof runCapture>>) => run.sessions.find((s) => s.date === last)!;
const setList = (f: Fixture, slug: string, symbols: string[], fetchedAt = "2026-10-01T00:00:00Z") => {
  f.source.dataset.constituents[slug] = { slug, constituents: symbols.map(entry), fetchedAt };
};

/**
 * Builds the first record from a dataset whose sector list and context list contain the stocks that end up in the pool,
 * so that membership in those lists really does change a stored prediction.
 */
async function recordWithSectorAndContextLists(name: string) {
  const r = root(name);
  const probe = await runCapture(makeFixture().source, await makeEnv(root(`${name}-probe`)));
  void probe;
  const probeDaily = JSON.parse(await readFile(ledgerPaths(root(`${name}-probe`)).dailyFile((await makeEnv(r)).ruleVersion, last), "utf-8"));
  const pool: string[] = probeDaily.predictions.map((p: { symbol: string }) => p.symbol);
  const sectorMembers = pool.slice(0, 6);
  const contextMembers = pool.slice(6, 12); // stocks that are in the context list but in no sector list
  const build = (over: (f: Fixture) => void = () => undefined) => {
    const f = makeFixture();
    setList(f, SECTOR, sectorMembers);
    setList(f, CONTEXT, contextMembers);
    over(f);
    return f;
  };
  const env = await makeEnv(r);
  await runCapture(build().source, env);
  const file = ledgerPaths(r).dailyFile(env.ruleVersion, last);
  return { r, env, file, before: await readFile(file, "utf-8"), sectorMembers, contextMembers, build };
}

describe("BL1: every constituent list is fingerprinted", () => {
  it("1. changing membership in a SECTOR index list is existing-uncompared (never a false anomaly) and the record is untouched", async () => {
    const x = await recordWithSectorAndContextLists("bl1-sector");
    const record = JSON.parse(x.before);
    expect(record.predictions.some((p: { sectorIndex: string | null }) => p.sectorIndex === SECTOR)).toBe(true); // the list really feeds the stored predictions
    const s = sessionOf(await runCapture(x.build((f) => setList(f, SECTOR, x.sectorMembers.slice(1), "2030-01-01T00:00:00Z")).source, await makeEnv(x.r, { now: new Date(`${last}T23:00:00Z`) })));
    expect(s.outcome).toBe("exists");
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.changedLists).toEqual([SECTOR]);
    expect(s.r6!.universe!.symbolSetChangedLists).toEqual([SECTOR]);
    expect(await readFile(x.file, "utf-8")).toBe(x.before);
  });

  it("2. changing membership in a CONTEXT index list is existing-uncompared", async () => {
    const x = await recordWithSectorAndContextLists("bl1-context");
    expect(JSON.parse(x.before).predictions.some((p: { sectorIndex: string | null }) => p.sectorIndex === CONTEXT)).toBe(true);
    const s = sessionOf(await runCapture(x.build((f) => setList(f, CONTEXT, x.contextMembers.slice(1), "2030-01-01T00:00:00Z")).source, await makeEnv(x.r)));
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.changedLists).toEqual([CONTEXT]);
  });

  it("3. a sector-only change is detected even though all four main lists are byte-for-byte unchanged", async () => {
    const x = await recordWithSectorAndContextLists("bl1-main-unchanged");
    const s = sessionOf(await runCapture(x.build((f) => setList(f, SECTOR, x.sectorMembers.slice(2))).source, await makeEnv(x.r)));
    const u = s.r6!.universe!;
    expect(u.changedLists).toEqual([SECTOR]);
    for (const main of ["nifty500", "midcap150", "smallcap250", "microcap250"]) expect(u.changedLists).not.toContain(main);
  });

  it("4. adding, removing or renaming a constituent-list key is detected", async () => {
    const x = await recordWithSectorAndContextLists("bl1-keys");
    const run = async (over: (f: Fixture) => void) => sessionOf(await runCapture(x.build(over).source, await makeEnv(x.r)));
    const added = await run((f) => setList(f, "brand-new-index", x.sectorMembers));
    expect(added.r6!.universe!.changedLists).toEqual(["brand-new-index"]);
    expect(added.r6!.status).not.toBe("anomaly");
    const removed = await run((f) => delete f.source.dataset.constituents[SECTOR]);
    expect(removed.r6!.universe!.changedLists).toEqual([SECTOR]);
    expect(removed.r6!.universe!.symbolSetChangedLists).toEqual([SECTOR]);
    expect(removed.r6!.status).not.toBe("anomaly");
    const renamed = await run((f) => {
      delete f.source.dataset.constituents[SECTOR];
      setList(f, "health-care", x.sectorMembers);
    });
    expect(renamed.r6!.universe!.changedLists).toEqual(["health-care", SECTOR].sort());
    expect(renamed.r6!.status).not.toBe("anomaly");
  });

  it("5. a metadata-only change (industry / company name) is distinguishable from a membership change", async () => {
    const x = await recordWithSectorAndContextLists("bl1-metadata");
    const meta = sessionOf(
      await runCapture(
        x.build((f) => {
          f.source.dataset.constituents[SECTOR].constituents[0].industry = "Relabelled Industry";
          f.source.dataset.constituents[SECTOR].constituents[1].companyName = "Renamed Co.";
        }).source,
        await makeEnv(x.r),
      ),
    );
    expect(meta.r6!.universe!.changedLists).toEqual([SECTOR]);
    expect(meta.r6!.universe!.symbolSetChangedLists).toEqual([]); // labels only: told apart from a membership change
    expect(meta.r6!.status).not.toBe("anomaly"); // (these labels of the sector list do not feed a stored prediction, so the digest is identical)
    // a label that DOES feed predictions (industry in the main universe list) changes the digest: explained, still labels only
    const feeds = sessionOf(await runCapture(x.build((f) => { f.source.dataset.constituents["nifty500"].constituents.find((c) => c.symbol === x.sectorMembers[0])!.industry = "Relabelled Industry"; }).source, await makeEnv(x.r)));
    expect(feeds.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(feeds.r6!.universe!.symbolSetChangedLists).toEqual([]);
    expect(feeds.r6!.detail).toMatch(/labels only/);
    const member = sessionOf(await runCapture(x.build((f) => setList(f, SECTOR, x.sectorMembers.slice(1))).source, await makeEnv(x.r)));
    expect(member.r6!.universe!.symbolSetChangedLists).toEqual([SECTOR]);
    expect(member.r6!.detail).toMatch(/membership changed in healthcare/);
  });

  it("6. a genuine prediction mismatch with unchanged constituent inputs is still an anomaly", async () => {
    const x = await recordWithSectorAndContextLists("bl1-genuine");
    const f = x.build();
    const st = f.stocks[0];
    const prev = st.bars[st.bars.length - 2].close;
    const c = prev * 1.099;
    st.bars[st.bars.length - 1] = { ...st.bars[st.bars.length - 1], open: prev, close: c, high: c * 1.001, low: prev * 0.999 };
    const s = sessionOf(await runCapture(f.source, await makeEnv(x.r)));
    expect(s.outcome).toBe("anomaly");
    expect(s.r6!.universe!.changedLists).toEqual([]);
    expect(await readFile(x.file, "utf-8")).toBe(x.before);
  });

  it("7. fingerprints are deterministic whatever the key order or entry order of the input", () => {
    const a = makeFixture();
    setList(a, SECTOR, ["B1", "A1", "C1"]);
    setList(a, CONTEXT, ["Z9", "Y9"]);
    const b = makeFixture();
    // same content, constituents inserted in a different key order and entries in a different order
    const reordered: typeof b.source.dataset.constituents = {};
    for (const k of Object.keys(a.source.dataset.constituents).reverse()) reordered[k] = { ...a.source.dataset.constituents[k], constituents: [...a.source.dataset.constituents[k].constituents].reverse().map((e) => ({ industry: e.industry, companyName: e.companyName, symbol: e.symbol })) };
    b.source.dataset.constituents = reordered;
    expect(Object.keys(a.source.dataset.constituents)).not.toEqual(Object.keys(b.source.dataset.constituents));
    expect(universeListIdentity(b.source.dataset)).toEqual(universeListIdentity(a.source.dataset));
    expect(universeListIdentity(a.source.dataset).map((l) => l.slug)).toEqual([...Object.keys(a.source.dataset.constituents)].sort());
  });
});

describe("BL1 on the real project data (the 2026-10-28 session that exposed it)", () => {
  let source: CaptureSource;
  beforeAll(async () => {
    source = await loadSource("public/data");
  }, 120_000);

  it("fingerprints every list present in the real constituents file, including all sector-index lists", () => {
    const ids = universeListIdentity(source.dataset);
    const slugs = ids.map((l) => l.slug);
    expect(slugs).toEqual(Object.keys(source.dataset.constituents).sort());
    for (const main of ["nifty500", "microcap250", "midcap150", "smallcap250"]) expect(slugs).toContain(main);
    for (const sector of SECTOR_UNIVERSE.filter((s) => source.dataset.constituents[s.slug])) expect(slugs, sector.slug).toContain(sector.slug);
    expect(slugs.length).toBeGreaterThanOrEqual(19);
  });

  it("removing APOLLOHOSP from the real healthcare list is now existing-uncompared / constituent-lists-refreshed, not an anomaly", async () => {
    const cal = source.dataset.indexSeries["nifty500"].bars.map((b) => b.date);
    const date = cal.includes("2026-10-28") ? "2026-10-28" : cal[cal.length - 2];
    const r = root("bl1-real");
    const env = await makeEnv(r, { enabledFrom: date });
    const first = (await runCapture(source, env)).sessions.find((s) => s.date === date)!;
    expect(first.outcome).toBe("recorded");
    const file = ledgerPaths(r).dailyFile(env.ruleVersion, date);
    const before = await readFile(file, "utf-8");
    const daily = JSON.parse(before);
    const victim = daily.predictions.find((p: { symbol: string; sectorIndex: string | null }) => p.sectorIndex)!; // a pool stock with a sector index (APOLLOHOSP / healthcare on the data of 2026-10-28)
    const slug = victim.sectorIndex as string;
    const changed = structuredClone(source);
    const list = changed.dataset.constituents[slug];
    const before20 = list.constituents.length;
    list.constituents = list.constituents.filter((c) => c.symbol !== victim.symbol);
    list.fetchedAt = "2030-01-01T00:00:00Z";
    expect(list.constituents.length).toBe(before20 - 1);
    const s = (await runCapture(changed, await makeEnv(r, { enabledFrom: date, now: new Date(Date.now() + 1000) }))).sessions.find((x) => x.date === date)!;
    expect(s.outcome, `${victim.symbol} removed from ${slug}`).toBe("exists");
    expect(s.r6).toMatchObject({ status: "existing-uncompared", reasonCode: "constituent-lists-refreshed" });
    expect(s.r6!.universe!.changedLists).toEqual([slug]);
    expect(s.r6!.universe!.symbolSetChangedLists).toEqual([slug]);
    expect(await readFile(file, "utf-8")).toBe(before); // the stored prediction is untouched
    // and with the real lists unchanged it is a normal successful comparison
    const same = (await runCapture(source, await makeEnv(r, { enabledFrom: date, now: new Date(Date.now() + 2000) }))).sessions.find((x) => x.date === date)!;
    expect(same.r6).toMatchObject({ status: "existing" });
  }, 280_000);
});
