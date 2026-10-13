# Validation Checklist

A repeatable set of manual spot checks. Run it after any pipeline change, any calculation change, or at least monthly. Record the date, the dataset's `latestMarketDate` and the result of every item in a copy of the log table at the bottom.

Expected values marked **(2026-10-09)** were computed from the dataset audited on 2026-10-13. When you re-run on a newer dataset, recompute them with the same formula rather than expecting identical numbers.

## 0. Automated checks first

```bash
npm run test          # 130 tests, including tests/audit/phase13-defects.test.ts and real-data-invariants.test.ts
npm run typecheck
npm run build
npx tsx scripts/audit/independent-recompute.mts      # expect "N/N independent checks agree" (72/72 on 2026-10-09)
```

Any failure here means stop; the manual checks below don't matter until it's fixed.

## 1. Freshness and pipeline health

| # | Check | How | Expected |
|---|---|---|---|
| 1.1 | The latest market date is the last NSE session | Compare `manifest.json → latestMarketDate` with NSE's trading calendar | Equals the last completed session before the pipeline ran (20:00 IST weekdays) |
| 1.2 | The pipeline ran | GitHub → Actions → *Update NSE sector data* | Last run succeeded within one weekday |
| 1.3 | The deploy followed it | Actions → *Build and deploy to GitHub Pages* (trigger `workflow_run`) | Ran after 1.2 and succeeded |
| 1.4 | Trade-for-trade series are captured | Log line `[stocks] rows kept this run by series` in the 1.2 run | Non-zero `BE` and/or `BZ` counts, whenever a backfill happened that run |
| 1.5 | Homepage warnings are understood | Homepage → *Data quality warnings* | Every listed symbol has a known reason (placeholder, not yet trading, stale, gap, or corporate-action break). New stale or gap symbols → investigate. |
| 1.6 | The live site is built, not raw source | Open the site; *View source* | `<script src="/Sector-Dashboard/assets/index-*.js">`, not `/src/main.tsx` |

## 2. Index data against an independent source

Run `npx tsx scripts/audit/yahoo-crosscheck.mts ^CRSLDX:nifty500 ^NSEBANK:bank ^CNXIT:it ^CNXPHARMA:pharma`.

Expected: `closes within 0.05%: N/N` for each. **(2026-10-09)** 282/282, 283/283, 283/283, 282/282.

For one index Yahoo doesn't carry (e.g. NIFTY Auto), check by hand:

1. On niftyindices.com → *Historical Data*, look up NIFTY Auto's close for the latest date.
2. Compare it with `index-series.json → auto` for the same date. **(2026-10-09)** 24859.90.

## 3. Return, relative-strength and 52-week calculations (by hand)

Use `public/data/index-series.json`. "T−n" means the n-th earlier bar in the array, not n calendar days.

| # | Metric | Inputs (2026-10-09) | Expected | Where in the UI |
|---|---|---|---|---|
| 3.1 | NIFTY IT 1D | T 28574.90; T−1 (2026-10-08) 27736.60 | (28574.90 / 27736.60 − 1) × 100 = **+3.02%** | Sector table, IT row, 1D |
| 3.2 | NIFTY IT 1W | T−5 (2026-10-01) 28304.70 | **+0.95%** | 1W |
| 3.3 | NIFTY IT 1M | T−21 (2026-09-08) 29883.45 | **−4.38%** | 1M |
| 3.4 | NIFTY IT 3M | T−63 (2026-07-10) 28010.35 | **+2.02%** | 3M |
| 3.5 | NIFTY IT 6M | T−126 (2026-04-08) 31565.80 | **−9.48%** | 6M |
| 3.6 | IT 3M relative performance | NIFTY 500 T 21866.65, T−63 23348.40 → −6.35% | 2.02 − (−6.35) = **+8.36 pp** | IT detail → Relative performance |
| 3.7 | Pharma 52-week-high distance | Highest *intraday high* from 2025-10-09 to 2026-10-09 = 27255.05 (2026-09-24); close 25962.05 | **−4.74%** | Pharma row, 52W |
| 3.8 | Chemicals 52-week high is unavailable | History starts 2025-11-10 (333 days < 350) | Shown as **N/A**, with the reason; score out of 8, not 9 | Chemicals row |

## 4. Stock data and corporate actions

