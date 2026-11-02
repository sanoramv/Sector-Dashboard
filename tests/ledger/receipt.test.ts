import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyPublication, fetchPushActivity, verifyReceipts, type ActivityPush, type FetchLike, type GitOps } from "../../scripts/ledger/receipt.mts";
import { ledgerPaths } from "../../scripts/ledger/constants.mts";
import { tmpDir } from "./fixture";

/** Linear history c1 < c2 < c3 ... ; `added` maps file -> commit. */
const fakeGit = (opts: { added?: Record<string, string>; order?: string[]; dates?: Record<string, string>; onMain?: boolean } = {}): GitOps => {
  const order = opts.order ?? ["c0", "c1", "c2", "c3"];
  return {
    firstAddingCommit: async (f) => opts.added?.[f] ?? null,
    isAncestor: async (a, d) => order.indexOf(a) <= order.indexOf(d) && order.includes(a) && order.includes(d),
    commitDate: async (s) => opts.dates?.[s] ?? "2026-10-29T20:00:00Z",
    isOnMain: async () => opts.onMain ?? true,
  };
};
const push = (over: Partial<ActivityPush>): ActivityPush => ({ id: 1, timestamp: "2026-10-29T20:05:00Z", activity_type: "push", ref: "refs/heads/main", before: "c0", after: "c1", ...over });
const base = { sessionDate: "2026-10-29", tGen: "2026-10-29T19:59:00Z", file: "f.json", runId: "1", runAttempt: "1", statuses: {} };

describe("classifyPublication", () => {
  const git = fakeGit({ added: { "f.json": "c1" } });
  it("valid server-side push before the cut-off is live", async () => {
    const c = await classifyPublication({ ...base, git, activity: { ok: true, pushes: [push({})] } });
    expect(c.kind).toBe("live");
    expect(c.kind === "live" && c.evidence.tPub).toBe("2026-10-29T20:05:00.000Z");
  });
  it("a push after the next session's 09:00 IST is live-late once the calendar says trading", async () => {
    const c = await classifyPublication({ ...base, git, statuses: { "2026-10-30": "trading" }, activity: { ok: true, pushes: [push({ timestamp: "2026-10-30T04:00:00Z" })] } });
    expect(c).toMatchObject({ kind: "live-late", nextSession: "2026-10-30" });
  });
  it("is pending (not guessed) while the next session is unresolved", async () => {
    const c = await classifyPublication({ ...base, git, activity: { ok: true, pushes: [push({ timestamp: "2026-10-30T04:00:00Z" })] } });
    expect(c.kind).toBe("pending");
  });
  it("holiday next day is skipped; weekend transition uses Monday", async () => {
    const h = await classifyPublication({ ...base, git, statuses: { "2026-10-30": "non-trading", "2026-11-02": "trading" }, activity: { ok: true, pushes: [push({ timestamp: "2026-10-30T10:00:00Z" })] } });
    expect(h).toMatchObject({ kind: "live", nextSession: "2026-11-02" });
    const fri = await classifyPublication({ ...base, sessionDate: "2026-10-30", git, activity: { ok: true, pushes: [push({ timestamp: "2026-11-02T03:00:00Z" })] } });
    expect(fri.kind).toBe("live");
  });
  it("missing event, inaccessible endpoint, or no containing push => unverified, never live", async () => {
    expect((await classifyPublication({ ...base, git, activity: { ok: true, pushes: [] } })).kind).toBe("unverified");
    expect((await classifyPublication({ ...base, git, activity: { ok: false, reason: "activity endpoint returned HTTP 403" } })).kind).toBe("unverified");
    expect((await classifyPublication({ ...base, git, activity: { ok: true, pushes: [push({ before: "c1", after: "c2" })] } })).kind).toBe("unverified");
    expect((await classifyPublication({ ...base, git, activity: { ok: true, pushes: [push({ ref: "refs/heads/other" })] } })).kind).toBe("unverified");
  });
  it("contradictory timestamps => unverified", async () => {
    // generated after the push
    expect((await classifyPublication({ ...base, tGen: "2026-10-29T21:00:00Z", git, activity: { ok: true, pushes: [push({})] } })).kind).toBe("unverified");
    // commit date later than push
    const g2 = fakeGit({ added: { "f.json": "c1" }, dates: { c1: "2026-10-29T22:00:00Z" } });
    expect((await classifyPublication({ ...base, git: g2, activity: { ok: true, pushes: [push({})] } })).kind).toBe("unverified");
  });
  it("an early forged committer date does not make a late push live", async () => {
    const g = fakeGit({ added: { "f.json": "c1" }, dates: { c1: "2026-10-29T10:00:00Z" } });
    const c = await classifyPublication({ ...base, tGen: "2026-10-29T09:00:00Z", git: g, statuses: { "2026-10-30": "trading" }, activity: { ok: true, pushes: [push({ timestamp: "2026-10-30T05:00:00Z" })] } });
    expect(c.kind).toBe("live-late");
  });
  it("uncommitted file => pending; commit not on main => unverified", async () => {
    expect((await classifyPublication({ ...base, git: fakeGit(), activity: { ok: true, pushes: [push({})] } })).kind).toBe("pending");
    expect((await classifyPublication({ ...base, git: fakeGit({ added: { "f.json": "c1" }, onMain: false }), activity: { ok: true, pushes: [push({})] } })).kind).toBe("unverified");
  });
});

