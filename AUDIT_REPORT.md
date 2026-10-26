# Phase 13 Audit Report — Data Accuracy and Screening/Backtest Validation

| | |
|---|---|
| Audit date | 2026-10-13 |
| Dataset audited | `public/data` as committed at `c8190cd` (scheduled run 2026-10-12 22:53 UTC). Latest market date **2026-10-09**. Index history 2025-08-18 → 2026-10-09 (283 sessions); stock history 2025-07-21 → 2026-10-09 (up to 302 sessions). |
| Deployment inspected | `https://sanoramv.github.io/Sector-Dashboard/` (renders; served by `deploy.yml` since `b775d0d`) |
| Independent source used | Yahoo Finance chart API, fetched 2026-10-13. It is a vendor feed, not an official NSE source. It was used only to cross-check, never as data. |
| Pre-deployment review | 2026-10-13, after the initial audit. It added the unverified-discontinuity and missing-session handling, the stale-stock lockout, tentative triangles and stronger backtest warnings described below. |
| Not reachable during the audit | `nsearchives.nseindia.com` timed out from the audit machine, so raw NSE files could **not** be re-downloaded and re-parsed. All checks of "what NSE published" are therefore indirect (see *Unverified*). |

**Bottom line.** The calculations match their documented formulas. Official NSE index values match an independent feed exactly. But stock-level data had two defects that produced materially wrong numbers on the live dashboard: unadjusted splits/bonuses, and stocks silently dropped when NSE moved them to the trade-for-trade series. Both are now contained, but none of this is an adjustment: no price is ever adjusted, because official adjustment factors weren't available. Metrics are simply not computed across a detected discontinuity, and corporate actions smaller than about 6:5 remain undetected. The backtest cannot support any claim of a rule's effectiveness: there is one ~14-month window, overlapping samples, and survivorship bias.

---

## Findings by severity

Status key: **Fixed** (code changed, regression test added) · **Partly fixed** · **Open** (documented, not fixed) · **Limitation** (inherent to the available data).

### Critical

#### C1. Stock prices are not adjusted for splits, bonuses or demergers — *Partly fixed*

**What.** `sec_bhavdata_full` reports raw traded prices. On an ex-date, a 1:1 bonus appears as a −50% day and a 1:10 split as −90%. Every metric that compares prices across that date was wrong: returns, moving averages and breadth, 52-week-high distance, pattern detectors, and backtest forward returns.

**Evidence.** 42 days in the dataset have both the open and the close ≥40% away from the previous close (25 of them in NIFTY 500 stocks). Each one was checked against Yahoo's split events:

- **40 of 42** are confirmed split or bonus ex-dates (e.g. HDFCBANK 2025-08-26 1:1, KOTAKBANK 2026-01-14 1:5, ANGELONE 2026-02-26 1:10, ADANIPOWER 2025-09-22 1:5).
- **2** have no split event (VEDL 2026-04-30 and INDIAGLYCO 2026-09-17). VEDL is consistent with Vedanta's demerger. Either way, prices on the two sides are not comparable.

Before the fix the live dashboard showed, for example:

| Stock | Shown | Cause |
|---|---|---|
| ANGELONE | −89.8% from its 52-week high | 1:10 split |
| AIIL | −83.4% from its 52-week high | 1:5 split |
| CAMS | −83.5% from its 52-week high | 1:5 split |
| HDFCAMC | −61.9% from its 52-week high | 1:1 bonus |

The unconditional backtest baseline also included roughly 250 forward windows that spanned a split (25 NIFTY 500 breaks × up to 10 windows each), with returns of −50% to −90%.

**Fix.** `splitAtPriceBreaks` in `src/lib/calculations/validation.ts` flags a day when both the open and the close are ≤0.6× (or ≥1/0.6×) the previous close:

- Live metrics use only the bars after the latest break. Metrics that need more history become *unavailable*, with a stated reason.
- Breadth checks for breaks using only bars up to the as-of date.
- The backtest runs each segment between breaks separately, so no holding window spans a break.
- The manifest lists every break on the homepage.

