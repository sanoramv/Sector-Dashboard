import { describe, it, expect, afterEach } from "vitest";
import {
  DEFAULT_USER_AGENT,
  createPacer,
  fetchArchive,
  mapWithConcurrency,
  parseRetryAfter,
  requestHeaders,
  type Clock,
  type RetryPolicy,
} from "../../scripts/lib/http.mts";
import { validateArchiveText } from "../../scripts/lib/archives.mts";
import { HTML_ERROR_PAGE, indexCsv } from "./fixtures";

/** Deterministic clock: sleeping advances time instantly and records each delay. */
function fakeClock(): Clock & { sleeps: number[]; t: number } {
  const c = {
    t: 1_000_000,
    sleeps: [] as number[],
    now: () => c.t,
    sleep: async (ms: number) => {
      c.sleeps.push(ms);
      c.t += ms;
    },
    random: () => 0.5, // jitter factor 0.5 + 0.5 = 1.0 -> delays equal the base backoff
  };
  return c;
}

const POLICY: RetryPolicy = { maxAttempts: 4, attemptTimeoutMs: 45_000, baseDelayMs: 2_000, maxDelayMs: 30_000, maxTotalMs: 240_000 };
const csvOk = () => new Response(indexCsv("2026-10-23"), { status: 200, headers: { "content-type": "text/csv" } });
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
const reset = () => new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });

/** fetch stub that plays back `script` in order, recording the headers it was called with. */
function scripted(script: Array<() => Response | Error>) {
  const calls: Array<Record<string, string>> = [];
  const impl = (async (_url: string, init?: RequestInit) => {
    calls.push((init?.headers ?? {}) as Record<string, string>);
    const next = script[Math.min(calls.length - 1, script.length - 1)]();
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { impl, calls };
}

function run(script: Array<() => Response | Error>, clock = fakeClock()) {
  const { impl, calls } = scripted(script);
  const lines: string[] = [];
  const result = fetchArchive("https://nsearchives.nseindia.com/content/indices/ind_close_all_23102026.csv", {
    label: "index 2026-10-23",
    validate: (t) => validateArchiveText("index", t),
    policy: POLICY,
    clock,
    fetchImpl: impl,
    log: (l) => lines.push(l),
  });
  return { result, calls, lines, clock };
}

describe("fetchArchive", () => {
  afterEach(() => {
    delete process.env.NSE_USER_AGENT;
  });

  it("accepts a valid CSV on the first attempt, sending the NSE-compatible User-Agent", async () => {
    const { result, calls } = run([csvOk]);
    const r = await result;
    expect(r.kind).toBe("ok");
    expect(r.attempts).toBe(1);
    expect(calls[0]["User-Agent"]).toBe(DEFAULT_USER_AGENT);
  });

  it("never sends the User-Agent patterns NSE drops (a URL or the word 'fetch')", () => {
    const ua = requestHeaders()["User-Agent"];
    expect(ua).not.toMatch(/https?:|\+http|fetch/i);
  });

  it("lets NSE_USER_AGENT override the User-Agent", async () => {
    process.env.NSE_USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) test";
    const { result, calls } = run([csvOk]);
    await result;
    expect(calls[0]["User-Agent"]).toBe("Mozilla/5.0 (X11; Linux x86_64) test");
  });

  it("retries a timeout and succeeds, with exponential backoff", async () => {
    const { result, clock, lines } = run([timeout, timeout, csvOk]);
    const r = await result;
    expect(r.kind).toBe("ok");
    expect(r.attempts).toBe(3);
    expect(clock.sleeps).toEqual([2_000, 4_000]);
    expect(lines.join("\n")).toMatch(/attempt 1\/4: timeout .*retrying in 2\.0s/);
  });

  it("retries a connection reset and succeeds", async () => {
    const r = await run([reset, csvOk]).result;
    expect(r.kind).toBe("ok");
    expect(r.attempts).toBe(2);
  });

  it("honours Retry-After on HTTP 429", async () => {
    const tooMany = () => new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
    const { result, clock, lines } = run([tooMany, csvOk]);
    const r = await result;
    expect(r.kind).toBe("ok");
    expect(clock.sleeps).toEqual([7_000]);
    expect(lines[0]).toMatch(/http-429.*\(Retry-After\)/);
  });

  it("caps an excessive Retry-After at maxDelayMs", async () => {
    const tooMany = () => new Response("", { status: 429, headers: { "retry-after": "3600" } });
    const { result, clock } = run([tooMany, csvOk]);
    await result;
    expect(clock.sleeps).toEqual([30_000]);
  });

  it("retries HTTP 5xx and succeeds", async () => {
    const err = () => new Response("bad gateway", { status: 502 });
    const r = await run([err, err, csvOk]).result;
    expect(r.kind).toBe("ok");
    expect(r.attempts).toBe(3);
  });

  it("gives up after maxAttempts and reports the failure category - never 'not found'", async () => {
    const { result, lines } = run([timeout]);
    const r = await result;
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.category).toBe("timeout");
    expect(r.attempts).toBe(4);
    expect(lines.at(-1)).toMatch(/giving up/);
  });

  it("stops early when another full attempt would not fit in the total time budget", async () => {
    const clock = fakeClock();
    const { impl } = scripted([timeout]);
    const slowClockImpl = (async (...args: Parameters<typeof fetch>) => {
      clock.t += 60_000; // each attempt burns 60s
      return impl(...args);
    }) as typeof fetch;
    // Attempt 1 ends at 60s; 60 + 2s backoff + 45s timeout = 107s fits in 130s.
    // Attempt 2 ends at 122s; 122 + 4 + 45 = 171s does not -> give up after 2.
    const r = await fetchArchive("u", { label: "x", validate: () => null, policy: { ...POLICY, maxTotalMs: 130_000 }, clock, fetchImpl: slowClockImpl, log: () => {} });
    expect(r.kind).toBe("failed");
    expect(r.attempts).toBe(2);
    expect(r.elapsedMs).toBeLessThanOrEqual(130_000);
  });

  it("returns not-found for a 404 without retrying", async () => {
    const { result, calls } = run([() => new Response(HTML_ERROR_PAGE, { status: 404 })]);
    const r = await result;
    expect(r.kind).toBe("not-found");
    expect(calls).toHaveLength(1);
  });

  it("does not retry other 4xx errors", async () => {
    const { result, calls } = run([() => new Response("forbidden", { status: 403 })]);
    const r = await result;
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.category).toBe("http-4xx");
    expect(calls).toHaveLength(1);
  });

  it("treats an HTML page served with HTTP 200 as invalid content, not a CSV", async () => {
    const r = await run([() => new Response(HTML_ERROR_PAGE, { status: 200 })]).result;
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") {
      expect(r.category).toBe("invalid-content");
      expect(r.detail).toMatch(/HTML/);
    }
  });

  it("retries invalid content and accepts a later valid file", async () => {
    const r = await run([() => new Response("", { status: 200 }), csvOk]).result;
    expect(r.kind).toBe("ok");
    expect(r.attempts).toBe(2);
  });
});

