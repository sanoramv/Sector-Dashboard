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
| **Coverage** | 20 series: NIFTY 50 (market context for Next-Day Momentum; added 2026-10-28, 283 sessions from 2025-09-03), NIFTY 500 (benchmark), 15 sectoral indices (`src/config/sectorUniverse.ts`), Midcap 150, Smallcap 250 and Microcap 250 (`src/config/marketCapSegments.ts`). 283 sessions (2025-08-18 → 2026-10-09). NIFTY Chemicals starts 2025-11-10 (227 sessions). |
| **Window** | Weekdays in the last 420 calendar days; prunes anything older than 450 days |
| **Refresh** | `update-data.yml`, weekdays 14:30 UTC (20:00 IST) plus a 02:30 UTC (08:00 IST) retry. Only dates not yet resolved in `public/data/refresh-state.json` are requested (recent 5 always until OK; at most 40 older per run). |
| **Missing dates** | Every date's outcome is recorded. HTTP 404 for the index file plus NSE serving the *previous* session's bhavcopy = non-trading day. A timeout, connection error, 429/5xx (after 4 attempts), HTML page or malformed file is recorded as failed/invalid, retried on later runs, and makes the refresh "failed" if it affects one of the 5 most recent due dates. Nothing is interpolated. |
| **Adjustments** | None needed: index levels are already continuous through corporate actions (NSE maintains the divisor). |
| **Verified** | NIFTY 500, Bank, IT and Pharma closes matched Yahoo Finance exactly on every common date (2026-10-13 check). |
| **Limitations** | NIFTY Capital Goods, Power, Construction, Insurance and Telecommunications are not in this file; they are listed as unavailable (`UNAVAILABLE_SECTORS`), never estimated. The other 15 series have not been cross-checked independently. |

### 2. Stock history — `public/data/stocks.json`

| | |
|---|---|
| **Source** | NSE daily full equity bhavcopy: `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` (official, no authentication) |
| **Produced by** | `scripts/fetch-stock-bhavcopy.mts` |
| **Fields kept** | `OPEN_PRICE`, `HIGH_PRICE`, `LOW_PRICE`, `CLOSE_PRICE` by `DATE1` (session date). Volume, turnover and delivery from the same rows go to `stock-activity.json` (dataset 6). |
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

### 4. Refresh state — `public/data/refresh-state.json`

| | |
|---|---|
| **Produced by** | `scripts/fetch-index-history.mts` and `scripts/fetch-stock-bhavcopy.mts` (via `scripts/lib/refresh-state.mts`) |
| **Contents** | For every due weekday in the window and each archive (index, stocks): `ok`, `missing`, `earlier-session`, `failed`, `invalid` or `incomplete`, with the check time, attempts and detail. Stock entries also record the symbol/series set they were extracted for, so changing it triggers a bounded re-extraction. |
| **Why** | Decides what the next run fetches (no full re-download on every run) and lets `build-manifest` judge whether the published data is actually current. |

### 4a. Constituent change log — `public/data/constituent-changes.json` (added 2026-10-28)

| | |
|---|---|
| **Produced by** | `scripts/fetch-constituents.mts` (manual workflow), via `scripts/lib/constituent-changes.mts` |
| **Contents** | For each list: symbols added/removed compared with the previous fetch, with both fetch times. The file is created on the next constituents run. |
| **Limitations** | niftyindices.com publishes no effective dates and no history: a change took effect somewhere between the two fetches, and membership before the first logged fetch is unknown. The historical evaluation therefore still uses current membership (survivorship bias, disclosed). |

### 5. Manifest — `public/data/manifest.json`

| | |
|---|---|
| **Produced by** | `scripts/build-manifest.mts`, the last step of every pipeline run |
| **Contents** | `latestMarketDate` (newest index bar), `generatedAt` (when this file was written - not proof data advanced), source URLs, data-quality warnings, and `refresh`: the run's outcome (complete / partial / failed), `latestDueDate`, `tradingDaysBehind`, reasons, and `lastCompleteRefreshAt` (only advanced by complete runs) |
| **Supplements** | `supplements`: the activity file's latest date and session count; the filings feed's last successful read, last attempt and outcome. Missing or unreadable supplementary files are reported here and **never** change `refresh`. |
| **Warnings it raises** | Index series that are behind the latest date; constituents with no history; stale stocks; stocks with missing sessions; suspected corporate-action breaks |

