# NSE Sector Strength & Market Regime Dashboard

A research and screening dashboard for identifying which NSE (National Stock Exchange of India) sectors are
bullish, sideways, or bearish - based on returns, moving-average breadth, 52-week-high proximity, and relative
strength versus the NIFTY 500.

**This is a research and screening tool, not an automated trading system.** It does not predict future returns,
and nothing in it should be read as investment advice.

It is a static site (Vite + React + TypeScript) designed to run locally and deploy to GitHub Pages with no
backend server.

---

## 1. How data gets into this app (read this first)

NSE's website (`nseindia.com`) does **not** offer a stable, browser-accessible public API. In testing:

- `www.nseindia.com`'s pages and `/api/*` endpoints return `403`/bot-challenge responses to unauthenticated,
  non-browser requests, and do not send CORS headers - so a browser running this site on GitHub Pages cannot
  call them directly.
- NSE **does** publish official, unauthenticated, downloadable daily archive files that do not require a
  session or API key:
  - `https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv` - daily OHLC close values for
    all NSE indices (used for sector/benchmark returns, 52-week high, relative strength).
  - `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` - daily OHLC close data
    for every listed equity (used for moving-average breadth, computed from real constituent stock prices).
  - `https://niftyindices.com/IndexConstituent/<file>.csv` - official index constituent lists (one file per
    sectoral index).
- **None of these three hosts send CORS headers that would allow a browser on a different origin (including
  GitHub Pages) to fetch them directly.** `niftyindices.com`'s constituent files are the one exception (they do
  send `Access-Control-Allow-Origin: *`), but the two NSE archive hosts do not.

**Because of this, the architecture is:**

1. A data-fetch pipeline (`scripts/*.mts`, plain Node scripts using the built-in `fetch`) runs **server-side**
   - either on your own machine, or on a schedule in GitHub Actions - and downloads/validates the official CSVs
   above.
2. The pipeline writes the result as static JSON under `public/data/` (`manifest.json`, `index-series.json`,
   `constituents.json`, `stocks.json`).
3. The deployed static site reads those JSON files **same-origin** (no CORS issue) and does all return/breadth/
   score/regime calculation **in the browser**, from the raw price series.
4. Clicking **Refresh Data** re-fetches those same JSON files from the server (cache-busted), re-validates them,
   and recomputes everything. It is a real refresh of whatever the pipeline has most recently published - it is
   **not** a live call to NSE from your browser, because that is not something a browser on GitHub Pages can do
   reliably or within NSE's apparent access model. The header always labels this honestly (see "Data status"
   below) and always shows the exact latest market date separately from when the browser last fetched it.

If you want data that is more "live" than the scheduled pipeline's last run, run `npm run fetch:all` yourself
and reload - see "Local development" below.

### Data status definitions

Shown in the header next to **Status**:

| Status | Meaning |
|---|---|
| **Live** | The browser just fetched the dataset from the server and it isn't stale. |
| **Partial** | Fetched successfully, but the pipeline's own manifest reported warnings (e.g. a sector's constituent data is incomplete). |
| **Stale** | Fetched successfully, but the latest market date is unexpectedly old - the scheduled pipeline may not be running. |
| **Cached** | Showing a snapshot saved in this browser from a previous successful fetch; nothing was re-fetched over the network just now (e.g. the page just loaded, or the latest refresh attempt failed). |
| **Unavailable** | No valid data at all - the fetch failed and there is no cached snapshot to fall back on. |

Cached data is **never** relabeled as "Live". A failed refresh **never** replaces a previously valid snapshot -
the last good data stays visible, with the failure surfaced as a separate error banner.

### Sectors tracked, and which ones aren't (and why)

The brief's sector list references 19 NSE sectoral indices. Verified against NSE's actual daily all-indices
archive on 2026-10-09, **15 of them** are published there and are fully tracked with real data:

NIFTY Auto, Bank, Financial Services, FMCG, Healthcare, IT, Metal, Oil & Gas, Pharma, Realty, PSU Bank, Private
Bank, Consumer Durables, Media, Chemicals - plus NIFTY 500 as the broad-market benchmark.

**Five are not currently tracked**: NIFTY Capital Goods, Power, Construction, Insurance, and Telecommunications.
These indices exist and have published constituent lists, but their daily closing values are **not** included
in NSE's `ind_close_all` archive (the one bulk, auth-free historical-data source this project could verify as
reliable), and `niftyindices.com`'s interactive historical-data API
(`Backpage.aspx/getHistoricaldatatabletoString`) rejected server-side requests in testing - it appears to require
browser-session state this project does not want to spoof. Rather than fabricate numbers for these five, the app
lists them explicitly (see the "Show sectors not currently tracked" control under the table) with this reason.
**The sector universe is entirely config-driven** (`src/config/sectorUniverse.ts`) - if you find a reliable
source for these five, add them there; no calculation or UI code needs to change.

