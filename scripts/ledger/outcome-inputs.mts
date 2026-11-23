/**
 * Input loading for the outcome runner (Phase B2a): reads prediction files, prediction receipts and market-data
 * archives in their PUBLISHED formats from a given directory. While the runner is synthetic-only, file names dated
 * before 2031 are refused BEFORE they are read, and the repository's own public/data directory is refused, so no real
 * outcome input can be loaded by this code.
 */
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./canonical.mts";
import type { RefreshState } from "../lib/refresh-state.mts";
import { SYNTHETIC_ONLY, assertSyntheticSession, type RunnerMarket, type RunnerSession } from "./outcome-runner.mts";
import { listTree } from "./safe-path.mts";

/** Repository-relative prefix recorded in records and receipts as the prediction file's public path. */
export const PUBLIC_LEDGER_PREFIX = "public/data/ledger";

export async function loadRunnerSessions(ledgerRoot: string, ruleVersion: string): Promise<RunnerSession[]> {
  const dir = `live/predictions/${ruleVersion}`;
  const out: RunnerSession[] = [];
  for (const rel of await listTree(ledgerRoot, dir)) {
    const m = rel.match(/\/(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    const date = m[1];
    assertSyntheticSession(date); // before reading anything
    const buf = await readFile(path.join(ledgerRoot, rel));
    let receipt: RunnerSession["receipt"] = null;
    try {
      const rb = await readFile(path.join(ledgerRoot, "live", "receipts", `${date}.json`));
      receipt = { file: `${PUBLIC_LEDGER_PREFIX}/live/receipts/${date}.json`, fileSha256: sha256Hex(rb), class: String((JSON.parse(rb.toString("utf-8")) as { class?: string }).class) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    out.push({ daily: JSON.parse(buf.toString("utf-8")), dailyFile: `${PUBLIC_LEDGER_PREFIX}/${rel}`, dailyFileSha256: sha256Hex(buf), receipt });
  }
  return out;
}

export async function loadRunnerMarket(dataDir: string, opts: { repoRoot: string; commit: string }): Promise<RunnerMarket> {
  if (SYNTHETIC_ONLY) {
    const real = await realpath(dataDir);
    const repoData = await realpath(path.join(opts.repoRoot, "public", "data")).catch(() => null);
    if (repoData && (real === repoData || real.startsWith(repoData + path.sep))) throw new Error("Phase B2a is synthetic-only: the repository's real market data is refused");
  }
  const files: Array<{ name: string; sha256: string }> = [];
  const read = async (name: string) => {
    const buf = await readFile(path.join(dataDir, name));
    files.push({ name, sha256: sha256Hex(buf) });
    return JSON.parse(buf.toString("utf-8"));
  };
  const indexSeries = await read("index-series.json");
  const stocks = await read("stocks.json");
  const refreshState = (await read("refresh-state.json")) as RefreshState;
  const manifest = await read("manifest.json");
  return { indexSeries, stocks, refreshState, latestDueDate: manifest?.refresh?.latestDueDate ?? null, data: { commit: opts.commit, files } };
}
