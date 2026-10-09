const USER_AGENT =
  "Mozilla/5.0 (compatible; nse-sector-dashboard-data-fetch/1.0; +https://github.com)";

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
}

/**
 * Fetches a URL as text with a timeout and bounded retries. Used for every
 * call to NSE's archive/constituent endpoints so a single flaky response
 * doesn't abort an entire pipeline run, and so we never hang indefinitely.
 */
export async function fetchText(url: string, opts: FetchTextOptions = {}): Promise<string> {
  const { timeoutMs = 20_000, retries = 3, retryDelayMs = 2000 } = opts;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        // Linear backoff - NSE/niftyindices occasionally throttle bursts of requests
        // from the same IP; a short, growing pause clears that without much delay.
        await sleep(retryDelayMs * (attempt + 1));
      }
    }
  }
  throw new Error(`Failed to fetch ${url} after ${retries + 1} attempts: ${String(lastError)}`);
}

/** Like fetchText, but returns null on a 404 instead of throwing - used for "does this date's file exist" probing (e.g. weekends/holidays). */
export async function fetchTextOrNull(url: string, opts: FetchTextOptions = {}): Promise<string | null> {
  try {
    return await fetchText(url, { ...opts, retries: 0 });
  } catch (err) {
    if (String(err).includes("HTTP 404")) return null;
    throw err;
  }
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
