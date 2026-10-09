/**
 * Fetches official index-constituent lists from niftyindices.com
 * (https://niftyindices.com/IndexConstituent/<file>.csv), one per sector plus
 * the NIFTY 500 benchmark. These change rarely (index reconstitutions happen
 * a few times a year), so this script is meant to be run manually/periodically
 * rather than on every scheduled data refresh - re-run it after NSE announces
 * an index reconstitution.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BENCHMARK, SECTOR_UNIVERSE } from "../src/config/sectorUniverse.ts";
import { MARKET_CAP_SEGMENTS } from "../src/config/marketCapSegments.ts";
import type { SectorConstituents } from "../src/types/market.ts";
import { fetchText, mapWithConcurrency, sleep } from "./lib/http.mts";
import { parseCsvObjects } from "./lib/csv.mts";

const OUT_PATH = path.resolve("public/data/constituents.json");
// MARKET_CAP_SEGMENTS includes NIFTY 500 again (as the self-benchmark entry) -
// excluded here since it's already covered by BENCHMARK, same slug/file.
const NEW_SEGMENT_DEFS = MARKET_CAP_SEGMENTS.filter((s) => s.slug !== BENCHMARK.slug);
const ALL_DEFS = [BENCHMARK, ...SECTOR_UNIVERSE, ...NEW_SEGMENT_DEFS];

async function loadExisting(): Promise<Record<string, SectorConstituents>> {
  try {
    return JSON.parse(await readFile(OUT_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function main() {
  const now = new Date().toISOString();
  const result = await loadExisting();
  const failures: string[] = [];

  await mapWithConcurrency(ALL_DEFS, 1, async (def) => {
    await sleep(300); // be polite to niftyindices.com - this is a low-frequency, manually-run script
    const url = `https://niftyindices.com/IndexConstituent/${def.constituentFile}`;
    try {
      const text = await fetchText(url, { timeoutMs: 20_000, retries: 4 });
      const rows = parseCsvObjects(text);

      if (rows.length === 0 || !rows[0]["Symbol"]) {
        throw new Error(`Unexpected constituent CSV shape for ${def.slug} at ${url}`);
      }

      result[def.slug] = {
        slug: def.slug,
        constituents: rows
          .filter((r) => r["Symbol"])
          .map((r) => ({
            symbol: r["Symbol"].trim(),
            companyName: r["Company Name"]?.trim() ?? "",
            industry: r["Industry"]?.trim() || "Unclassified",
          })),
        fetchedAt: now,
      };
      console.log(`[constituents] ${def.slug}: ${result[def.slug].constituents.length} constituents`);
    } catch (err) {
      failures.push(def.slug);
      console.warn(`[constituents] FAILED ${def.slug}: ${String(err)}`);
    }
  });

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(result, null, 2));
  console.log(`[constituents] wrote ${OUT_PATH} (${Object.keys(result).length}/${ALL_DEFS.length} sectors)`);
  if (failures.length > 0) {
    console.warn(`[constituents] FAILED sectors (re-run this script to retry just these): ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