describe("parseRetryAfter", () => {
  it("parses seconds and HTTP dates; ignores garbage", () => {
    expect(parseRetryAfter("5", 0)).toBe(5000);
    expect(parseRetryAfter(new Date(10_000).toUTCString(), 0)).toBe(10_000);
    expect(parseRetryAfter("soon", 0)).toBeNull();
    expect(parseRetryAfter(null, 0)).toBeNull();
  });
});

describe("rate and concurrency limiting", () => {
  it("the shared pacer spaces request starts by at least the minimum interval", async () => {
    const clock = fakeClock();
    const pacer = createPacer(400, clock);
    const starts: number[] = [];
    for (let i = 0; i < 4; i++) {
      await pacer.wait();
      starts.push(clock.now());
    }
    expect(starts.map((s) => s - starts[0])).toEqual([0, 400, 800, 1200]);
  });

  it("concurrent callers sharing one pacer are still spaced (no bursts)", async () => {
    // A clock whose sleeps do not move time shows the start slot each caller reserved.
    const clock = { ...fakeClock(), sleep: async (ms: number) => void clock.sleeps.push(ms) };
    const pacer = createPacer(500, clock);
    const reserved: number[] = [];
    // Reserve slots concurrently: each wait() claims the next slot synchronously.
    await Promise.all([0, 1, 2].map(async () => {
      const before = clock.now();
      await pacer.wait();
      reserved.push(clock.now() - before);
    }));
    expect(clock.sleeps.sort((a, b) => a - b)).toEqual([500, 1000]);
    expect(reserved).toHaveLength(3);
  });

  it("mapWithConcurrency never runs more than the limit at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 2, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight -= 1;
    });
    expect(peak).toBe(2);
  });
});
