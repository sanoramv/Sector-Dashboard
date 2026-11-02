/**
 * Publication receipts and live classification (design §8).
 * The ONLY value that can qualify a record as live is the server-side `timestamp` of the GitHub repository-activity
 * push event that published it. Generation time, commit dates and workflow times are recorded as cross-checks and
 * never qualify a record. Missing, ambiguous or contradictory evidence => `unverified`; never `live`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { RECEIPT_KIND, LEDGER_SCHEMA_VERSION, UNVERIFIED_RETRY_DAYS, ledgerPaths } from "./constants.mts";
import { sha256Hex } from "./canonical.mts";
import { resolveCutoff, cutoffAt, addDays, isWeekend } from "./calendar.mts";
import { createOnly, listFiles } from "./files.mts";
import type { DateStatus } from "../lib/refresh-state.mts";

/** The one repository-activity request the ledger relies on (the token probe workflow calls exactly this path). */
export const ACTIVITY_QUERY = "ref=refs/heads/main&activity_type=push&per_page=100";
export const activityPath = (repo: string): string => `/repos/${repo}/activity?${ACTIVITY_QUERY}`;

export interface ActivityPush {
  id: number | string;
  node_id?: string;
  timestamp: string;
  activity_type: string;
  ref: string;
  before: string;
  after: string;
  actor?: { login?: string };
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; headers: { get(name: string): string | null } }>;

export interface GitOps {
  /** SHA of the commit that first added `file` to the history. */
  firstAddingCommit(file: string): Promise<string | null>;
  isAncestor(ancestor: string, descendant: string): Promise<boolean>;
  commitDate(sha: string): Promise<string | null>;
  isOnMain(sha: string): Promise<boolean>;
}

export type FetchResult = { ok: true; pushes: ActivityPush[] } | { ok: false; reason: string };

/** Pages through the repository-activity API for pushes to the default branch. */
export async function fetchPushActivity(fetchFn: FetchLike, repo: string, token: string | null, opts: { maxPages?: number } = {}): Promise<FetchResult> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let url: string | null = `https://api.github.com${activityPath(repo)}`;
  const pushes: ActivityPush[] = [];
  for (let page = 0; url && page < (opts.maxPages ?? 5); page++) {
    let res;
    try {
      res = await fetchFn(url, { headers });
    } catch (err) {
      return { ok: false, reason: `activity endpoint unreachable: ${String(err)}` };
    }
    if (!res.ok) return { ok: false, reason: `activity endpoint returned HTTP ${res.status}` };
    const body = await res.json();
    if (!Array.isArray(body)) return { ok: false, reason: "activity endpoint returned a non-array body" };
    pushes.push(...(body as ActivityPush[]));
    const link: string | null = res.headers.get("link");
    const next: RegExpMatchArray | null = link ? link.match(/<([^>]+)>;\s*rel="next"/) : null;
    url = next ? next[1] : null;
  }
  return { ok: true, pushes };
}

export interface Evidence {
  tGen: string;
  tCommit: string | null;
  commit: string | null;
  tPub: string | null;
  push: { id: string; node_id: string | null; timestamp: string; before: string; after: string; actor: string | null } | null;
  runCrossCheck: { runId: string | null; runAttempt: string | null };
}

export type Classification = { kind: "live" | "live-late"; evidence: Evidence; cutoffUtc: string; nextSession: string | null; via: string; reasons: string[] } | { kind: "unverified"; evidence: Evidence; reasons: string[] } | { kind: "pending"; evidence: Evidence; waitingFor: string; reasons: string[] };

export interface ClassifyInput {
  sessionDate: string;
  tGen: string;
  file: string;
  runId: string | null;
  runAttempt: string | null;
  activity: FetchResult;
  git: GitOps;
  statuses: Record<string, DateStatus>;
  overrides?: ReadonlySet<string>;
}

