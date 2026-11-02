/**
 * Deterministic synthetic market for the ledger tests: 500 NIFTY 500 stocks (150 midcap, 250 smallcap, 100 large),
 * 250 microcaps, all 20 tracked index series, volume rows and an "all archives ok" refresh state. Meets the nominal
 * list sizes so R5a passes, and produces a spread of gainers, losers and volume spikes on the last session.
 */
import { vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DailyBar } from "../../src/types/market";
import type { ActivityRow } from "../../src/types/activity";
import { activityFor, barsFrom, buildDataset, flatCloses, weekdays, type FixtureStock } from "../momentum/fixtures";
import { EXPECTED_INDEX_SLUGS } from "../../scripts/ledger/constants.mts";
import type { CaptureEnv, CaptureSource } from "../../scripts/ledger/capture.mts";
import { computeVersion } from "../../scripts/ledger/capture.mts";

// Many ledger tests start real processes (git, tsx, node). The default 5 s limit of a plain `npx vitest run` (and of IDE
// runs, which do not use vitest.ledger.config.ts) is too short on a busy machine, so the limit is set here for every file
// that imports this module - the result is the same whichever way the tests are started.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

export const N_SESSIONS = 90;
export const dates = weekdays("2025-06-02", N_SESSIONS);
export const last = dates[dates.length - 1];
export const prevDate = dates[dates.length - 2];

const INDUSTRIES = ["Capital Goods", "Healthcare", "Financial Services", "Power", "Chemicals"];

export interface Fixture {
  source: CaptureSource;
  stocks: FixtureStock[];
  activity: Record<string, ActivityRow[]>;
}

export function makeFixture(): Fixture {
  const bench = barsFrom(dates, flatCloses(N_SESSIONS, 1000, 0.002));
  const stocks: FixtureStock[] = [];
  const activity: Record<string, ActivityRow[]> = {};
  for (let i = 0; i < 750; i++) {
    const symbol = `S${String(i).padStart(3, "0")}`;
    const closes = flatCloses(N_SESSIONS, 100 + (i % 50), 0.01);
    const move = 1 + (((i * 37) % 101) - 50) / 500; // -10% .. +10% on the last session
    closes[N_SESSIONS - 1] = closes[N_SESSIONS - 2] * move;
    const bars: DailyBar[] = barsFrom(dates, closes);
    const list = i < 500 ? "nifty500" : "microcap250";
    const segment = i < 150 ? "midcap150" : i < 400 ? "smallcap250" : undefined;
    stocks.push({ symbol, bars, industry: INDUSTRIES[i % INDUSTRIES.length], list, segment });
    const rows = activityFor(dates, 100_000 + (i % 7) * 10_000);
    rows[rows.length - 1] = { ...rows[rows.length - 1], volume: rows[rows.length - 1].volume * (1 + (i % 10) / 2) };
    activity[symbol] = rows;
  }
  const others = EXPECTED_INDEX_SLUGS.filter((s) => s !== "nifty500");
  const indices = Object.fromEntries(others.map((slug, k) => [slug, { nseIndexName: `Index ${slug}`, bars: barsFrom(dates, flatCloses(N_SESSIONS, 500 + k * 10, 0.003)) }]));
  const dataset = buildDataset(bench, stocks, { indices });
  const entry = (d: string) => ({ status: "ok" as const, checkedAt: `${d}T14:00:00Z`, attempts: 1, symbolSetHash: "fixture" });
  const refreshState = { schemaVersion: 1 as const, archives: { index: Object.fromEntries(dates.map((d) => [d, entry(d)])), stocks: Object.fromEntries(dates.map((d) => [d, entry(d)])) } };
  return {
    stocks,
    activity,
    source: { dataset, activity, refreshState, files: ["stocks.json", "index-series.json", "stock-activity.json", "constituents.json"].map((name) => ({ name, bytes: 1, sha256: "0".repeat(64) })) },
  };
}