Requiring the *open* to gap as well is what separates these days from real crashes: IEX −30% (2025-07-24) and POLICYBZR −36% (2026-09-24) both opened only about 10% lower and are not flagged.

**Smaller corporate actions (see H3).** After the first pass, these smaller corporate actions were still shown with misleading raw values:

| Stock | Ex-date | Ratio | 6M return shown | With Yahoo's ratio applied | 52W-high distance shown | With Yahoo's ratio applied |
|---|---|---|---|---|---|---|
| TRENT | 2026-06-04 | 3:2 bonus (Yahoo split event) | −25.3% | +12.1% | −40.0% | −14.2% |
| BRIGADE | 2026-06-17 | 4:3 bonus | −23.6% | +1.9% | −48.7% | −31.6% |
| CUB | 2026-06-12 | 4:3 bonus | −9.3% | +20.9% | −28.6% | −7.0% |

The pre-deployment review now flags these as *unverified discontinuities* (H3), so these values show **N/A** instead. The "ratio applied" columns are for illustration only; Yahoo's ratios are not used by the app.

**Tests:** `tests/audit/phase13-defects.test.ts` → *Defect C1* (9 tests, using real HDFCBANK, KOTAKBANK, POLICYBZR and IEX bars).

**Affected stocks and date ranges.** The full list of every detected discontinuity is printed in the homepage warnings (`manifest.json`). For each affected stock, every metric uses only prices from its latest discontinuity onward. A window reaching further back shows N/A.

| Kind | Count (data to 2026-10-09) | NIFTY 500 screener stocks affected |
|---|---|---|
| Suspected corporate action (open and close both ≥40% away) | 41 days | ADANIPOWER, ANANDRATHI, ANGELONE, AIIL, BEML, CAMS, CUPID, LALPATHLAB, GODFRYPHLP, HDFCAMC, HDFCBANK, IRB, KOTAKBANK, LICI, MCX, NESTLEIND, NUVAMA, PATANJALI, PIDILITIND, TDPOWERSYS, TATAINVEST, VEDL, ZFCVINDIA, ZYDUSWELL, ECLERX |
| Unverified discontinuity (open and close both ≥15% lower) | 5 days | TRENT 2026-06-04, BRIGADE 2026-06-17, CUB 2026-06-12, TARIL 2025-11-10 (HCC 2025-12-05 is outside NIFTY 500) |
| Missing trading sessions | 21 gaps | OLAELEC (2025-09-08→2025-12-02), PFOCUS (2026-05-12→2026-07-16), SCHNEIDER (2026-02-23→2026-05-19) |

In the screener these 32 stocks carry a **"Prices from DATE only"** badge (`priceIntegrity.state = "post-discontinuity-only"`). The 42nd ≥40% break (INDIAGLYCO 2026-09-17) directly follows missing sessions, so it is counted as a gap.

### High

#### H1. Stocks moved to NSE's trade-for-trade series were silently dropped — *Fixed in code; confirmation pending the next pipeline run*

**What.** `fetch-stock-bhavcopy.mts` kept only the `EQ` and `RR` series. NSE moves stocks under surveillance to the `BE`/`BZ` series, where they keep trading. Their rows were discarded, which caused two problems:

- Their series stopped and went **stale**. The last close kept being used in breadth and industry averages and shown in the screener as if current.
- Others got **multi-week gaps**. That makes "63-session" returns span far more calendar time than labelled.

**Evidence.**