export async function classifyPublication(input: ClassifyInput): Promise<Classification> {
  const ev: Evidence = { tGen: input.tGen, tCommit: null, commit: null, tPub: null, push: null, runCrossCheck: { runId: input.runId, runAttempt: input.runAttempt } };
  const unverified = (...reasons: string[]): Classification => ({ kind: "unverified", evidence: ev, reasons });
  const commit = await input.git.firstAddingCommit(input.file);
  if (!commit) return { kind: "pending", evidence: ev, waitingFor: "publication", reasons: ["The daily file is not in any commit yet; publication has not happened."] };
  ev.commit = commit;
  if (!(await input.git.isOnMain(commit))) return unverified("The commit adding the daily file is not reachable from main.");
  ev.tCommit = await input.git.commitDate(commit);
  if (!input.activity.ok) return unverified(`Publication time unavailable: ${input.activity.reason}.`);
  // Earliest push whose range contains the commit: ancestor of `after`, not ancestor of `before`.
  const matches: ActivityPush[] = [];
  for (const p of input.activity.pushes) {
    if (p.ref !== "refs/heads/main" || p.activity_type !== "push") continue;
    if ((await input.git.isAncestor(commit, p.after)) && !(await input.git.isAncestor(commit, p.before))) matches.push(p);
  }
  if (matches.length === 0) return unverified("No repository-activity push event contains the commit (event missing, retention, or insufficient access).");
  matches.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  const p = matches[0];
  const tPub = Date.parse(p.timestamp);
  if (!Number.isFinite(tPub)) return unverified("The push event has an unparseable timestamp.");
  ev.tPub = new Date(tPub).toISOString();
  ev.push = { id: String(p.id), node_id: p.node_id ?? null, timestamp: p.timestamp, before: p.before, after: p.after, actor: p.actor?.login ?? null };
  const tGen = Date.parse(input.tGen);
  const tCommit = ev.tCommit ? Date.parse(ev.tCommit) : NaN;
  if (!Number.isFinite(tGen) || tGen > tPub) return unverified("Contradictory evidence: generation time is after the push (or unparseable).");
  if (!Number.isFinite(tCommit) || tCommit > tPub) return unverified("Contradictory evidence: the commit's own date is after the push (or unparseable).");
  const res = resolveCutoff(input.sessionDate, tPub, input.statuses, input.overrides);
  if (res.kind === "pending") return { kind: "pending", evidence: ev, waitingFor: res.waitingFor, reasons: [`The next trading session is not yet resolved (waiting for ${res.waitingFor}).`] };
  const cutoffUtc = new Date(res.cutoffMs).toISOString();
  const kind = tPub <= res.cutoffMs ? "live" : "live-late";
  return { kind, evidence: ev, cutoffUtc, nextSession: res.nextSession, via: res.via, reasons: [kind === "live" ? `Published ${ev.tPub}, at or before the ${cutoffUtc} cut-off.` : `Published ${ev.tPub}, after the ${cutoffUtc} cut-off.`] };
}

export interface ReceiptFile {
  kind: typeof RECEIPT_KIND;
  schemaVersion: number;
  sessionDate: string;
  ruleVersion: string;
  file: string;
  fileSha256: string;
  class: "live" | "live-late";
  cutoff: { rule: string; utc: string; nextSession: string | null; via: string };
  evidence: Evidence;
  note: string;
}

export const earliestCutoffIso = (sessionDate: string): string => {
  let d = addDays(sessionDate, 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return new Date(cutoffAt(d)).toISOString();
};

export interface VerifyOutcome {
  date: string;
  result: "receipt-written" | "receipt-exists" | "receipt-invalid" | "unverified" | "pending" | "skipped";
  class: "live" | "live-late" | "unverified" | "pending";
  reasons: string[];
}

export type ExistingReceipt = { kind: "none" } | { kind: "valid"; class: "live" | "live-late" } | { kind: "invalid"; problem: string };

export async function readExistingReceipt(file: string): Promise<ExistingReceipt> {
  let text: string;
  try {
    text = await readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "none" };
    return { kind: "invalid", problem: String(err) };
  }
  try {
    const r = JSON.parse(text) as { kind?: string; class?: string };
    if (r.kind !== RECEIPT_KIND) return { kind: "invalid", problem: "wrong kind" };
    if (r.class !== "live" && r.class !== "live-late") return { kind: "invalid", problem: `class ${String(r.class)} is not live or live-late` };
    return { kind: "valid", class: r.class };
  } catch (err) {
    return { kind: "invalid", problem: `not valid JSON: ${String(err)}` };
  }
}

