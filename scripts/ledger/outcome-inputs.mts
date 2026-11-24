/**
 * Input loading for the outcome runner: reads prediction files, prediction receipts and market-data files in their
 * PUBLISHED formats from a ledger root and a data directory (normally the repository's public/data).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { sha256Hex } from "./canonical.mts";
import type { RefreshState } from "../lib/refresh-state.mts";
import type { RunnerMarket, RunnerSession } from "./outcome-runner.mts";
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

export async function loadRunnerMarket(dataDir: string, opts: { commit: string }): Promise<RunnerMarket> {
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