- **7 stale symbols.** Three are in NIFTY 500: HFCL (last bar 2026-09-02), MTARTECH (2026-06-24) and STLTECH (2026-05-13). The others are DIACABS, E2E, SIGMAADV and LOTUSDEV.
- **17 symbols with internal gaps.** These include NIFTY 500's OLAELEC (57 sessions), PFOCUS (44) and SCHNEIDER (54). The gaps are contiguous blocks of about a quarter, typical of surveillance-stage placement.
- **Yahoo shows normal volume on those days:** 57/57 missing sessions for OLAELEC, 58/58 for JAIBALAJI, 25/25 for HFCL, 74/74 for MTARTECH, 103/103 for STLTECH and 80/92 for EMBDL.
- **Impact.** The Telecommunication industry's 6M average return was **+41.7%** before the fix and **−0.4%** after stale constituents were excluded. Its regime changed from *sideways* to *bearish*. HFCL was ranked with a 6/10 score on prices five weeks old.

**Why only "pending".**
- The bhavcopy files couldn't be downloaded during the audit, so the specific series code (`BE` vs `BZ`) is inferred, not observed.
- As of 2026-10-13 11:25 UTC, no pipeline run has executed this code. The last scheduled run (2026-10-12) used the old `EQ`/`RR` filter, and the change isn't pushed yet.
- **Verification from actual pipeline evidence is therefore still pending.** The stale/gap containment (items 2–4 below) doesn't depend on it.

**Fix.**

1. `TRACKED_SERIES` now includes `BE` and `BZ`. A stock is only in one series per day, so no duplicate rows. The fetch also logs the number of rows kept per series.
2. Stale stocks (no bar within 7 calendar days of the market date) are excluded from breadth and industry averages.
3. In the screener, a stale stock gets **no metrics, no pattern results and no score** (0/0), so it can't rank or match a filter. It shows a "Stale since DATE" badge with its last close and date (`priceIntegrity.state = "stale"`). Currently: HFCL, MTARTECH, STLTECH.
4. The manifest lists stale and gappy symbols on the homepage.

The pipeline re-requests every date a tracked symbol is missing, so the next scheduled run should backfill these gaps.

**To confirm:**
- the Actions log line `[stocks] rows kept this run by series` shows non-zero `BE`/`BZ` counts; and
- the manifest's stale and gap warnings shrink.

**Tests:** *Defect H2* (4 tests), plus `tests/audit/real-data-invariants.test.ts`. That file runs on the committed dataset and asserts four things:
- every stale stock has no score or metrics;
- every "clean" stock has no detected discontinuity;
- breadth never counts more stocks than have current prices; and
- industry averages never include a stale stock.

#### H2. The backtest data cannot support claims of effectiveness — *Limitation*

