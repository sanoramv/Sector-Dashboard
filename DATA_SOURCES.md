# Data Sources

Every number the dashboard shows comes from one of the datasets below. All of them are produced server-side (GitHub Actions or a local run) and published as static JSON under `public/data/`. The browser never calls NSE directly: NSE's hosts send no CORS headers.

The coverage figures describe the dataset audited on 2026-10-13 (latest market date 2026-10-09); see `AUDIT_REPORT.md`.

## Datasets

### 1. Index history — `public/data/index-series.json`

| | |
|---|---|
| **Source** | NSE daily all-indices close file: `https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv` (official, no authentication) |
| **Produced by** | `scripts/fetch-index-history.mts` |
| **Fields kept** | Open/High/Low/Close per index, keyed by the file's `Index Date` (the exchange session date, not the fetch time) |
| **Coverage** | 19 series: NIFTY 500 (benchmark), 15 sectoral indices (`src/config/sectorUniverse.ts`), Midcap 150, Smallcap 250 and Microcap 250 (`src/config/marketCapSegments.ts`). 283 sessions (2025-08-18 → 2026-10-09). NIFTY Chemicals starts 2025-11-10 (227 sessions). |
| **Window** | Fetches dates missing from the last 420 calendar days; prunes anything older than 450 days |
| **Refresh** | `update-data.yml`, weekdays 14:30 UTC (20:00 IST). Incremental: only dates missing for at least one series are fetched. |
| **Missing dates** | A 404 is treated as a holiday/weekend; other failures are logged and retried on the next run. Nothing is interpolated. |
| **Adjustments** | None needed: index levels are already continuous through corporate actions (NSE maintains the divisor). |
| **Verified** | NIFTY 500, Bank, IT and Pharma closes matched Yahoo Finance exactly on every common date (2026-10-13 check). |
| **Limitations** | NIFTY Capital Goods, Power, Construction, Insurance and Telecommunications are not in this file; they are listed as unavailable (`UNAVAILABLE_SECTORS`), never estimated. The other 15 series have not been cross-checked independently. |

### 2. Stock history — `public/data/stocks.json`

| | |
|---|---|
| **Source** | NSE daily full equity bhavcopy: `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` (official, no authentication) |
| **Produced by** | `scripts/fetch-stock-bhavcopy.mts` |
| **Fields kept** | `OPEN_PRICE`, `HIGH_PRICE`, `LOW_PRICE`, `CLOSE_PRICE` by `DATE1` (session date). Volume isn't stored. |
| **Rows kept** | Symbols in any tracked constituent list, in series `EQ`, `RR` (REIT/InvIT), `BE` and `BZ` (trade-for-trade). `BE`/`BZ` were added after the audit; see `AUDIT_REPORT.md` H1. |
| **Coverage** | 758 symbols required (NIFTY 500 ∪ sector lists ∪ market-cap lists); 753 with data. Up to 302 sessions (2025-07-21 → 2026-10-09). |
| **Window and refresh** | Same as index history. A date is re-fetched if any tracked symbol lacks it. |
| **Adjustments** | **None. Prices are raw, not adjusted for splits, bonuses, rights or demergers, and no adjustment factor is estimated.** The dashboard instead finds discontinuities: open and close both ≥40% away from the previous close; open and close both ≥15% lower (unverified: corporate action *or* genuine fall); or missing sessions versus the NIFTY 500 calendar. No metric is computed across one; the stock shows "Prices from DATE only". Bonuses smaller than about 6:5, smaller rights issues and dividends are not detected (`AUDIT_REPORT.md` C1/H3). |
| **Verified** | 23 stocks matched Yahoo Finance exactly on every common date, apart from pre-split dates, which differ by exactly the split ratio. |
| **Limitations** | Placeholder symbols (`DUMMY*`) and constituents that haven't started trading have no rows. Stocks without a bar within 7 days of the market date are stale: they get no metrics or score, and are excluded from breadth and industry averages. Whether the `BE`/`BZ` series fully closes the gaps seen so far has **not yet been confirmed by a pipeline run**. |