### 6. Trading activity — `public/data/stock-activity.json` (added 2026-10-28)

| | |
|---|---|
| **Source** | The same official bhavcopy rows as dataset 2: `TTL_TRD_QNTY` (volume), `TURNOVER_LACS`, `DELIV_PER` (delivery %, `-` stored as null), `SERIES` |
| **Produced by** | `scripts/fetch-stock-bhavcopy.mts` (no extra downloads); format in `src/lib/activity.ts` |
| **Coverage** | Every date re-extracted since the field was added: 283 sessions (2025-09-03 → 2026-10-27) for 754 symbols. The 20 oldest retained price dates (2025-08-04 → 2025-09-02) are outside the 420-day fetch window and have no activity rows; they age out of the 450-day retention within about a month. |
| **Used by** | Next-Day Momentum only (loaded lazily); the main dashboard does not download it |
| **Limitations** | Delivery % is 100% by rule in the BE/BZ trade-for-trade series. A row whose activity columns do not parse keeps its price bar but gets no activity row (never zero). |

### 7. Exchange filings — `public/data/announcements.json` (added 2026-10-28)

| | |
|---|---|
| **Source** | NSE corporate announcements RSS: `https://nsearchives.nseindia.com/content/RSS/Online_announcements.xml` (official, no authentication; verified 2026-10-27) |
| **Produced by** | `scripts/fetch-announcements.mts`, a `continue-on-error` step in `update-data.yml` |
| **Contents** | Filings for tracked stocks, retained 30 days: company, NSE subject, summary, direct filing link, publication time (IST), category from the subject line, and how the symbol was matched (filing-link prefix or exact normalized company name; conflicting matches dropped). Each read is recorded in `checks`, with the span of items it saw. |
| **Limitations** | The feed holds only the current IST day (observed: it restarts at midnight), so filings published after the last read of a day are missed, and nothing before collection began exists. The page reports coverage per window and says "unknown" rather than "no news" when uncovered. No sentiment is inferred. |

## Derived figures (computed in the browser, not published by NSE)

| Figure | Inputs | Notes |
|---|---|---|
| Sector, benchmark and market-cap returns, 52-week-high distance, relative strength | Official index series (1) | 1D/1W/1M/3M/6M = 1/5/21/63/126 sessions back. The 52-week high is the highest intraday high in the trailing 365 days; it needs ≥350 days of history. |
| Breadth (% of constituents above their 20/50/200-day SMA) | Stock history (2) + constituent lists (3) | Uses the constituents' own closes; stale and post-break-only stocks may be ineligible |
| Industry metrics | Stock history (2) + NIFTY 500 industry labels (3) | **Equal-weighted averages computed by this app.** NSE does not publish them; labelled as such in Help. |
| Stock screen, patterns, scores, regimes | (1)–(3) | Transparent heuristics; see `metricGlossary.ts` and `AUDIT_REPORT.md` |
| Backtest | (1)–(3) | Current constituents applied to the past; exploratory only |
| Next-Day Momentum lists, features, labels, historical evaluation | (1)–(3), (6), (7) | Rules and results in `NEXT_DAY_MOMENTUM.md` |

## Caching and fallback in the browser

- **On page load:** the last successful dataset is read from IndexedDB (database `nse-sector-dashboard`, key `lastSnapshot:v1`) and shown labelled **"cached"**, never "live". One automatic refresh is then attempted.
- **On refresh:** each fetch adds a `?t=<now>` cache-buster and uses `cache: "no-store"`; there is a 45-second timeout.
- **Header labels:** *Latest market data* is the newest session in the data; *Pipeline refresh* is the last pipeline run's verdict and when a refresh last fully completed; *Loaded in browser* is when this browser downloaded the published files. "Loaded just now" says nothing about NSE freshness.
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
- Groww: its Trade API is a paid, per-account subscription with daily-expiring tokens and no top-gainers endpoint, and a token cannot be kept secret on a static site. Its website's lists come from private endpoints, which are not scraped.
- Yahoo Finance: used only by `scripts/audit/yahoo-crosscheck.mts` to verify data. The dashboard never displays or computes from it.