See [Backtest audit](#backtest-audit) for the numbers. In short:

- **One short window.** It's one window of about 14 months (2025-07 → 2026-10). The near-52-week-high rule can only be evaluated from 2026-07-06 (58 signal dates), and the 200-DMA rule from 2026-05-14.
- **Correlated samples.** Samples overlap heavily, and stocks are correlated.
- **Survivorship bias.** Today's constituent list is applied to the past.
- **No out-of-sample test.** There isn't enough data for an unseen test period with a different market regime.

#### H3. No official corporate-action adjustment — *Contained where detectable; still open*

**No adjustment factor is used or estimated anywhere.** Correct adjustment needs NSE's corporate-action data:

- the `bc*.csv` inside the daily `PR*.zip` archive; or
- the corporate-actions page on `www.nseindia.com`, which needs session cookies.

Neither could be fetched or tested during the audit.

**What is done instead.** A fall where both the open and the close are at least 15% below the previous close is an **unverified discontinuity**. The 40% rule only catches large splits; this catches smaller ones, such as 3:2, 4:3 and 5:4 bonuses and larger rights issues. As with corporate-action breaks, no metric is computed across it. The stock is labelled, and Help explains that the event may be either a corporate action or a genuine fall.

In this dataset the rule flags 5 days: 4 real corporate actions (TRENT, BRIGADE, CUB, HCC) and 1 genuine −20% lower-circuit day (TARIL). For TARIL, longer-window metrics are therefore N/A even though its prices are correct; that's the price of not guessing. Rises are not checked: bonuses, splits and rights issues never raise the unadjusted price, and reverse splits exceed the 40% rule. That avoids flagging the 11 genuine +20% upper-circuit days seen (e.g. 2026-02-03).

**Still undetected, so still wrong where they occur:**
- bonuses smaller than about 6:5;
- rights issues whose price effect is under 15%;
- dividends (prices are not total-return).

A stock labelled "clean" is therefore **not** guaranteed to be correctly adjusted. This is stated in Help (*Price Integrity*).

### Medium

| ID | Finding | Status |
|---|---|---|
| M1 | **The backtest entered at the signal bar's own close.** It used the close that produced the signal, which was a mild look-ahead and optimistic. It now enters at the next session's open and exits at the close N sessions after the signal. UI and README text updated. Test: *Defect M1*. | Fixed |
| M2 | **Session-count lookbacks on gappy series.** `computeReturnOverSessions` counts the stock's own bars, so for a stock with missing sessions "63 sessions" spanned more calendar time. The relative-performance comparison then used mismatched windows. Now any NIFTY 500 calendar session missing between two of a stock's bars is a *missing-sessions* discontinuity: stock metrics, breadth, industry averages and backtest windows never span it. Tests: *missing sessions* (3). | Fixed |
| M3 | **The pattern heuristics are coarse and partly redundant.** On 2026-10-09: <br>• *Resistance* is simply the highest high of the prior 60 sessions. CPPLUS counts as "approaching resistance" at −0.09% from a high set 3 sessions earlier (2026-10-06). <br>• *Triangles* were classified from as few as 2 pivots, with no fit-quality check; DABUR was "symmetrical" from 2 + 2 pivots. **Fixed:** a triangle is now *confirmed* (scored, used in the backtest) only with ≥3 swing highs AND ≥3 swing lows, every pivot within 2% of its fitted line. Otherwise it is *tentative*: shown as "Tri?" with the reason, never scored. On 2026-10-09: 4 confirmed (ANANTRAJ, ANURAS, GLAND, VBL), 23 tentative (DABUR and AFFLE included). Tests use the real DABUR/AFFLE windows. <br>• The composite stock score counts near-52-week-high and approaching-resistance separately, though they largely overlap. <br>• None of the heuristics show a positive edge over the unconditional baseline in raw net terms (see below). | Triangle: fixed. Others: open (documented; no evidence these detect what their names imply) |
| M4 | **The app backtest reports win rate, mean, median and stdev against an unconditional baseline only.** It does not report benchmark-relative return, drawdown or exposure. The extended analysis below was computed with `scripts/audit/backtest-extended.mts`; it was not added to the app (no new features this phase). | Open |
| M6 | **The backtest UI understated its limits** and never showed the engine's per-rule "too few signals" warning. The panel now opens with "This is NOT evidence that any rule is profitable" and states the ~14-month single-regime history, overlapping trades, unadjusted prices, and in-sample tuning via Settings. It also lists the small-sample warning for any rule with n < 30. | Fixed |
| M5 | **Constituent lists have no effective date.** `constituents.json` records only `fetchedAt` (2026-10-09T20:10Z). The update workflow is manual-only, so the list is current only as of whenever it was last run. Current lists are applied to all past dates: in the backtest, and in the 5-session regime history. | Limitation |

### Low

| ID | Finding | Status |
|---|---|---|
| L1 | **The 52-week-high Help text didn't match the code.** It said "highest close"; the code uses the highest *intraday high* (the more common definition). Help now states the intraday high and the ~1-year history requirement. Test: *Defect L1*. | Fixed |
| L2 | **Every run re-downloads the full history.** Placeholder symbols (`DUMMYHEG`, `DUMMYINGL1/2`, `DUMMYINXGN`) and `TRIVENIPT` never have bars, so every target date counts as "missing". About 300 bhavcopy files are re-downloaded daily. This costs time and load on NSE but doesn't affect accuracy. | Open |
| L3 | **The Diwali Muhurat session (2025-10-21) counts as a full session in session-count lookbacks.** | Open (negligible) |
| L4 | **Index history starts 2025-08-18, 19 sessions after stock history**, so the benchmark-relative backtest loses those dates. NIFTY Chemicals starts 2025-11-10, so its 52-week high correctly shows *unavailable*. | Limitation |
| L5 | **The "stale" status uses calendar days.** Both the provider (5 days) and the stock check (7 days) count calendar days, not NSE sessions. A long holiday run could briefly mislabel data. | Open (negligible) |

### Checked and found correct

- **Missing data is never zero-filled.** Every metric is a `Maybe` with a reason, averages exclude unavailable inputs, and score conditions that can't be evaluated leave the denominator. The exception was stale prices (H1), now fixed.
- **No look-ahead in the signals.**
  - Signal functions receive `bars.slice(0, t+1)` and a benchmark truncated to the same date.
  - Breadth filters bars ≤ as-of date before validating.
  - Regime history re-runs the engine on truncated series.
  - Discontinuity segmentation uses only the two adjacent bars and the calendar dates between them.
  - One subtle exception: the backtest drops windows that would *span* a future ex-date. Ex-dates are announced in advance, so the selection effect is small, but it is not zero.
- **Index data is clean.** No duplicate dates, no OHLC inconsistencies, and every sector series is on the same calendar as NIFTY 500.
- **Holidays and weekends are handled correctly.** Lookbacks count trading sessions, not calendar days. The 17 weekday non-trading dates in the window match closures — for example, 2026-01-15 has a zero-volume stub in Yahoo's stock feed.
- **Official indices and computed aggregates are clearly separated.** Sector and market-cap figures come from official NSE index values; industry figures are labelled as equal-weighted averages of constituents (Help: *Industry Average Metrics*).
- **Scores match their Help text.** The sector score (9 points) and the stock score (10 points) match `metricGlossary.ts`: conditions, points, and strict `>` thresholds at exactly 50% breadth.

---

## Data verification results

### Verified

| Check | Sample | Result |
|---|---|---|
| Index closes vs Yahoo | NIFTY 500 (`^CRSLDX`), Bank (`^NSEBANK`), IT (`^CNXIT`), Pharma (`^CNXPHARMA`) | 282/282, 283/283, 283/283, 282/282 dates identical (diff 0.000%). Our 2026-01-01 bar is absent from Yahoo's index feed but present in its stock feed. |
| Stock closes vs Yahoo | 23 stocks (RELIANCE, TCS, INFY, SBIN, ICICIBANK, ITC, LT, BSE, CDSL, SUZLON, HDFCBANK, KOTAKBANK, ANGELONE, PIDILITIND, HFCL, MTARTECH, STLTECH, SCHNEIDER, …) | Every date both sources have is identical, except pre-ex-date bars of split/bonus stocks, which differ by exactly the split ratio (expected: Yahoo adjusts, NSE doesn't). |
| Corporate-action breaks | All 42 days with both open and close ≥40% from the previous close | 40 match a Yahoo split event on the same date; 2 are non-split breaks (VEDL, INDIAGLYCO). |
| Formula implementation | 5 sectors × (1D/1W/1M/3M/6M returns, 3M relative performance, 52-week-high distance, 50-DMA breadth) + 8 stocks × (comparable-history start, 1M, 3M, above-50-DMA), including split, unverified-discontinuity, gap and stale cases | **72/72** independent recomputations agree with the app to 1e-6 (`scripts/audit/independent-recompute.mts`, which states the discontinuity and staleness rules independently of the app code). |
| Market-cap universes | Midcap 150 ⊂ NIFTY 500 | 150/150 confirmed |
| | Smallcap 250 ⊂ NIFTY 500 | 251/251 confirmed |
| | Microcap 250 ∩ NIFTY 500 | 0/254 (no overlap), as documented |
| Industry labels | 20 NSE industries across 501 NIFTY 500 constituents | No symbol carries different industry labels in different lists. |

### Unverified (assumptions)

- **Raw NSE files weren't re-parsed.** NSE archives were unreachable. The parser is trusted on the strength of the exact Yahoo matches.
- **Most index series weren't cross-checked.** Only 4 of 19 index series (NIFTY 500, Bank, IT, Pharma) were. For the other 7 sector indices tried (Auto, FMCG, Metal, Realty, PSU Bank, Media, Financial Services), Yahoo returned no rows. Midcap 150 and Smallcap 250 returned 404. Healthcare, Private Bank, Consumer Durables, Chemicals and Microcap 250 weren't tried.
- **The `BE`/`BZ` series codes are inferred** (H1).
- **The constituent lists weren't checked against NSE's latest reconstitution circular**, so their effective date is unknown (M5).
- **The holiday calendar wasn't checked against NSE's official holiday circulars.**
- **No microcap stock was cross-checked individually.** Microcaps entered the sample only through gap checks.

---

## Screening and pattern audit

Examples are from the 2026-10-09 dataset (`scripts/audit/rule-examples.mts`).

**Sector score / regime**

- **NIFTY Pharma — 6/9, sideways (medium confidence).**
  - FAIL: 1M −3.42%; 20-DMA breadth 25%; 50-DMA breadth 30%.
  - PASS: 3M +1.12%; 6M +18.06%; 200-DMA breadth 65%; 3M relative performance +7.47 pp (2 points); 52-week-high distance −4.74%.
  - Not bullish because 1M is negative and only 1 of 3 breadth measures is above 50%. 1M vs 6M conflict flagged.
- **NIFTY Auto — 0/9, bearish (high confidence).** 1M −10.50%, 3M −7.45%, 6M −4.40%, relative performance −1.10 pp, breadth 0% / 0% / 26.7%, −16.76% from its 52-week high.
- **NIFTY Chemicals — 3/8.** The 52-week-high condition is *N/A* (333 days of history, 350 needed), so the denominator is 8, not 9. This is correct missing-data behaviour.

**Stock patterns** (501 NIFTY 500 stocks; currently 12 approaching resistance, 0 consolidating, 4 confirmed + 23 tentative triangles)

| Stock | Detector | Result | Exact metrics |
|---|---|---|---|
| CPPLUS | Resistance | PASS (ambiguous) | Level 4188.9 set 2026-10-06; close 4185.2 = −0.09%. The "resistance" is 3 sessions old. |
| AETHER | Resistance | FAIL (boundary) | −3.64% from 1814.1; threshold 3%. |
| CPPLUS | Consolidation | FAIL | Recent range 4.72% / baseline 4.49% = 1.052 > 0.6 |
| AFFLE | Triangle | **Tentative** (was PASS) | Shape "symmetrical": high slope −0.496%/session (3 pivots), low slope +0.098%/session (only 2 pivots) |
| DABUR | Triangle | **Tentative** (was PASS) | Shape "symmetrical" from only 2 swing highs + 2 swing lows. Any two points define a line. |

The pattern labels are descriptive only. Nothing in this audit shows they identify the chart patterns their names suggest, or that they predict anything.

---

## Backtest audit

**Implementation, as reviewed:**

- Signal on bar *t*, using bars ≤ *t* only. Entry at the open of *t+1*; exit at the close of *t+10*.
- 20 bps flat round-trip cost.
- Universe: today's NIFTY 500 constituents with data (~500).
- Every session is a candidate signal (heavily overlapping).
- No significance test, which is correct given the overlap.

**App results after all fixes** (hold 10 sessions, 20 bps, `npx tsx scripts/audit/backtest-extended.mts . app`). The unconditional baseline is n = 141,703, average net −0.088%.

| Rule | n | Win % | Avg net % | Median net % | Edge vs baseline (pp) |
|---|---|---|---|---|---|
| Near 52-week high | 3,481 | 41.3 | −0.52 | −0.94 | −0.43 |
| Above own 200-DMA | 22,576 | 43.7 | −0.22 | −0.79 | −0.13 |
| Above own 50-DMA | 57,481 | 45.5 | −0.04 | −0.60 | +0.05 |
| 3M return positive | 54,903 | 44.7 | −0.10 | −0.68 | −0.01 |
| 3M relative performance positive | 49,692 | 47.0 | +0.24 | −0.41 | +0.33 |
| Approaching resistance | 12,553 | 44.5 | −0.36 | −0.65 | −0.27 |
| Consolidating | 208 | 43.3 | −0.51 | −0.72 | −0.42 |
| Triangle (confirmed only) | 3,810 | 41.3 | −0.64 | −1.02 | −0.55 |
| Composite score ≥ 6 | 18,861 | 45.4 | −0.10 | −0.57 | −0.01 |

**Extended analysis** (independent harness: same entry/exit/cost; relative = net return minus NIFTY 500's open-to-close return over the same dates):

| Rule | Avg vs NIFTY 500, all signals (pp) | Same, non-overlapping (pp, n) | Earlier 60% / later 40% of window (pp) |
|---|---|---|---|
| **Always-true baseline** | **+0.12** | **+0.11 (13,180)** | **+0.15 / +0.08** |
| Near 52-week high | +0.28 | +0.14 (559) | — / +0.28 (only later period evaluable) |
| Above own 200-DMA | +0.16 | +0.12 (2,612) | — / +0.16 |
| 3M relative performance positive | +0.53 | +0.41 (5,880) | +0.89 / +0.25 |
| Composite score ≥ 6 | +0.42 | +0.56 (3,122) | +0.78 / +0.31 |
| Triangle (confirmed only) | −0.11 | −0.31 (777) | −0.36 / +0.31 |
| Consolidating | +0.04 | +0.75 (48) | −1.55 / +0.45 |

**How to read these numbers:**

- **The baseline beats the index.** Even the always-true baseline is about +0.12 pp per trade against NIFTY 500. That comes from survivorship (today's survivors), equal weighting versus a cap-weighted index, and the next-open/close convention. So any rule's "relative" figure must be compared with the baseline, not with 0.
- **3M relative performance and the composite score look strongest,** at +0.3 to +0.4 pp over the baseline. Both decay from the earlier period to the later one, and the composite score includes the relative-performance condition. With overlapping windows and cross-stock correlation, the number of independent observations is far below n. **This is not evidence of an edge,** and no significance is claimed.
- **Only one market regime is covered.** NIFTY 500 was range-bound over the window. It peaked at 24,099 on 2026-01-02, fell to 20,528 on 2026-03-30 (−14.8%), and closed at 21,867 on 2026-10-09. There is no bull-trend period and no unseen test period.
- **Not computed:** drawdown and exposure per rule; capacity and liquidity; a point-in-time universe; adjusted prices for sub-40% corporate actions (H3).
- **Parameter tuning:** the defaults (thresholds of 50%, 5%, 3%, 0.6, 40 sessions, …) were chosen a priori, not optimised on this data. The triangle confirmation thresholds (3 pivots, 2%) were also set a priori, before looking at their backtest results. Users can change the other thresholds in Settings and re-run the backtest on the same window. That is in-sample tuning, and the UI now warns about it.

**Effect of the fixes on the app backtest** (before → after):

- Baseline average: −0.087% (original) → −0.094% (first audit pass) → −0.088% (after excluding windows across unverified discontinuities and session gaps).
- Consolidating: n 252 → 208; average −1.06% → −0.51%. Some of its worst "returns" were splits.
- Triangle: n 17,932 → 3,810 once tentative two-pivot shapes stopped counting. Confirmed triangles did *worse* than the baseline (−0.55 pp). A stricter definition doesn't make the detector predictive.

---

## What is needed next (evidence, not features)

1. **Confirm H1 (pending).** After these changes are pushed, watch the next `Update NSE sector data` run. The `rows kept this run by series` log should show `BE`/`BZ` rows, and the stale and gap warnings on the homepage should shrink or clear.
2. **Fix H3 properly.** Get official corporate-action factors (NSE `PR*.zip` → `bc*.csv`) and back-adjust stock series. Then re-run `scripts/audit/yahoo-crosscheck.mts` and expect all stored prices to match Yahoo's adjusted closes.
3. **Get point-in-time constituents** (NSE index reconstitution circulars) before using the backtest for anything beyond exploration.
4. **Get at least 3–5 years of history** covering distinct regimes, with a held-out test period fixed in advance.
5. **Cross-check the 15 unchecked index series** against niftyindices.com historical data, by hand if necessary.

---

## Incident addendum: data stuck at 2026-10-09 (investigated 2026-10-26)

**Confirmed root causes**

1. **NSE dropped the pipeline's requests.** Reproduced directly against `nsearchives.nseindia.com`: the old User-Agent `Mozilla/5.0 (compatible; nse-sector-dashboard-data-fetch/1.0; +https://github.com)` got no HTTP response (Node `fetch` failed in 164 ms locally; on GitHub runners requests hung until the 20/30 s abort). With an otherwise identical request, `Mozilla/5.0 (compatible; nse-sector-dashboard/1.0)` returns HTTP 200 and the valid file. UAs containing a URL or the word "fetch" were rejected. No cookies, Referer or session are needed. When NSE started rejecting the old UA is unknown; earlier downloads with it worked.
2. **Failures were invisible.** `fetchTextOrNull` forced `retries: 0` (hence "after 1 attempts"), a failed date was only `console.warn`-ed, and the scripts exited 0. Every scheduled run from 12 to 23 Oct went green while adding no market date (each data commit only pruned the oldest bar).
3. **Every run re-downloaded the whole window.** A date "needed fetching" if any series lacked it; placeholder `DUMMY*` symbols never have rows (stocks: 300 of 300 dates every run) and NIFTY Chemicals launched mid-window (index: 47 extra dates). With every request hanging to its timeout, this made each run take ~43 minutes.
4. **Data commits could fail:** the commit step pushed without rebasing, and two runs' pushes failed after `main` moved.
5. **Deploys were blocked by a flaky test:** `snapshotHistory.test.ts › is deterministic` compared two `new Date()` timestamps, failing when the clock ticked between calls (3 failed deploys).
6. **NSE serves the previous session's bhavcopy on holidays** (e.g. 2026-10-02 returns DATE1 01-Oct-2026), so "HTTP 200" is not proof a date traded. The old code happened to dedupe this harmlessly; the new code uses it as positive non-trading evidence.

**Fix** (see README *Keeping data fresh*): shared retrieval layer with an accepted User-Agent, bounded retries, backoff with jitter, `Retry-After`, pacing and content validation; a per-date refresh state; complete/partial/failed evaluation in the manifest; a workflow gate that fails after committing valid data; rebasing commits; and a frozen clock in the flaky test.

**Recovery (local run through the new layer, 2026-10-26):** the index fetch recovered 12, 13, 14, 15, 16, 19, 21, 22 and 23 Oct (20 Oct: 404 at both archives = Dussehra holiday). A one-time 300-date stock re-extraction under the EQ/RR/BE/BZ set took 2 minutes, with every request answered on the first attempt. It kept 1,319 `BE` rows. Stale stocks went 7 → 0 and gappy stocks 17 → 2. The two remaining gaps (CCAVENUE 13–16 Oct, EMBDL 9 Apr–5 May) were checked in the official files: those symbols appear in no series on those days.

**This closes the H1 "pending" item:** the official 2026-10-23 bhavcopy lists `HFCL, BE`.

**Not verified yet:** that GitHub-hosted runners also get responses with the new User-Agent. That needs one workflow run (see README).
