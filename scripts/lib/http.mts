/**
 * Shared HTTP retrieval for every NSE / niftyindices download.
 *
 * Why this exists (Phase 13 stale-data incident, Oct 2026): NSE's archive
 * host drops connections from User-Agents it classifies as bots - in testing,
 * any UA containing a URL ("+https://...") or the word "fetch" got no HTTP
 * response at all, which surfaced as AbortError timeouts on GitHub runners.
 * The previous helper also forced `retries: 0` for archive downloads and
 * returned null for both "404" and nothing else, so a blocked request looked
 * exactly like a holiday or was silently logged and skipped.
 *
 * fetchArchive() never returns a bare string: every call ends in an explicit
 * outcome (ok / not-found / failed with a category), retries transient
 * failures with exponential backoff + jitter, honours Retry-After, shares one
 * pacer across all concurrent requests, and validates the body before it is
 * accepted - so an HTML error page with HTTP 200 is a failure, not a CSV.
 */

/**
 * Identifies this project without the patterns NSE's edge rejects (a URL or
 * the word "fetch" - verified 2026-10-26: "Mozilla/5.0 (compatible;
 * nse-sector-dashboard/1.0)" returns HTTP 200, the previous
 * "...-data-fetch/1.0; +https://github.com)" gets no response).
 * Override with NSE_USER_AGENT if NSE changes its rules again.
 */
export const DEFAULT_USER_AGENT = "Mozilla/5.0 (compatible; nse-sector-dashboard/1.0)";

