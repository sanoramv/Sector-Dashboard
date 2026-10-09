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
  - `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv` - daily OHLC data for
    every listed equity (used for moving-average breadth, 52-week-high distance, and pattern detection, all
    computed from real constituent stock prices - not just closing prices).
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

The dashboard has five tabs: **Sectors**, **Industries**, **Stock Screener**, **Backtest**, and **History**.

- **Sectors tab**: 15 tracked NIFTY sectoral indices, sortable/filterable ranking table. Per sector: 1D/1W/1M/3M/6M
  returns (actual trading sessions, not calendar days), % of constituents above their 20/50/200-day moving
  averages, distance from the 52-week high, 3M relative performance vs NIFTY 500, a 0-9 transparent strength
  score, and a bullish/sideways/bearish/insufficient-data classification with stated reasons and a heuristic
  confidence level. The detail view adds a price chart, a relative-strength-ratio chart, and a recent-
  classification-history strip (recomputed from price history, not stored separately).
- **Industries tab**: all ~20 of NSE's official macro-industry classifications (sourced from the same
  constituent-list CSVs' "Industry" column), each with equal-weighted average returns/breadth/score/regime
  computed from real constituent stocks - since NSE doesn't publish a price index for most industries, this is
  explicitly disclosed as a derived aggregate, not an official index value. This also gives real visibility into
  Capital Goods, Power, Construction and Telecommunication, whose official sector index isn't tracked (see
  section 1), via their real constituent stocks instead.
- **Stock Screener tab**: all ~500 NIFTY 500 constituents, filterable by sector/industry/"leading only"/pattern
  checkboxes/minimum score. Screens for proximity to the 52-week high, approaching a prior resistance level,
  trading-range consolidation, and a simplified triangle price-structure heuristic (swing-pivot trendlines) -
  every pattern is a disclosed, parameterized heuristic, not a validated chart-pattern recognizer, with the exact
  window/threshold shown. A separate 0-10 stock-level score and full pass/fail reason list is shown per stock.
  The detail view carries an explicit "not a recommendation, no entry/stop/target" disclaimer.
- **Backtest tab**: runs every screening rule above against the full available price history with no look-ahead
  by construction, reporting forward-return evidence (sample size, win rate, average/median net return) against
  an unconditional baseline - with explicit survivorship-bias, execution-assumption, and small-sample
  disclosures, and no fabricated significance test. See section 6.