/** Decides every captured date that has no receipt yet. Receipts are create-only and only ever written for live / live-late. */
export async function verifyReceipts(opts: {
  ledgerRoot: string;
  ruleVersion: string;
  now: Date;
  activity: FetchResult;
  git: GitOps;
  statuses: Record<string, DateStatus>;
  overrides?: ReadonlySet<string>;
}): Promise<VerifyOutcome[]> {
  const paths = ledgerPaths(opts.ledgerRoot);
  const dates = (await listFiles(paths.predictionsDir(opts.ruleVersion))).map((f) => f.replace(/\.json$/, ""));
  const out: VerifyOutcome[] = [];
  for (const date of dates) {
    const receipt = paths.receiptFile(date);
    const existing = await readExistingReceipt(receipt);
    if (existing.kind === "valid") {
      // Preserve the STORED classification; an existing receipt never becomes live merely because it exists.
      out.push({ date, result: "receipt-exists", class: existing.class, reasons: ["Receipt already exists; left untouched."] });
      continue;
    }
    if (existing.kind === "invalid") {
      out.push({ date, result: "receipt-invalid", class: "unverified", reasons: [`Existing receipt is unusable (${existing.problem}); it is left untouched and nothing is promoted.`] });
      continue;
    }
    const file = paths.dailyFile(opts.ruleVersion, date);
    const text = await readFile(file, "utf-8");
    const daily = JSON.parse(text) as { header: { generatedAt: string; github: { runId: string | null; runAttempt: string | null } } };
    const ageDays = (opts.now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
    const c = await classifyPublication({ sessionDate: date, tGen: daily.header.generatedAt, file, runId: daily.header.github.runId, runAttempt: daily.header.github.runAttempt, activity: opts.activity, git: opts.git, statuses: opts.statuses, overrides: opts.overrides });
    if (c.kind === "pending") {
      out.push({ date, result: "pending", class: "pending", reasons: c.reasons });
      continue;
    }
    if (c.kind === "unverified") {
      out.push({ date, result: ageDays > UNVERIFIED_RETRY_DAYS + 10 ? "skipped" : "unverified", class: "unverified", reasons: c.reasons });
      continue;
    }
    const body: ReceiptFile = {
      kind: RECEIPT_KIND,
      schemaVersion: LEDGER_SCHEMA_VERSION,
      sessionDate: date,
      ruleVersion: opts.ruleVersion,
      file: file.replace(/^.*?public\/data\//, "public/data/"),
      fileSha256: sha256Hex(text),
      class: c.kind,
      cutoff: { rule: "09:00 IST on the day of the next NSE trading session", utc: c.cutoffUtc, nextSession: c.nextSession, via: c.via },
      evidence: c.evidence,
      note: "Only the server-side push event qualifies a record; the other times are cross-checks.",
    };
    const res = await createOnly(receipt, JSON.stringify(body) + "\n");
    if (res.created) out.push({ date, result: "receipt-written", class: c.kind, reasons: c.reasons });
    else {
      const won = await readExistingReceipt(receipt); // another writer created it first: report ITS class
      out.push({ date, result: "receipt-exists", class: won.kind === "valid" ? won.class : "unverified", reasons: ["Receipt was created concurrently; left untouched."] });
    }
  }
  return out;
}

const run = promisify(execFile);
export function realGit(cwd: string): GitOps {
  const git = (args: string[]) => run("git", args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return {
    async firstAddingCommit(file) {
      const { stdout } = await git(["log", "--diff-filter=A", "--format=%H", "--", file]);
      const lines = stdout.trim().split("\n").filter(Boolean);
      return lines.length ? lines[lines.length - 1] : null;
    },
    async isAncestor(a, d) {
      try {
        await git(["merge-base", "--is-ancestor", a, d]);
        return true;
      } catch {
        return false;
      }
    },
    async commitDate(sha) {
      try {
        return (await git(["log", "-1", "--format=%cI", sha])).stdout.trim() || null;
      } catch {
        return null;
      }
    },
    async isOnMain(sha) {
      for (const ref of ["origin/main", "main", "HEAD"]) {
        try {
          await git(["merge-base", "--is-ancestor", sha, ref]);
          return true;
        } catch {
          /* try the next ref */
        }
      }
      return false;
    },
  };
}