NIFTY Bank, PSU Bank, and Private Bank constituents overlap heavily with NIFTY Financial Services, and NIFTY
Healthcare overlaps heavily with NIFTY Pharma. All four are still tracked and shown individually in the table,
but are excluded from the Market Overview's headline bullish/sideways/bearish counts to avoid double-counting
the same underlying stocks' breadth and regime signals (see `excludeFromHeadlineCount` in the same config file).

### Breadth methodology

Moving-average breadth (`% above 20/50/200-DMA`) is computed from each sector index's **official constituent
stocks'** own daily closing prices (fetched from the equity bhavcopy archive), never from the sector index's own
moving average. A constituent only counts toward a given window once it has enough price history for that
window (e.g. 200 trading sessions for the 200-DMA); the eligible/total counts are shown in the sector detail
view. If zero constituents have enough history for a window, that window is shown as unavailable - never
invented as 0%.

### What this project does **not** do

- It does not scrape pages that require login, defeat a CAPTCHA, or bypass NSE's bot-detection.
- It does not embed any API secret (none of the sources used require one).
- It does not call NSE from the browser - see above.
- It does not claim a statistically validated probability of anything (e.g. no "80% chance of breakout" style
  claims). The strength score and regime classification are disclosed, transparent heuristics.

---

## 2. Features

- **Sector ranking table**: 15 tracked sectors, sortable by any column, filterable by search/classification/
  minimum score, with a reset-filters control.
- **Metrics per sector**: 1D/1W/1M/3M/6M returns (computed over actual trading sessions, not calendar days),
  % of constituents above their 20/50/200-day moving averages, distance from the 52-week high, 3M relative
  performance vs NIFTY 500, a 0-9 transparent strength score, and a bullish/sideways/bearish/insufficient-data
  classification with stated reasons and a heuristic confidence level.
- **Sector detail view**: price chart, relative-strength-ratio chart (both via `lightweight-charts`), full
  returns/breadth/score breakdown, classification rationale, a short recent-classification-history strip
  (recomputed from the same price history, not stored separately), and data-quality disclosure.
- **Market overview**: NIFTY 500 returns, bullish/sideways/bearish/insufficient-data sector counts, and
  broad-market breadth.
- **Help**: a "?" icon on every metric (table headers, overview, detail view) with a formula, plain-English
  explanation and a worked example; a dedicated Help modal with the full glossary plus a worked example of why a
  strong 1D return can hide a weak 3M/6M trend.
- **Settings**: every scoring/classification threshold is editable, with defaults and explanations, applied
  instantly to already-fetched data (no re-fetch needed).
- **Export**: CSV (the ranking table) and JSON (the full computed dataset) downloads.
- **Local caching**: the last valid snapshot is cached in IndexedDB and survives a page reload; a confirmation
  dialog is required to clear it.
- **Accessible & responsive**: keyboard-navigable table rows, ARIA labels/roles on interactive elements and
  modals, and a layout that works down to phone width.

---

## 3. Project structure

```
src/
  types/            Shared TypeScript types (market data, metrics, config, dataset)
  config/            sectorUniverse.ts - the single source of truth for which sectors exist
  lib/calculations/  Pure, independently-tested functions: returns, breadth, 52w distance,
                      relative strength, scoring, regime classification, validation
  lib/dashboard.ts   Orchestrates the calculation engine over a full dataset
  lib/providers/     Data-provider abstraction (StaticSnapshotProvider reads /data/*.json)
  lib/storage/       IndexedDB cache + localStorage settings persistence
  lib/export/        CSV/JSON export
  hooks/useMarketData.ts   Refresh/cache/settings state machine used by the UI
  components/        React UI components
  content/metricGlossary.ts   The text behind every "?" help icon
scripts/             Node data-fetch pipeline (run locally or in GitHub Actions)
  fetch-constituents.mts     niftyindices.com -> public/data/constituents.json
  fetch-index-history.mts    NSE archive -> public/data/index-series.json
  fetch-stock-bhavcopy.mts   NSE archive -> public/data/stocks.json
  build-manifest.mts         Writes public/data/manifest.json
public/data/         The committed, versioned dataset snapshot the site reads
tests/               Vitest unit tests for the calculation engine
.github/workflows/   deploy.yml, update-data.yml, update-constituents.yml
```

---

## 4. Local development

Requires Node.js 20+ (built-in `fetch` and test with Node 22/24/26).

```bash
npm install
npm run dev
```

Open the printed `localhost` URL. The app auto-fetches `/data/*.json` (the data already committed in this repo)
on load and lets you click **Refresh Data** to re-fetch it.

