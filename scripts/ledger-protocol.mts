/**
 * Governance records, all create-only.
 *   npm run ledger:protocol                      create protocol/od1.json and the sealed holdout.json if absent
 *   npm run ledger:enable -- --from YYYY-MM-DD   enable the CURRENT rule version from that session date
 * Enabling is a deliberate human act: until a version record exists, capture writes nothing.
 */
import path from "node:path";
import { createOnly } from "./ledger/files.mts";
import { buildHoldoutFile, buildOd1File } from "./ledger/protocol.mts";
import { computeVersion } from "./ledger/capture.mts";
import { ledgerPaths } from "./ledger/constants.mts";
import { ledgerRootFrom, parseArgs, resolveRepoRoot } from "./ledger/run.mts";
import { readFile } from "node:fs/promises";
import { checkEnableDate } from "./ledger/enable.mts";
import { dateStatuses } from "./ledger/calendar.mts";
import { listFiles } from "./ledger/files.mts";
import { loadCalendarOverrides } from "./ledger/capture.mts";
import { targetDates, type RefreshState } from "./lib/refresh-state.mts";
import { VERSION_KIND, validateVersionRecord } from "./ledger/validate.mts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runGit = async (cwd: string, a: string[]): Promise<string> => (await promisify(execFile)("git", a, { cwd })).stdout;

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolveRepoRoot(args);
const paths = ledgerPaths(path.resolve(repoRoot, ledgerRootFrom(args)));

if (typeof args.from === "string") {
  const refuse = (reason: string): never => {
    console.error(`::error::ledger:enable refused: ${reason}`);
    process.exit(1);
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from)) refuse(`--from ${JSON.stringify(args.from)} must be a YYYY-MM-DD session date.`);
  // Phase A1 permits exactly one activation date: the next eligible, not-yet-captured session. No override exists.
  const dataDir = path.resolve(repoRoot, typeof args["data-dir"] === "string" ? (args["data-dir"] as string) : "public/data");
  // The clock is the real clock. (Tests run this CLI in a sandbox with NODE_ENV=test and may fix it.)
  const now = process.env.NODE_ENV === "test" && process.env.LEDGER_TEST_NOW ? new Date(process.env.LEDGER_TEST_NOW) : new Date();
  let latestMarketDate: string | null = null;
  let statuses = {} as ReturnType<typeof dateStatuses>;
  try {
    latestMarketDate = (JSON.parse(await readFile(path.join(dataDir, "manifest.json"), "utf-8")) as { latestMarketDate?: string }).latestMarketDate ?? null;
    statuses = dateStatuses(JSON.parse(await readFile(path.join(dataDir, "refresh-state.json"), "utf-8")) as RefreshState, targetDates(now, 1)[0] ?? null);
  } catch (err) {
    refuse(`Cannot read the published market data (${String(err)}).`);
  }
  // 1. Existing version records must all be valid: a hand-made or backdated record is refused, not built on.
  const { readdir } = await import("node:fs/promises");
  for (const name of await readdir(paths.versionsDir).catch(() => [] as string[])) {
    let rec: unknown = null;
    try {
      rec = JSON.parse(await readFile(path.join(paths.versionsDir, name), "utf-8"));
    } catch (err) {
      refuse(`Existing version record ${name} is unreadable (${String(err)}).`);
    }
    const problems = validateVersionRecord(name, rec);
    if (problems.length) refuse(`Existing version record ${name} is invalid: ${problems.join("; ")}.`);
  }
  // 2. The local checkout must not be behind the remote (a stale checkout could enable an already-published session).
  try {
    await runGit(repoRoot, ["fetch", "--quiet", "origin", "main"]);
    const behind = (await runGit(repoRoot, ["rev-list", "--count", "HEAD..origin/main"])).trim();
    if (behind !== "0") refuse(`This checkout is ${behind} commit(s) behind origin/main. Pull first so the published market date is current.`);
  } catch (err) {
    refuse(`Could not confirm that this checkout is up to date with origin/main (${String(err).split("\n")[0]}).`);
  }
  const captured = new Set<string>();
  const predRoot = path.dirname(paths.predictionsDir("x"));
  for (const dir of await readdir(predRoot).catch(() => [] as string[])) for (const f of await listFiles(path.join(predRoot, dir))) captured.add(f.replace(/\.json$/, ""));
  const decision = checkEnableDate(args.from, { latestMarketDate, statuses, overrides: await loadCalendarOverrides(path.resolve(repoRoot, ledgerRootFrom(args))), capturedDates: captured, dueDates: targetDates(now, 14) });
  if (!decision.ok) refuse(decision.reason);
  const { ruleVersion } = await computeVersion(repoRoot);
  // Shown BEFORE anything is written. The CLI never pushes for you.
  console.log(`
==================================================================================
READ THIS BEFORE THE ENABLE RECORD IS WRITTEN  (rule version ${ruleVersion}, enabled from ${args.from})
 1. Commit ONLY the new record file and push it IMMEDIATELY - within minutes, not hours.
 2. The scheduled update-data run that captures ${args.from} must NOT publish ${args.from}'s market data before this
    record reaches the default branch (main). If that data is committed first, this record becomes permanently invalid
    (the guard compares it with the market data of the commit it follows) and the first session is lost.
 3. If your push is REJECTED, do NOT rebase blindly. First look at public/data/manifest.json on origin/main:
    if its latestMarketDate is ${args.from} or later, this record is no longer valid - do not push it; delete it and
    enable the next session instead. If it is earlier, pull with rebase and push. Then run:  npm run ledger:guard
 4. Do not change any rule file, setting or constant between now and the push: the record is bound to ${ruleVersion}.
==================================================================================
`);
  const res = await createOnly(paths.versionRecord(ruleVersion), JSON.stringify({ kind: VERSION_KIND, schemaVersion: 1, ruleVersion, enabledFrom: args.from, latestMarketDateAtEnable: latestMarketDate, reason: typeof args.reason === "string" ? args.reason : "Phase A1 initial enablement" }, null, 1) + "\n");
  console.log(res.created ? `enabled ${ruleVersion} from ${args.from}` : `version record for ${ruleVersion} already exists (${res.existing}); left untouched`);
} else {
  const od1 = await createOnly(paths.protocolOd1, JSON.stringify(buildOd1File(), null, 1) + "\n");
  const ho = await createOnly(paths.holdout, JSON.stringify(buildHoldoutFile(), null, 1) + "\n");
  console.log(`od1.json: ${od1.created ? "created" : "exists"}; holdout.json: ${ho.created ? "created" : "exists"}`);
}
