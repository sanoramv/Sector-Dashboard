import { describe, it, expect } from "vitest";
import {
  RETENTION_DAYS,
  categorize,
  emptyAnnouncementsFile,
  feedSpan,
  matchItems,
  mergeAnnouncements,
  normalizeCompanyName,
  parseFeed,
  parseNsePubDate,
  validateFeedText,
} from "../../scripts/lib/announcements.mts";
import { HTML_ERROR_PAGE } from "./fixtures";

/** Items in the exact shape of NSE's Online_announcements.xml (copied from the live feed, 2026-10-27/28). */
const FEED = `<rss xmlns:atom="http://www.w3.org/2005/Atom" version="2.0"><channel><title>NSE News - Latest Announcements</title>
<item><title>ROUTE MOBILE LIMITED</title><link>https://nsearchives.nseindia.com/corporate/ROUTE_27102026235143_upload-outcome.pdf</link><description>ROUTE MOBILE LIMITED has submitted to the Exchange, the financial results for the period ended September 30, 2026. |SUBJECT: Outcome of Board Meeting</description><pubDate>27-Oct-2026 23:53:39</pubDate></item>
<item><title>Infosys Limited</title><link>https://nsearchives.nseindia.com/corporate/Infosys_27102026120000_x.pdf</link><description>Infosys Limited has informed the Exchange about award of a contract &amp; related matters |SUBJECT: Bagging/Receiving of orders/contracts</description><pubDate>27-Oct-2026 12:00:00</pubDate></item>
<item><title>Some Unlisted Fund</title><link>https://nsearchives.nseindia.com/corporate/ALTERATION_27102026_x.pdf</link><description>NAV |SUBJECT: Declaration of NAV</description><pubDate>27-Oct-2026 10:00:00</pubDate></item>
<item><title>ABB India Limited</title><link>https://nsearchives.nseindia.com/corporate/ROUTE_27102026_x.pdf</link><description>x |SUBJECT: Press Release</description><pubDate>27-Oct-2026 09:00:00</pubDate></item>
<item><title>ABB India Limited</title><link>https://nsearchives.nseindia.com/corporate/ABB_27102026_y.pdf</link><description>y |SUBJECT: Press Release</description><pubDate>not a date</pubDate></item>
</channel></rss>`;

const TRACKED = [
  { symbol: "ROUTE", companyName: "Route Mobile Ltd." },
  { symbol: "INFY", companyName: "Infosys Ltd." },
  { symbol: "ABB", companyName: "ABB India Ltd." },
];

describe("NSE announcements feed parsing", () => {
  it("validates an RSS document and rejects an HTML error page or an empty body", () => {
    expect(validateFeedText(FEED)).toBeNull();
    expect(validateFeedText(HTML_ERROR_PAGE)).toMatch(/not an RSS/);
    expect(validateFeedText("")).toMatch(/empty/);
  });

  it("parses items and decodes entities", () => {
    const items = parseFeed(FEED);
    expect(items).toHaveLength(5);
    expect(items[1].description).toMatch(/contract & related/);
  });

  it("converts NSE's IST publication time to an ISO timestamp with the +05:30 offset; rejects anything else", () => {
    expect(parseNsePubDate("27-Oct-2026 23:53:39")).toBe("2026-10-27T23:53:39+05:30");
    expect(parseNsePubDate("not a date")).toBeNull();
    expect(parseNsePubDate("27-Foo-2026 10:00:00")).toBeNull();
  });

  it("normalizes company names across 'Ltd.' and 'LIMITED'", () => {
    expect(normalizeCompanyName("360 ONE WAM Ltd.")).toBe(normalizeCompanyName("360 ONE WAM LIMITED"));
    expect(normalizeCompanyName("Larsen & Toubro Ltd.")).toBe("LARSENANDTOUBRO");
  });

  it("maps items by filing-link symbol or exact company name, drops conflicts, untracked and undated items", () => {
    const r = matchItems(parseFeed(FEED), TRACKED);
    expect(r.matched.map((m) => [m.symbol, m.matchedBy])).toEqual([
      ["ROUTE", "filing-link-symbol"],
      ["INFY", "company-name"],
    ]);
    expect(r.unmatched).toBe(1); // untracked fund
    expect(r.ambiguous).toBe(1); // ABB title with a ROUTE_ link
    expect(r.undated).toBe(1);
    const route = r.matched[0];
    expect(route.subject).toBe("Outcome of Board Meeting");
    expect(route.category).toBe("results");
    expect(route.url).toBe("https://nsearchives.nseindia.com/corporate/ROUTE_27102026235143_upload-outcome.pdf");
    expect(route.publishedAt).toBe("2026-10-27T23:53:39+05:30");
    expect(route.description).not.toMatch(/SUBJECT/);
  });

  it("categorizes from NSE's subject only, never as positive/negative", () => {
    expect(categorize("Bagging/Receiving of orders/contracts", "")).toBe("orders-contracts");
    expect(categorize("Acquisition", "")).toBe("acquisition-merger");
    expect(categorize("Record Date Updates", "")).toBe("corporate-action");
    expect(categorize("Credit Rating", "")).toBe("credit-rating");
    expect(categorize("Corporate Insolvency Resolution Process", "")).toBe("legal-regulatory");
    expect(categorize("Change in Directors/KMP/SMP/Auditor/RTA", "")).toBe("management-change");
    expect(categorize("Outcome of Board Meeting", "dividend declared")).not.toBe("results");
    expect(categorize("Declaration of NAV", "")).toBe("routine-compliance");
    expect(categorize("Something new", "")).toBe("other");
  });

  it("reports the time span the feed covered", () => {
    expect(feedSpan(parseFeed(FEED))).toEqual({ oldest: "2026-10-27T09:00:00+05:30", newest: "2026-10-27T23:53:39+05:30" });
  });
});

describe("merging into the retained file", () => {
  const now = new Date("2026-10-28T00:00:00Z");
  const matched = matchItems(parseFeed(FEED), TRACKED).matched;

  it("deduplicates, keeps older items, records the check, and prunes by age", () => {
    const old = { ...matched[0], id: "old", publishedAt: "2026-09-01T10:00:00+05:30" };
    const kept = { ...matched[0], id: "kept", publishedAt: "2026-10-20T10:00:00+05:30" };
    const start = { ...emptyAnnouncementsFile(), items: [old, kept, matched[1]] };
    const check = { checkedAt: now.toISOString(), outcome: "ok" as const, itemsInFeed: 5, itemsMatched: 2 };
    const merged = mergeAnnouncements(start, matched, check, now);
    expect(merged.items.map((i) => i.id)).toEqual([matched[0].id, matched[1].id, "kept"]);
    expect(merged.checks[0]).toEqual(check);
    expect(merged.retentionDays).toBe(RETENTION_DAYS);
  });

  it("records a failed read as a check without losing existing items", () => {
    const start = { ...emptyAnnouncementsFile(), items: matched };
    const merged = mergeAnnouncements(start, [], { checkedAt: now.toISOString(), outcome: "failed", detail: "timeout: no response" }, now);
    expect(merged.items).toHaveLength(2);
    expect(merged.checks[0].outcome).toBe("failed");
  });
});