### Refreshing the data yourself

The committed `public/data/*.json` files are a real snapshot as of when they were last generated. To pull a
newer one yourself:

```bash
npm run fetch:constituents   # rarely needed - index constituents change a few times a year
npm run fetch:index-history  # incremental: only fetches missing trading days
npm run fetch:stocks         # incremental: only fetches missing trading days (requires constituents.json)
npm run build:manifest       # always run last
```

Or all at once: `npm run fetch:all` (skips the constituents step - run that separately when needed).

These scripts are **incremental**: they read what's already in `public/data/`, work out which trading dates are
missing within the backfill window, and only fetch those - so a daily re-run is fast and doesn't re-download
history it already has. `npm run dev`'s Vite config also proxies `/nse-archives` and `/niftyindices` to the real
hosts, purely so you can poke at the raw CSVs from a browser during development if you want to; the production
site never uses this proxy.

### Tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
```

38 unit tests cover returns, 52-week-high distance, relative strength, breadth, scoring, and regime
classification - including edge cases: empty/zero-price/duplicate-date/insufficient-history input, and
deterministic-output checks.

### Type checking & build

```bash
npm run typecheck
npm run build      # tsc -b && vite build -> dist/
npm run preview    # serve the production build locally
```

---

## 5. Deploying to GitHub Pages

1. Create a new GitHub repository and push this project to it (on branch `main`):
   ```bash
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
2. In the repository's **Settings -> Pages**, set **Source** to **GitHub Actions**.
3. Push to `main` (or go to **Actions -> Build and deploy to GitHub Pages -> Run workflow**). The included
   `.github/workflows/deploy.yml` builds the site with `VITE_BASE_PATH` automatically set to
   `/<your-repo-name>/` (derived from `github.event.repository.name` - no manual config needed) and deploys it
   via `actions/deploy-pages`.
4. Your site will be live at `https://<your-username>.github.io/<your-repo>/`.

No API keys or secrets are required anywhere in this project - the data sources used need no authentication, and
none are embedded in the client bundle.

### Keeping data fresh after deployment

`.github/workflows/update-data.yml` runs on a schedule (weekdays, 14:30 UTC / 20:00 IST - a few hours after the
15:30 IST market close, to give NSE time to publish the day's archive files), fetches the latest index history
and equity bhavcopy, rebuilds the manifest, runs the test suite as a validation gate, and - only if something
actually changed - commits `public/data/*` and pushes. That push triggers `deploy.yml` automatically, so the
live site picks up the new data without any manual step.

`.github/workflows/update-constituents.yml` is manual-only (`workflow_dispatch`) - run it from the Actions tab
after NSE announces an index reconstitution.

Both workflows use the default `GITHUB_TOKEN` (with `contents: write` permission declared in the workflow file)
to commit - no additional secrets need to be configured.

---

## 6. Engineering notes

- **Calculation engine is pure and framework-free** (`src/lib/calculations/*.ts`): every function takes
  plain data in, returns plain data out, and is independently unit-tested. The UI and the Node fetch scripts
  both import the same `src/config/sectorUniverse.ts` and types, so the sector list and data shapes can't drift
  between them.
- **Missing data is a first-class value**, not an error or a zero. Every metric is typed as
  `{available: true, value} | {available: false, reason}` (`Maybe<T>` in `src/types/metrics.ts`), and every
  consumer (scoring, regime classification, UI) is written to handle the unavailable case explicitly rather than
  coercing it.
- **Scoring and regime thresholds are configurable** (Settings panel), stored in `localStorage`, and applied by
  recomputing from the already-fetched raw dataset - changing a threshold never requires a network refetch.
- **The strength score and regime classification are disclosed heuristics**, not machine-learned or statistically
  validated models. The UI says so in multiple places (header subtitle, Help modal, Settings panel).

---

## 7. Known limitations

- Five sectors from the original brief (Capital Goods, Power, Construction, Insurance, Telecommunications) are
  not tracked - see section 1.
- Breadth eligibility depends on the equity bhavcopy backfill window (300 calendar days by default, in
  `scripts/fetch-stock-bhavcopy.mts`); a freshly-cloned repo's very first `npm run fetch:stocks` run will take a
  few minutes and download roughly 70-80MB of daily bhavcopy files to build full 200-DMA eligibility. Subsequent
  runs are incremental.
- NIFTY Chemicals has less historical depth in NSE's archive than the other tracked sectors as of this writing,
  so its 52-week-high distance is currently shown as unavailable rather than computed from a partial year - this
  will resolve automatically as more daily data accumulates, or sooner if NSE backfills the archive.
- This is a demo/reference implementation of the data pipeline, not a commercial data redistribution service -
  if you deploy this publicly, review NSE's and niftyindices.com's terms of use for your intended usage.
