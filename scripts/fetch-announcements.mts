/**
 * Collects company filings for tracked stocks from NSE's official
 * corporate-announcements RSS feed into public/data/announcements.json, for
 * the Next-Day Momentum page's catalyst column. See
 * scripts/lib/announcements.mts for parsing/matching rules and
 * src/types/announcements.ts for what the file does and does not claim.
 *
 * Supplementary data: a network failure is recorded as a failed check in
 * the file (so the UI can show the coverage gap) and the script still exits
 * 0, so it can never block the market-data commit. An unreadable existing
 * file is a hard error - it is never silently reset.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AnnouncementsFile, FeedCheck } from "../src/types/announcements.ts";
import type { SectorConstituents } from "../src/types/market.ts";
import { fetchArchive } from "./lib/http.mts";
import {
  ANNOUNCEMENTS_FEED_URL,
  emptyAnnouncementsFile,
  feedSpan,
  matchItems,
  mergeAnnouncements,
  parseFeed,
  validateFeedText,
  type TrackedCompany,
} from "./lib/announcements.mts";

const OUT_PATH = path.resolve("public/data/announcements.json");
const CONSTITUENTS_PATH = path.resolve("public/data/constituents.json");

async function loadExisting(): Promise<AnnouncementsFile> {
  let text: string;
  try {
    text = await readFile(OUT_PATH, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyAnnouncementsFile();
    throw err;
  }
  const file = JSON.parse(text) as AnnouncementsFile;
  if (file.schemaVersion !== 1 || !Array.isArray(file.items) || !Array.isArray(file.checks)) {
    throw new Error(`${OUT_PATH} has an unexpected shape - refusing to overwrite it`);
  }
  return file;
}

async function main() {
  const constituents: Record<string, SectorConstituents> = JSON.parse(await readFile(CONSTITUENTS_PATH, "utf-8"));
  const tracked = new Map<string, TrackedCompany>();
  for (const list of Object.values(constituents)) for (const c of list.constituents) tracked.set(c.symbol, { symbol: c.symbol, companyName: c.companyName });

  const existing = await loadExisting();
  const now = new Date();
  const outcome = await fetchArchive(ANNOUNCEMENTS_FEED_URL, {
    label: "announcements feed",
    validate: validateFeedText,
    policy: { maxAttempts: 3, attemptTimeoutMs: 45_000, baseDelayMs: 2_000, maxDelayMs: 30_000, maxTotalMs: 180_000 },
  });

  let check: FeedCheck;
  let matched: ReturnType<typeof matchItems>["matched"] = [];
  if (outcome.kind === "ok") {
    const items = parseFeed(outcome.text);
    const result = matchItems(items, [...tracked.values()]);
    matched = result.matched;
    const span = feedSpan(items);
    check = {
      checkedAt: now.toISOString(),
      outcome: "ok",
      itemsInFeed: items.length,
      itemsMatched: matched.length,
      oldestInFeed: span.oldest,
      newestInFeed: span.newest,
    };
    console.log(
      `[announcements] feed: ${items.length} item(s) ${span.oldest ?? "?"} .. ${span.newest ?? "?"}; ${matched.length} for tracked stocks, ` +
        `${result.unmatched} untracked/unmatched, ${result.ambiguous} ambiguous (dropped), ${result.undated} undated (dropped).`,
    );
  } else {
    const detail = outcome.kind === "not-found" ? "HTTP 404" : `${outcome.category}: ${outcome.detail}`;
    check = { checkedAt: now.toISOString(), outcome: "failed", detail };
    console.log(`::warning::[announcements] feed could not be read (${detail}) - recorded as a coverage gap; existing filings kept.`);
  }

  const merged = mergeAnnouncements(existing, matched, check, now);
  await writeFile(OUT_PATH, JSON.stringify(merged));
  console.log(`[announcements] wrote ${merged.items.length} filing(s), ${merged.checks.length} check record(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