export async function tmpDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ledger-test-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

let cachedVersion: Awaited<ReturnType<typeof computeVersion>> | null = null;
export async function realVersion() {
  cachedVersion ??= await computeVersion(path.resolve("."));
  return cachedVersion;
}

export async function makeEnv(ledgerRoot: string, over: Partial<CaptureEnv> = {}): Promise<CaptureEnv> {
  const v = await realVersion();
  return {
    now: new Date(`${last}T20:30:00Z`),
    env: { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_RUN_NUMBER: "9", GITHUB_SHA: "abc", GITHUB_WORKFLOW: "Update NSE sector data", GITHUB_REF: "refs/heads/main" },
    ledgerRoot,
    ruleVersion: v.ruleVersion,
    ruleFiles: v.ruleFiles,
    enabledVersion: v.ruleVersion,
    enabledFrom: last,
    ...over,
  };
}

/** The same market as it stood one session earlier (the last session removed from every series). */
export function truncateLast(f: Fixture): Fixture {
  const cut = <T extends { date: string }>(xs: T[]) => xs.filter((x) => x.date !== last);
  const ds = f.source.dataset;
  for (const s of Object.values(ds.indexSeries)) s.bars = cut(s.bars);
  for (const s of Object.values(ds.stocks)) s.bars = cut(s.bars);
  for (const k of Object.keys(f.source.activity)) f.source.activity[k] = cut(f.source.activity[k]);
  delete f.source.refreshState.archives.index[last];
  delete f.source.refreshState.archives.stocks[last];
  ds.manifest.latestMarketDate = prevDate;
  if (ds.manifest.refresh) ds.manifest.refresh.latestDueDate = prevDate;
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers for receipt / guard / pre-commit tests
// ---------------------------------------------------------------------------------------------------------------
import { runCapture } from "../../scripts/ledger/capture.mts";
import { verifyReceipts, type ActivityPush, type GitOps } from "../../scripts/ledger/receipt.mts";

export const H = (c: string) => c.repeat(40).slice(0, 40);

/** Fake history: commit H("1") adds the file; push events are supplied by the test. */
export const fakeGitFor = (opts: { commitDate?: string } = {}): GitOps => {
  const order = [H("0"), H("1"), H("2")];
  return {
    firstAddingCommit: async () => H("1"),
    isAncestor: async (a, d) => order.includes(a) && order.includes(d) && order.indexOf(a) <= order.indexOf(d),
    commitDate: async () => opts.commitDate ?? `${last}T20:45:00Z`,
    isOnMain: async () => true,
  };
};

export const pushAt = (timestamp: string): ActivityPush => ({ id: 7, node_id: "n", timestamp, activity_type: "push", ref: "refs/heads/main", before: H("0"), after: H("1"), actor: { login: "github-actions[bot]" } });

/** Captures the fixture's last session into `root`, returning the rule version. */
export async function captureInto(root: string) {
  const f = makeFixture();
  const env = await makeEnv(root);
  const run = await runCapture(f.source, env);
  return { run, env, ruleVersion: env.ruleVersion, date: last };
}

/** Writes the receipt through the real verifier. `late` publishes after the next trading day's 09:00 IST cut-off. */
export async function receiptInto(root: string, ruleVersion: string, late: boolean) {
  let next = new Date(Date.parse(`${last}T00:00:00Z`) + 86_400_000);
  while ([0, 6].includes(next.getUTCDay())) next = new Date(next.getTime() + 86_400_000);
  const nextDay = next.toISOString().slice(0, 10);
  const ts = late ? `${nextDay}T10:00:00Z` : `${last}T21:00:00Z`;
  return verifyReceipts({ ledgerRoot: root, ruleVersion, now: new Date(`${nextDay}T12:00:00Z`), activity: { ok: true, pushes: [pushAt(ts)] }, git: fakeGitFor(), statuses: late ? { [nextDay]: "trading" } : {} });
}
