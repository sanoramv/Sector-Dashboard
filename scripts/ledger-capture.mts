/**
 * Live prediction capture (Phase A1). Run by update-data.yml after the manifest is built.
 *   --ledger-root <dir>   where ledger files live (default public/data/ledger)
 *   --data-dir <dir>      published data directory (default public/data)
 *   --slot <label>        scheduled slot label recorded in the state
 *   --dry-run             evaluate and report; write nothing
 * Exit 0 unless the run itself crashed; the final gate decides whether the workflow turns red.
 */
import path from "node:path";
import { cleanPartials } from "./ledger/files.mts";
import { computeVersion, directorySize, loadCalendarOverrides, loadEnabledVersion, loadSource, runCapture } from "./ledger/capture.mts";
import { dateStatuses } from "./ledger/calendar.mts";
import { applyCaptureToState, ledgerRootFrom, parseArgs, resolveRepoRoot, writeManifestSupplement } from "./ledger/run.mts";
import { ledgerPaths } from "./ledger/constants.mts";
import { loadLedgerState, saveLedgerState } from "./ledger/state.mts";
import { targetDates } from "./lib/refresh-state.mts";

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
const ledgerRoot = path.resolve(repoRoot, ledgerRootFrom(args));
const dataDir = path.resolve(repoRoot, typeof args["data-dir"] === "string" ? (args["data-dir"] as string) : "public/data");
const dryRun = args["dry-run"] === true;
const slot = typeof args.slot === "string" ? (args.slot as string) : null;
const startedAt = new Date();
const paths = ledgerPaths(ledgerRoot);

const state = await loadLedgerState(paths.state, startedAt.toISOString());
try {
  if (!dryRun) await cleanPartials(ledgerRoot);
  const [source, version, enabled, overrides] = await Promise.all([loadSource(dataDir), computeVersion(repoRoot), loadEnabledVersion(ledgerRoot), loadCalendarOverrides(ledgerRoot)]);
  void overrides;
  const run = await runCapture(source, {
    now: startedAt,
    env: process.env,
    ledgerRoot,
    ruleVersion: version.ruleVersion,
    ruleFiles: version.ruleFiles,
    enabledVersion: enabled?.ruleVersion ?? null,
    enabledFrom: enabled?.enabledFrom ?? null,
  });
  const nowIso = new Date().toISOString();
  state.calendar = { ...state.calendar, ...dateStatuses(source.refreshState, targetDates(new Date(), 1)[0] ?? null) };
  const status = applyCaptureToState(state, run, { now: nowIso, slot, ruleVersion: version.ruleVersion, enabledVersion: enabled?.ruleVersion ?? null, enabledFrom: enabled?.enabledFrom ?? null, startedAt: startedAt.toISOString(), captureSeconds: (Date.now() - startedAt.getTime()) / 1000 });
  const recorded = run.sessions.find((s) => s.outcome === "recorded");
  state.metrics.dailyFileBytes = recorded?.bytes ?? state.metrics.dailyFileBytes;
  state.metrics.ledgerBytes = await directorySize(ledgerRoot);
  state.metrics.publicDataBytes = await directorySize(dataDir);
  for (const s of run.sessions) {
    console.log(`${s.date}: ${s.outcome}${s.predictionCount ? ` (${s.predictionCount} stocks, ${s.bytes} bytes)` : ""}`);
    for (const r of s.reasons) console.log(`  - ${r}`);
    for (const w of s.warnings) console.log(`  ::warning::${w}`);
  }
  console.log(`R10: ${run.r10.reason}`);
  console.log(`rule version ${version.ruleVersion}; enabled ${enabled?.ruleVersion ?? "none"}; run status ${status}${dryRun ? " (dry run, nothing written)" : ""}`);
  if (!dryRun) {
    await saveLedgerState(paths.state, state);
    if (args["no-manifest"] !== true) await writeManifestSupplement(path.join(dataDir, "manifest.json"), state);
  }
} catch (err) {
  console.error(`::error::ledger capture crashed: ${String(err)}`);
  state.runStatus = "error";
  state.lastAttemptAt = startedAt.toISOString();
  state.updatedAt = new Date().toISOString();
  state.lastFailure = { at: state.updatedAt, date: null, reasons: [String(err)] };
  if (!dryRun) await saveLedgerState(paths.state, state).catch(() => undefined);
  process.exit(1);
}