| # | Check | Expected |
|---|---|---|
| 4.1 | `npx tsx scripts/audit/yahoo-crosscheck.mts RELIANCE TCS SBIN INFY` | All `N/N`; "sessions Yahoo shows traded … but we lack: 0" |
| 4.2 | RELIANCE 1M by hand | Close 1170.30 (2026-10-09) / 1294.90 (2026-09-08) − 1 = **−9.62%** (2026-10-09) |
| 4.3 | RELIANCE vs its 50-DMA | Mean of the last 50 closes (2026-07-30 … 2026-10-09) = 1271.79; close 1170.30 → **below** |
| 4.4 | A known split is contained | KOTAKBANK detail (1:5 split 2026-01-14): data-quality warning names the corporate action; 52-week-high distance is **N/A**, not ≈ −80% |
| 4.5 | A genuine crash that opened near the prior close is NOT treated as a discontinuity | POLICYBZR (−36% close but −10% open on 2026-09-24): badge absent; its returns include the fall. (A crash that also *opens* 15%+ lower, like TARIL on 2025-11-10, IS flagged as unverified; that's expected and stated.) |
| 4.6 | Smaller bonuses are contained, not adjusted (H3) | TRENT (3:2, 2026-06-04), BRIGADE and CUB (4:3): badge "Prices from DATE only"; Price-integrity note says *unverified discontinuity*; 6M return and 52W distance show **N/A**. They must never show the raw −25% / −40% (TRENT). Once official factors exist, they should show adjusted values instead. |
| 4.6b | A stale stock can't rank | HFCL / MTARTECH / STLTECH (while stale): badge "Stale since DATE", score 0/0, every metric N/A, absent from the "score ≥ N" filter results |
| 4.7 | New breaks | For each new symbol in the homepage corporate-action warning, look up NSE's corporate-action announcement and confirm a split, bonus or demerger on that date. A genuine price move listed there is a **false positive**: record it. |

## 5. Breadth

1. Open the NIFTY IT detail. **(2026-10-09)** % above 50-DMA = **20%** (2 of 10 eligible).
2. For each of the 10 constituents (COFORGE, HCLTECH, INFY, LTM, MPHASIS, OFSS, PERSISTENT, TCS, TECHM, WIPRO), compare the latest close with the mean of its last 50 closes in `stocks.json`. Exactly 2 should be above.
3. Stale stock: HFCL (last bar 2026-09-02 in the audited data). It must **not** be counted in NIFTY 500 / Smallcap 250 breadth, and the screener must show the badge "Stale since 2026-09-02" with score 0/0.

## 6. Universe and classification

| # | Check | Expected |
|---|---|---|
| 6.1 | NIFTY 500 count | `constituents.json → nifty500` has ~500 entries (501 including `DUMMYHEG` in the audited data). Compare with niftyindices.com's current `ind_nifty500list.csv`. |
| 6.2 | Last reconstitution applied | The latest NSE index-reconstitution circular's inclusions and exclusions appear in or are absent from the list. `fetchedAt` is after the circular's effective date. |
| 6.3 | Subset relationships | Midcap 150 and Smallcap 250 fully inside NIFTY 500; Microcap 250 has 0 overlap (also covered by `tests/data/marketCapUniverse.test.ts`) |
| 6.4 | Industry labels | Spot-check 5 symbols' `industry` against NSE's quote page "Industry" field |

## 7. Scores, regimes and patterns

| # | Check | Expected (2026-10-09) |
|---|---|---|
| 7.1 | NIFTY Pharma score | **6/9**. PASS: 3M, 6M, 200-DMA breadth (65%), 3M relative performance (+7.47 pp, 2 points), 52W (−4.74%). FAIL: 1M (−3.42%), 20-DMA breadth (25%), 50-DMA breadth (30%). |
| 7.2 | NIFTY Pharma regime | **Sideways**, because 1M is negative and only 1 of 3 breadth measures is above 50%; 1M vs 6M conflict flagged |
| 7.3 | NIFTY Auto | **0/9, bearish, high confidence** |
| 7.4 | Resistance boundary | AETHER at −3.64% from its 60-session high → **not** approaching (threshold 3%) |
| 7.5 | Triangle confidence | Only "Tri" (confirmed: ≥3 pivots per line, all within 2%) earns a score point; "Tri?" (tentative) never does. DABUR and AFFLE on 2026-10-09 must be "Tri?". Inspect 3 confirmed triangles on a chart and record whether a human would call them triangles. (2026-10-09: 4 confirmed, 23 tentative.) |
| 7.6 | Help matches code | For each metric changed since the last check, compare the formula in `src/content/metricGlossary.ts` with the implementation |

## 8. Backtest sanity

1. Backtest tab → run with the defaults (10 sessions, 20 bps).
2. Record the number of rules and the baseline n and average. **(2026-10-09)** Baseline n = 141,703, average −0.088%.
3. Confirm the box above the results says it is **not evidence of profitability**, and mentions survivorship bias, next-open execution, the short ~14-month history, overlapping trades, unadjusted prices and in-sample tuning. Any rule with n < 30 must show its small-sample warning.
4. Treat any rule whose "edge" changes sign between runs on adjacent data dates as noise.

## Log

| Date run | latestMarketDate | Section | Item | Result (pass/fail/value) | Notes / source checked | By |
|---|---|---|---|---|---|---|
| 2026-10-13 | 2026-10-09 | 0–8 | all | See `AUDIT_REPORT.md` | Yahoo Finance chart API (fetched 2026-10-13); NSE archives unreachable that day | Phase 13 audit |
