/**
 * Guard checks for the open outcome store (continuous-monitoring policy, erratum 23). Read-only.
 *
 *  - the evaluation policy, if present, is valid;
 *  - every file under data/outcomes is a record `od1/<rv>/<date>/h<h>.json` or an append-only correction /
 *    replacement; no leftover partial files;
 *  - every record is valid (re-derives from its stored inputs), matches its path, is bound to its immutable prediction
 *    file, and belongs to an eligible, non-excluded session on or after the policy's outcomesFrom;
 *  - committed history never modified, deleted or renamed a file under data/outcomes (create-only).
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { validateEvaluationPolicy, validateOutcomeRecord, type DailyLike } from "./outcomes.mts";
import { od1DefinitionsSha256 } from "./protocol.mts";
import type { GuardGit, Violation } from "./guard.mts";

export const OUTCOME_STORE_REL = "data/outcomes";
const FILE = /^od1\/(mv\d+-[0-9a-f]{8})\/(\d{4}-\d{2}-\d{2})\/h(1|2|5|10)(\.json|\.correction-\d+\.json|\.replacement-\d+\.json)$/;

async function walk(dir: string, rel = ""): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, rel), { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: string[] = [];
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(dir, r)));
    else out.push(r);
  }
  return out;
}

/** The repository root for a ledger root of the form <repo>/public/data/ledger. */
export const repoRootOf = (ledgerRoot: string) => path.resolve(ledgerRoot, "..", "..", "..");

export async function checkOutcomeStore(git: GuardGit | null, ledgerRoot: string, eligible: ReadonlySet<string> | null): Promise<Violation[]> {
  const v: Violation[] = [];
  const add = (p: string, detail: string) => v.push({ kind: "outcome", path: p, detail });
  let policy: any = null;
  const policyFile = path.join(ledgerRoot, "protocol", "evaluation-policy.json");
  try {
    policy = JSON.parse(await readFile(policyFile, "utf-8"));
    for (const p of validateEvaluationPolicy(policy)) add(policyFile, p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") add(policyFile, `unreadable evaluation policy: ${String(err).slice(0, 100)}`);
    policy = null;
  }
  const root = path.join(repoRootOf(ledgerRoot), OUTCOME_STORE_REL);
  const files = await walk(root);
  if (files.length && !policy) add(root, "outcome records exist but there is no evaluation policy authorising them");
  const excluded = new Set<string>((policy?.excludedSessions ?? []).map((e: { sessionDate: string }) => e.sessionDate));
  const DEFS = od1DefinitionsSha256();
  for (const f of files) {
    const abs = path.join(root, f);
    if (f.endsWith(".partial")) {
      add(abs, "leftover partial file");
      continue;
    }
    const m = f.match(FILE);
    if (!m) {
      add(abs, "unexpected file in the outcome store");
      continue;
    }
    const [, rv, date, hs, ext] = m;
    if (ext !== ".json") continue; // corrections are validated by the store when they are appended
    let rec: any;
    try {
      rec = JSON.parse(await readFile(abs, "utf-8"));
    } catch {
      add(abs, "not valid JSON");
      continue;
    }
    let daily: DailyLike | undefined;
    try {
      daily = JSON.parse(await readFile(path.join(ledgerRoot, "live", "predictions", rv, `${date}.json`), "utf-8"));
    } catch {
      add(abs, "the record names a prediction file that does not exist");
    }
    for (const p of validateOutcomeRecord(rec, { definitionsSha256: DEFS, daily })) add(abs, p);
    if (rec?.header?.ruleVersion !== rv || rec?.header?.sessionDate !== date || rec?.header?.horizon !== Number(hs)) add(abs, "the record does not match its path");
    if (policy && (date < policy.outcomesFrom || rv !== policy.referenceRuleVersion)) add(abs, `outside the evaluation policy (rule ${policy.referenceRuleVersion} from ${policy.outcomesFrom})`);
    if (excluded.has(date)) add(abs, `session ${date} is permanently excluded by the evaluation policy`);
    if (eligible && !eligible.has(date)) add(abs, `session ${date} is not eligible (excluded or non-live sessions are not processed)`);
  }
  if (git) {
    const changed = (await git.log(["--format=", "--name-status", "--diff-filter=MDRT", "--", OUTCOME_STORE_REL])).split("\n").filter(Boolean);
    for (const line of changed) add(line.split("\t").slice(1).join(" -> "), `an outcome record was ${line[0] === "M" ? "modified" : line[0] === "D" ? "deleted" : line[0] === "R" ? "renamed" : "changed"} in the committed history (records are create-only)`);
  }
  return v;
}