export function requestHeaders(): Record<string, string> {
  return {
    "User-Agent": process.env.NSE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    Accept: "text/csv,text/plain;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

export type FailureCategory =
  | "timeout"
  | "connection"
  | "http-429"
  | "http-5xx"
  | "http-4xx"
  | "invalid-content";

export type ArchiveOutcome =
  | { kind: "ok"; text: string; status: number; attempts: number; elapsedMs: number }
  | { kind: "not-found"; status: 404; attempts: number; elapsedMs: number }
  | { kind: "failed"; category: FailureCategory; detail: string; status?: number; attempts: number; elapsedMs: number };

export interface RetryPolicy {
  /** Total attempts including the first (>= 1). */
  maxAttempts: number;
  /** Abort a single attempt after this long (covers connect + headers + body). */
  attemptTimeoutMs: number;
  /** Base for exponential backoff: delay = base * 2^(attempt-1), plus jitter. */
  baseDelayMs: number;
  /** Cap on any single backoff or Retry-After wait. */
  maxDelayMs: number;
  /** Hard ceiling on the total time spent on one URL, including waits: another attempt only starts if a full attempt still fits. */
  maxTotalMs: number;
}

export const ARCHIVE_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  attemptTimeoutMs: 45_000,
  baseDelayMs: 2_000,
  maxDelayMs: 30_000,
  // 4 attempts that each hang for the full 45s + 2+4+8s of backoff = 194s.
  maxTotalMs: 240_000,
};

/** Spaces out request starts across ALL callers sharing it (one per run), so concurrency never turns into a burst. */
export interface Pacer {
  wait(): Promise<void>;
}

export function createPacer(minIntervalMs: number, clock: Clock = realClock): Pacer {
  let next = 0;
  return {
    async wait() {
      const now = clock.now();
      const start = Math.max(now, next);
      next = start + minIntervalMs;
      if (start > now) await clock.sleep(start - now);
    },
  };
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

export interface FetchArchiveOptions {
  /** Short label for logs, e.g. "stocks 2026-10-23". */
  label: string;
  /** Returns null when the body is an acceptable file, or a reason it is not. */
  validate: (text: string) => string | null;
  policy?: RetryPolicy;
  pacer?: Pacer;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds from now; null if absent/unparseable. */
export function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs >= 0) return secs * 1000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

function classifyError(err: unknown): { category: FailureCategory; detail: string } {
  const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return { category: "timeout", detail: "no complete response before the attempt timeout" };
  const code = e?.cause?.code ?? "";
  return { category: "connection", detail: [code, e?.cause?.message ?? e?.message ?? String(err)].filter(Boolean).join(": ").slice(0, 200) };
}

/**
 * Downloads one archive file with bounded retries. Retries: timeouts,
 * connection errors, HTTP 429 and 5xx, and invalid content (an edge or
 * maintenance page can be transient). Never retries a 404 - the caller
 * decides what a missing file means for that date.
 */
export async function fetchArchive(url: string, opts: FetchArchiveOptions): Promise<ArchiveOutcome> {
  const policy = opts.policy ?? ARCHIVE_RETRY_POLICY;
  const clock = opts.clock ?? realClock;
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((line: string) => console.log(line));
  const started = clock.now();
  let last: Extract<ArchiveOutcome, { kind: "failed" }> | null = null;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    await opts.pacer?.wait();
    const attemptStart = clock.now();
    let retryAfterMs: number | null = null;

    try {
      const res = await doFetch(url, { headers: requestHeaders(), signal: AbortSignal.timeout(policy.attemptTimeoutMs) });
      const ms = clock.now() - attemptStart;
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        log(`[http] ${opts.label} attempt ${attempt}: HTTP 404 in ${ms}ms (not retried)`);
        return { kind: "not-found", status: 404, attempts: attempt, elapsedMs: clock.now() - started };
      }
      if (res.ok) {
        const text = await res.text();
        const problem = opts.validate(text);
        if (!problem) {
          log(`[http] ${opts.label} attempt ${attempt}: HTTP ${res.status}, ${text.length} bytes, valid, ${clock.now() - attemptStart}ms`);
          return { kind: "ok", text, status: res.status, attempts: attempt, elapsedMs: clock.now() - started };
        }
        last = { kind: "failed", category: "invalid-content", detail: problem, status: res.status, attempts: attempt, elapsedMs: 0 };
      } else {
        await res.body?.cancel().catch(() => undefined);
        const category: FailureCategory = res.status === 429 ? "http-429" : res.status >= 500 ? "http-5xx" : "http-4xx";
        last = { kind: "failed", category, detail: `HTTP ${res.status}`, status: res.status, attempts: attempt, elapsedMs: 0 };
        if (category === "http-429" || res.status === 503) retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), clock.now());
        if (category === "http-4xx") {
          log(`[http] ${opts.label} attempt ${attempt}: HTTP ${res.status} in ${ms}ms (client error, not retried)`);
          return { ...last, elapsedMs: clock.now() - started };
        }
      }
    } catch (err) {
      const { category, detail } = classifyError(err);
      last = { kind: "failed", category, detail, attempts: attempt, elapsedMs: 0 };
    }

    const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
    const delay = Math.min(policy.maxDelayMs, retryAfterMs ?? backoff * (0.5 + clock.random()));
    const elapsed = clock.now() - started;
    const canRetry = attempt < policy.maxAttempts && elapsed + delay + policy.attemptTimeoutMs <= policy.maxTotalMs;
    log(
      `[http] ${opts.label} attempt ${attempt}/${policy.maxAttempts}: ${last.category} (${last.detail}) after ${clock.now() - attemptStart}ms` +
        (canRetry ? `; retrying in ${(delay / 1000).toFixed(1)}s${retryAfterMs !== null ? " (Retry-After)" : ""}` : "; giving up"),
    );
    if (!canRetry) break;
    await clock.sleep(delay);
  }

  return { ...(last as Extract<ArchiveOutcome, { kind: "failed" }>), elapsedMs: clock.now() - started };
}

/**
 * Fetches a URL as text with the shared headers, a timeout and bounded
 * retries. Used for niftyindices constituent lists (manual, low-frequency).
 */
export async function fetchText(url: string, opts: { timeoutMs?: number; retries?: number; retryDelayMs?: number } = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 3, retryDelayMs = 2000 } = opts;
  const outcome = await fetchArchive(url, {
    label: url,
    validate: (t) => (t.trim().length === 0 ? "empty body" : null),
    policy: { maxAttempts: retries + 1, attemptTimeoutMs: timeoutMs, baseDelayMs: retryDelayMs, maxDelayMs: 30_000, maxTotalMs: (timeoutMs + 30_000) * (retries + 1) },
  });
  if (outcome.kind === "ok") return outcome.text;
  throw new Error(
    `Failed to fetch ${url} after ${outcome.attempts} attempt(s): ${outcome.kind === "not-found" ? "HTTP 404" : `${outcome.category} (${outcome.detail})`}`,
  );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs async tasks with bounded concurrency so we don't hammer NSE's servers or trip rate limits. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