### 3. Constituent lists and industry classification — `public/data/constituents.json`

| | |
|---|---|
| **Source** | niftyindices.com official constituent CSVs: `https://niftyindices.com/IndexConstituent/<file>.csv` |
| **Produced by** | `scripts/fetch-constituents.mts` |
| **Fields kept** | Symbol, company name, industry (NSE's own classification, from the `Industry` column; 20 industries in NIFTY 500) |
| **Coverage** | NIFTY 500 (501 entries, including `DUMMYHEG`), the 15 sectoral lists, Midcap 150, Smallcap 250 (251) and Microcap 250 (254) |
| **As-of date** | `fetchedAt` only (2026-10-09T20:10Z). The CSV carries **no effective date**, so the list reflects whatever niftyindices.com published at fetch time. |
| **Refresh** | **Manual only** (`update-constituents.yml`, `workflow_dispatch`). Run it after each NSE index reconstitution. |
| **Limitations** | The current lists are applied to all historical dates: in the backtest (survivorship bias) and in the 5-session regime history. No point-in-time history is kept. |

### 4. Manifest — `public/data/manifest.json`

| | |
|---|---|
| **Produced by** | `scripts/build-manifest.mts`, the last step of every pipeline run |
| **Contents** | `latestMarketDate` (newest index bar), `generatedAt` (pipeline run time, UTC), source URLs, and data-quality warnings |
| **Warnings it raises** | Index series that are behind the latest date; constituents with no history; stale stocks; stocks with missing sessions; suspected corporate-action breaks |

## Derived figures (computed in the browser, not published by NSE)

| Figure | Inputs | Notes |
|---|---|---|
| Sector, benchmark and market-cap returns, 52-week-high distance, relative strength | Official index series (1) | 1D/1W/1M/3M/6M = 1/5/21/63/126 sessions back. The 52-week high is the highest intraday high in the trailing 365 days; it needs ≥350 days of history. |
| Breadth (% of constituents above their 20/50/200-day SMA) | Stock history (2) + constituent lists (3) | Uses the constituents' own closes; stale and post-break-only stocks may be ineligible |
| Industry metrics | Stock history (2) + NIFTY 500 industry labels (3) | **Equal-weighted averages computed by this app.** NSE does not publish them; labelled as such in Help. |
| Stock screen, patterns, scores, regimes | (1)–(3) | Transparent heuristics; see `metricGlossary.ts` and `AUDIT_REPORT.md` |
| Backtest | (1)–(3) | Current constituents applied to the past; exploratory only |

## Caching and fallback in the browser

- **On page load:** the last successful dataset is read from IndexedDB (database `nse-sector-dashboard`, key `lastSnapshot:v1`) and shown labelled **"cached"**, never "live". One automatic refresh is then attempted.
- **On refresh:** each fetch adds a `?t=<now>` cache-buster and uses `cache: "no-store"`; there is a 45-second timeout.
- **Status after a successful fetch:**
  - **"live"**: the fetch succeeded with no warnings.
  - **"partial"**: the manifest has warnings.
  - **"stale"**: the latest market date is more than 5 calendar days old.
- **If a refresh fails:** the previous dataset stays on screen, labelled "cached", and the error is shown. Nothing is replaced with zeros or invented values.
- **Snapshot history:** a summary is stored per successful fetch (key `snapshotHistory:v1`, max 180 entries). It comes from real fetches only, never from cache loads.
- **Settings:** stored in `localStorage` (`nse-sector-dashboard:settings:v1`). They change thresholds only, never data.
- **Hosting cache:** GitHub Pages serves files with `max-age=600`, so a new deploy can take up to 10 minutes to reach every browser.

## Not used

- `www.nseindia.com` pages and `/api/*`: these require browser session cookies.
- The niftyindices.com historical-data API: it rejected server-side requests.
- Yahoo Finance: used only by `scripts/audit/yahoo-crosscheck.mts` to verify data. The dashboard never displays or computes from it.