describe("fetchPushActivity", () => {
  const res = (status: number, body: unknown, link: string | null = null) => ({ ok: status < 300, status, json: async () => body, headers: { get: () => link } });
  it("pages and sends the token only as a bearer header", async () => {
    const calls: { url: string; auth?: string }[] = [];
    const f: FetchLike = async (url, init) => {
      calls.push({ url, auth: init?.headers?.Authorization });
      return calls.length === 1 ? res(200, [push({ id: 1 })], '<https://api.github.com/next>; rel="next"') : res(200, [push({ id: 2 })]);
    };
    const r = await fetchPushActivity(f, "o/r", "tok");
    expect(r.ok && r.pushes.map((p) => p.id)).toEqual([1, 2]);
    expect(calls[0].url).toContain("activity_type=push");
    expect(calls.every((c) => c.auth === "Bearer tok")).toBe(true);
  });
  it("HTTP 403, network failure and malformed bodies are failures, not empty success", async () => {
    expect((await fetchPushActivity(async () => res(403, {}), "o/r", null)).ok).toBe(false);
    expect((await fetchPushActivity(async () => { throw new Error("net"); }, "o/r", null)).ok).toBe(false);
    expect((await fetchPushActivity(async () => res(200, { message: "x" }), "o/r", null)).ok).toBe(false);
  });
});

describe("verifyReceipts", () => {
  let tmp: Awaited<ReturnType<typeof tmpDir>>;
  beforeAll(async () => (tmp = await tmpDir()));
  afterAll(async () => tmp.cleanup());
  it("writes a receipt only for verified live/late publications, create-only, and leaves others undecided", async () => {
    const root = path.join(tmp.dir, "ledger");
    const p = ledgerPaths(root);
    const rv = "mv1-test";
    for (const d of ["2026-10-28", "2026-10-29"]) {
      await mkdir(p.predictionsDir(rv), { recursive: true });
      await writeFile(p.dailyFile(rv, d), JSON.stringify({ header: { generatedAt: `${d}T19:59:00Z`, github: { runId: "1", runAttempt: "1" } } }));
    }
    const git: GitOps = {
      firstAddingCommit: async (f) => (f.endsWith("2026-10-28.json") ? "c1" : null),
      isAncestor: async (a, d) => ["c0", "c1"].indexOf(a) <= ["c0", "c1"].indexOf(d),
      commitDate: async () => "2026-10-28T20:00:00Z",
      isOnMain: async () => true,
    };
    const common = { ledgerRoot: root, ruleVersion: rv, now: new Date("2026-10-29T21:00:00Z"), git, statuses: {} };
    const out = await verifyReceipts({ ...common, activity: { ok: true, pushes: [push({ timestamp: "2026-10-28T20:05:00Z" })] } });
    expect(out.find((o) => o.date === "2026-10-28")?.result).toBe("receipt-written");
    expect(out.find((o) => o.date === "2026-10-29")?.result).toBe("pending");
    const r1 = await readFile(p.receiptFile("2026-10-28"), "utf-8");
    expect(JSON.parse(r1)).toMatchObject({ class: "live", sessionDate: "2026-10-28" });
    await expect(stat(p.receiptFile("2026-10-29"))).rejects.toThrow();
    // second run with different evidence never alters the receipt
    const again = await verifyReceipts({ ...common, activity: { ok: false, reason: "HTTP 403" } });
    expect(again.find((o) => o.date === "2026-10-28")?.result).toBe("receipt-exists");
    expect(await readFile(p.receiptFile("2026-10-28"), "utf-8")).toBe(r1);
  });
  it("an inaccessible endpoint yields unverified and writes no receipt", async () => {
    const root = path.join(tmp.dir, "ledger2");
    const p = ledgerPaths(root);
    await mkdir(p.predictionsDir("mv1-t"), { recursive: true });
    await writeFile(p.dailyFile("mv1-t", "2026-10-29"), JSON.stringify({ header: { generatedAt: "2026-10-29T19:59:00Z", github: { runId: null, runAttempt: null } } }));
    const git: GitOps = { firstAddingCommit: async () => "c1", isAncestor: async () => true, commitDate: async () => "2026-10-29T20:00:00Z", isOnMain: async () => true };
    const out = await verifyReceipts({ ledgerRoot: root, ruleVersion: "mv1-t", now: new Date("2026-10-30T00:00:00Z"), git, statuses: {}, activity: { ok: false, reason: "activity endpoint returned HTTP 403" } });
    expect(out[0]).toMatchObject({ result: "unverified", class: "unverified" });
    await expect(stat(p.receiptFile("2026-10-29"))).rejects.toThrow();
  });
});
