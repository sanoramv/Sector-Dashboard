/**
 * Publication receipts (design §8.5). For every captured date without a receipt, find the server-side
 * repository-activity push event that published it and classify it live / live-late / unverified.
 * Needs a full-history checkout. A missing or inaccessible event => unverified, never live.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fetchPushActivity, realGit, verifyReceipts, type FetchLike } from "./ledger/receipt.mts";
import { computeVersion, loadCalendarOverrides } from "./ledger/capture.mts";
import { dateStatuses } from "./ledger/calendar.mts";
import { ledgerRootFrom, applyVerificationToState, parseArgs, resolveRepoRoot, writeManifestSupplement } from "./ledger/run.mts";
import { ledgerPaths } from "./ledger/constants.mts";
import { loadLedgerState, saveLedgerState } from "./ledger/state.mts";
import { targetDates, type RefreshState } from "./lib/refresh-state.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
const ledgerRoot = path.resolve(repoRoot, ledgerRootFrom(args));
const paths = ledgerPaths(ledgerRoot);
const now = new Date();
const state = await loadLedgerState(paths.state, now.toISOString());
const version = state.enabledVersion ?? (await computeVersion(repoRoot)).ruleVersion;
const refresh = JSON.parse(await readFile(path.join(repoRoot, "public/data/refresh-state.json"), "utf-8")) as RefreshState;
const statuses = dateStatuses(refresh, targetDates(now, 1)[0] ?? null);
const repo = process.env.GITHUB_REPOSITORY ?? "";
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? null;

const activity = repo ? await fetchPushActivity(fetch as unknown as FetchLike, repo, token) : ({ ok: false, reason: "GITHUB_REPOSITORY is not set" } as const);
if (!activity.ok) console.log(`::warning::repository-activity events unavailable (${activity.reason}); affected captures stay unverified.`);

const outcomes = await verifyReceipts({ ledgerRoot, ruleVersion: version, now, activity, git: realGit(repoRoot), statuses, overrides: await loadCalendarOverrides(ledgerRoot) });
for (const o of outcomes) console.log(`${o.date}: ${o.result} (${o.class})${o.reasons[0] ? ` - ${o.reasons[0]}` : ""}`);
applyVerificationToState(state, outcomes, now.toISOString());
state.updatedAt = now.toISOString();
await saveLedgerState(paths.state, state);
if (args["no-manifest"] !== true) await writeManifestSupplement(path.join(repoRoot, "public/data/manifest.json"), state);