- **History tab**: a compact local record of regime counts and top rankings every time a fresh refresh succeeds,
  so you can see how things evolved across sessions (kept only in this browser's local storage).
- **Help**: a "?" icon on every metric (table headers, overview, detail views) with a formula, plain-English
  explanation and a worked example; a dedicated Help modal with the full glossary.
- **Settings**: every scoring/classification/pattern-detection threshold is editable, with defaults and
  explanations, applied instantly to already-fetched data (no re-fetch needed).
- **Export**: CSV (sector table, stock screen) and JSON (the full computed dataset, the history log) downloads.
- **Local caching**: the last valid snapshot is cached in IndexedDB and survives a page reload; a confirmation
  dialog is required to clear it.
- **Accessible & responsive**: keyboard-navigable table rows, ARIA labels/roles on interactive elements and
  modals, and a layout that works down to phone width.

---

## 3. Project structure

```
src/
  types/             Shared TypeScript types (market data, metrics, config, dataset,
                      industry, stockScreen, snapshotHistory)
  config/            sectorUniverse.ts - the single source of truth for which sectors exist
  lib/calculations/  Pure, independently-tested functions: returns, breadth, 52w distance,
                      relative strength, scoring, regime classification, validation,
                      industry aggregation, pattern detection (resistance/consolidation/
                      triangle), stock-level scoring/assembly
  lib/backtest/      Look-ahead-safe backtest engine, the rule catalog, and the
                      dataset-level orchestrator (src/lib/backtest/engine.ts has the
                      core no-look-ahead loop)
  lib/dashboard.ts   Orchestrates the calculation engine over a full dataset
  lib/providers/     Data-provider abstraction (StaticSnapshotProvider reads /data/*.json)
  lib/storage/       IndexedDB cache, localStorage settings, local snapshot history
  lib/export/        CSV/JSON export
  hooks/useMarketData.ts   Refresh/cache/settings/history state machine used by the UI
  components/        React UI components (one pair of Table+DetailPanel per tab)
  content/metricGlossary.ts   The text behind every "?" help icon
scripts/             Node data-fetch pipeline (run locally or in GitHub Actions)
  fetch-constituents.mts     niftyindices.com -> public/data/constituents.json (incl. Industry)
  fetch-index-history.mts    NSE archive -> public/data/index-series.json
  fetch-stock-bhavcopy.mts   NSE archive -> public/data/stocks.json (full OHLC)
  build-manifest.mts         Writes public/data/manifest.json
public/data/         The committed, versioned dataset snapshot the site reads
tests/               Vitest unit tests (calculation engine + backtest engine + storage)
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

78 unit tests cover returns, 52-week-high distance, relative strength, breadth, scoring, regime classification,
industry aggregation, pattern detection (resistance/consolidation/triangle, on synthetic fixtures with known
expected slopes), stock-level scoring/assembly, the backtest engine (including an explicit structural check that
no signal function is ever handed data past its evaluation date), and local snapshot-history summarization -
including edge cases: empty/zero-price/duplicate-date/insufficient-history input, and deterministic-output checks.

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

## 6. Backtesting methodology

The Backtest tab (`src/lib/backtest/`) exists because the engineering brief for the screening features explicitly
requires evidence before any rule's language could be read as a claim of effectiveness. Design:

- **No look-ahead by construction**: at every evaluation date `t`, the rule's signal function is only ever handed
  price bars up to and including `t` (and, for rules needing the benchmark, NIFTY 500 bars independently
  truncated to the same date). This is verified by an explicit structural test
  (`tests/backtest/engine.test.ts`), not just asserted in a comment.
- **Forward return**: assumes entry at `t`'s own closing price and exit at the closing price exactly N sessions
  later (N configurable) - a simplifying assumption, not a realistic fill. Net return subtracts a configurable
  flat round-trip cost (basis points) for transaction costs and slippage.
- **Baseline comparison**: every rule's conditional forward-return sample is compared against the *unconditional*
  forward-return sample over the same universe and dates - "what if you'd held anything, regardless of the
  signal" - so a rule can be judged against doing nothing special, not against zero.
- **No significance test**: observations overlap in time (rolling windows) and are correlated across related
  stocks (same sector/industry moving together), so a naive t-test's p-value would be misleading. Sample size,
  win rate and average/median return are reported as descriptive evidence only; a "too few observations" warning
  appears below a configurable minimum (30).
- **Survivorship bias is explicit and unavoidable with this data source**: today's NIFTY 500 constituent list is
  applied across the entire backtest window, since no point-in-time historical constituent list is available from
  the sources this project uses. This tends to inflate results relative to a true point-in-time universe, and the
  UI says so on every run.
- **Run it yourself**: all 9 current rules (every Stock Screener condition, including the composite 0-10 score)
  are evaluated against the real ~500-stock universe in `src/lib/backtest/rules.ts`. As of this writing, most show
  a small negative or near-zero edge versus baseline over the available ~1-year window (a volatile, single-regime
  sample during a broad market selloff) - an unflattering, honestly-reported result, not a validated edge.

## 7. Engineering notes

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
- **Score aggregation is shared, not duplicated**: sector, industry and stock scoring all call the same
  `aggregateScoreConditions` helper (`src/lib/calculations/scoring.ts`) - each defines its own list of conditions,
  but the "missing data is excluded from both earned and possible points, never scored as a failure" rule is
  implemented once.

---

## 8. Known limitations

- Five sectors from the original brief (Capital Goods, Power, Construction, Insurance, Telecommunications) have
  no official NSE index tracked - see section 1. Real constituent-stock data for most of them is still viewable
  under the Industries tab.
- Breadth/52-week-high eligibility depends on the equity bhavcopy backfill window (420 calendar days by default,
  in `scripts/fetch-stock-bhavcopy.mts` - extended from an initial 300 days specifically so stock-level 52-week-
  high distance is computable); a freshly-cloned repo's very first `npm run fetch:stocks` run will take several
  minutes and download roughly 100-110MB of daily bhavcopy files. Subsequent runs are incremental.
- NIFTY Chemicals has less historical depth in NSE's archive than the other tracked sectors as of this writing,
  so its 52-week-high distance is currently shown as unavailable rather than computed from a partial year - this
  will resolve automatically as more daily data accumulates, or sooner if NSE backfills the archive.
- The industry and stock-screener universe is NIFTY 500 constituents; a stock only present in a narrower tracked
  sector index but not in NIFTY 500 (none currently observed in practice) would not appear there.
- Backtest results reflect a short (~1 year), single-regime, survivorship-biased sample - see section 6. Treat
  them as preliminary evidence, not proof of anything.
- This is a demo/reference implementation of the data pipeline, not a commercial data redistribution service -
  if you deploy this publicly, review NSE's and niftyindices.com's terms of use for your intended usage.
