# NSE Sector Strength Dashboard — User Guide

**Live site:** <https://sanoramv.github.io/Sector-Dashboard/> · **In a hurry?** Read the [Quick Start](QUICK_START.md) first.

> **Read this first.** The dashboard is a **research and screening tool**. It is not a trading system, it gives **no buy or sell recommendation, no entry price, no stop-loss and no target**, and nothing in it is investment advice. Its scores are **counts of rule checks**, not probabilities. Its data is **end-of-day**, not real-time. Where the project has measured whether its signals help predict the next session, the result was **no reliable edge** (see [Chapter 10](#10-scores-and-historical-evaluation)).

**How this guide was written.** Every metric below was traced to the source code in `src/` (and the pipeline in `scripts/`) and compared with the deployed site's JavaScript bundles. Numerical examples are labelled **illustrative** — they are made-up round numbers, not market data. Places where the application differs from what you might expect are called out as **Note** boxes, and are collected in [Appendix A](#appendix-a-verification-notes-and-discrepancies).

---

## Table of contents

1. [Introduction](#1-introduction)
2. [Understanding the dashboard](#2-understanding-the-dashboard)
3. [Market overview](#3-market-overview)
4. [Sector and industry analysis](#4-sector-and-industry-analysis)
5. [Stock screening](#5-stock-screening)
6. [Daily Movers: the Top Gainers & Losers table](#6-daily-movers-the-top-gainers--losers-table)
7. [Daily Movers: other views and filters](#7-daily-movers-other-views-and-filters)
8. [Stock detail panels](#8-stock-detail-panels)
9. [News and NSE filings](#9-news-and-nse-filings)
10. [Scores and historical evaluation](#10-scores-and-historical-evaluation)
11. [Practical workflow](#11-practical-workflow)
12. [Data sources, refresh and limitations](#12-data-sources-refresh-and-limitations)
13. [Glossary](#13-glossary)
- [Appendix A: Verification notes and discrepancies](#appendix-a-verification-notes-and-discrepancies)
- [Appendix B: Settings reference](#appendix-b-settings-reference)

---

## 1. Introduction

### 1.1 What the Sector Dashboard is

The NSE Sector Strength Dashboard is a free, static website that takes **official end-of-day data published by the National Stock Exchange of India (NSE)** and turns it into a handful of research views:

| Area | One-line description |
|---|---|
| **Market Capitalisation Segments** | Four panels: NIFTY 500, Midcap 150, Smallcap 250, Microcap 250 — returns, breadth and a trend label for each. |
| **Market Overview** | NIFTY 500 returns, how many sectors are bullish / sideways / bearish, and broad-market breadth. |
| **Sectors tab** | 15 NSE sectoral indices ranked by a 0–9 strength score. |
| **Industries tab** | NSE's 20 industry classifications, with averages computed by the dashboard from their stocks. |
| **Stock Screener tab** | ~500 NIFTY 500 stocks scored 0–10, with pattern flags. |
| **Daily Movers & Continuation tab** | One session's top gainers, losers and unusual-volume stocks, with the evidence for and against the move continuing, and a historical check of how such setups did. |
| **Backtest tab** | Tests each Stock Screener rule against past prices. |
| **History tab** | A log, kept only in your browser, of past dashboard states. |

### 1.2 Why it exists

Index-level moves hide what is underneath. A sector index can rise because three heavyweight stocks rose while most of its members fell. The dashboard exists to show **breadth** (how many stocks participate), **relative strength** (is it beating the market?) and **distance from highs**, side by side with returns, so you can see whether a move is broad or narrow before you spend time on individual stocks.

### 1.3 Who should use it

- Investors and traders who already understand basic market concepts (index, close, volume, moving average) and want a structured way to **shortlist** sectors and stocks for further study.
- Learners who want to see how breadth, relative strength and volume relate to each other.

It is **not** aimed at people looking for tips, signals or automated decisions.

### 1.4 What problems it helps with

- "Which sectors are leading or lagging the broad market?"
- "Is a sector's rally broad or concentrated in a few stocks?"
- "Which stocks are strong *within* a strong industry?"
- "What moved most in the last session, and was the move backed by volume and a strong close?"
- "Is the evidence around a big mover pointing toward continuation, or toward exhaustion?"

### 1.5 What it does not do

| It does **not** | Why it matters |
|---|---|
| Show live / intraday prices | Data is **end-of-day**, published after the close. |
| Give buy/sell calls, entry, stop-loss or targets | Stated on the stock panels themselves. |
| Predict the next day's (or any) price | See [Chapter 10](#10-scores-and-historical-evaluation): measured predictive power was not distinguishable from chance. |
| Show fundamentals, valuation, order books or option data | Only price, volume, turnover, delivery % and exchange filings are used. |
| Adjust prices for splits/bonuses | It detects and avoids such breaks instead ([§12.5](#125-corporate-actions)). |
| Cover all NSE stocks | Stock Screener: NIFTY 500 (501 list entries). Daily Movers: NIFTY 500 plus NIFTY Microcap 250 (755 symbols). |
| Replace Groww, NSE or broker mover lists | Its lists are computed from NSE end-of-day files and can differ from intraday lists. |

### 1.6 Time horizon: what is it suited to?

Based on the data actually available (daily bars, up to about 14 months of history, refreshed once per trading day):

| Style | Suitability |
|---|---|
| **Intraday** | **Not suitable.** No intraday data, no live prices. |
| **Swing / short-term positional (days to weeks)** | Partly suitable for **shortlisting** — returns windows range from 1 day to 6 months, and the Daily Movers tab looks at one-session moves. |
| **Positional / medium-term (weeks to months)** | Best fit for the sector, industry and screener views (1M/3M/6M returns, 50/200-day averages, 52-week high). |
| **General market research** | Good fit. |

The dashboard's own next-session check ([Chapter 10](#10-scores-and-historical-evaluation)) is a *research question* ("does the evidence help?"), not a recommendation to trade overnight.

### 1.7 Five related but different ideas

| Concept | Question it answers | Where in the dashboard |
|---|---|---|
| **Sector analysis** | How is a group defined by an NSE *sectoral index* doing (e.g. NIFTY Auto)? | Sectors tab |
| **Industry analysis** | How are stocks in an NSE *industry classification* (e.g. "Capital Goods") doing, on average? | Industries tab |
| **Stock screening** | Which individual stocks pass a set of trend / strength / pattern rules? | Stock Screener tab |
| **Daily market-mover research** | What moved most today, and what does the surrounding evidence say? | Daily Movers & Continuation tab |
| **Technical setup identification** | Does a stock's recent price structure resemble a defined pattern (near high, near resistance, tight range, triangle, breakout)? | Pattern badges in the Screener; "Setup" labels in Daily Movers |

A **sector** here is an official NSE index with its own published level. An **industry** is a label from NSE's classification of each company; NSE publishes no price index for most industries, so the dashboard calculates equal-weighted averages itself ([§4.9](#49-sector-vs-industry-what-is-different)).

---

## 2. Understanding the dashboard

### 2.1 Page layout (top to bottom)

```
┌──────────────────────────────────────────────────────────────────┐
│ HEADER: title · data provider · Latest market data · Pipeline    │
│         refresh · Loaded in browser · Status · [Refresh Data]    │
│         [Help] [Settings]                                        │
├──────────────────────────────────────────────────────────────────┤
│ Banners (only when relevant): Refresh failed / Data quality      │
│ warnings / "Showing a cached snapshot"                           │
├──────────────────────────────────────────────────────────────────┤
│ MARKET CAPITALISATION SEGMENTS  (4 panels)                       │
│ MARKET OVERVIEW  (NIFTY 500 returns, regime counts, breadth)     │
├──────────────────────────────────────────────────────────────────┤
│ TABS: Sectors | Industries (n) | Stock Screener (n) |            │
│       Daily Movers & Continuation | Backtest | History (n)       │
│  …the selected tab's content…                                    │
└──────────────────────────────────────────────────────────────────┘
```

The segment panels and Market Overview stay visible above every tab. The numbers in the tab labels are counts (e.g. "Industries (20)", "Stock Screener (501)", "History (3)").

### 2.2 Navigating

| Action | How |
|---|---|
| Switch section | Click a tab. The tab bar scrolls sideways on narrow screens. |
| Sort a table | Click a column heading; click again to reverse. Values that are unavailable always sort last. |
| Open details | Click (or press Enter on) a row in the Sectors, Industries, Stock Screener or Daily Movers tables. |
| Close details | **Close** button, **Esc**, or click outside the panel. |
| Read a metric's definition | Click the small **?** next to a heading. It shows the formula, an explanation and an example. |
| Read the full glossary | **Help** button in the header. |
| Change thresholds | **Settings** button ([Appendix B](#appendix-b-settings-reference)). |
| Export | **Export CSV / JSON** on the Sectors tab; **Export CSV** on the Stock Screener tab; export on the History tab. |

### 2.3 Header and data-freshness labels

| Header item | Meaning |
|---|---|
| **Data provider** | "NSE official archives (via scheduled fetch pipeline)". The browser never calls NSE directly. |
| **Latest market data** | The date of the **newest trading session in the data** (not today's date, and not when the page loaded). This is the single most important date on the page. |
| **Pipeline refresh** | The scheduled pipeline's own verdict on its last run: **Complete · *x* ago**, **Partial · last complete *x* ago**, or **Failed · last complete *x* ago**. Hover for details. |
| **Loaded in browser** | When *your browser* last downloaded the published files. "Just now" says **nothing** about how fresh the NSE data is. |
| **Status** | A badge describing the fetch: see below. |
| **Refresh Data** | Re-downloads the published files (bypassing the browser cache) and recalculates everything. It does **not** contact NSE; it only picks up whatever the pipeline last published. |

**Status badge values**

| Status | What it means | What to do |
|---|---|---|
| **Live** | Fetched just now, no pipeline warnings, and latest date within 5 calendar days. | Nothing special. |
| **Partial** | Fetched successfully, but the data's manifest lists warnings (for example suspected unadjusted corporate actions or stocks with no history). | Read the "Data quality warnings" box. Most metrics are still valid; affected stocks are shown with "Prices from DATE only". **At the time of writing, the published data carries such warnings, so "Partial" is the normal label.** |
| **Stale** | The latest market date is **more than 5 calendar days** before today. The scheduled pipeline may have stopped. | Do not treat the numbers as current. Check the Latest market data date and Pipeline refresh. |
| **Cached** | Showing a copy saved in your browser (IndexedDB) — shown briefly on page load, and after a failed refresh. | Click **Refresh Data**. |
| **Unavailable** | No valid data at all, and nothing cached. | Click **Refresh Data**; if it keeps failing, the site's data files are unreachable. |

Cached data is never re-labelled "Live", and a failed refresh never overwrites the last good data: you will see a **"Refresh failed"** banner above data that is still the previous snapshot.

> **Weekends and holidays.** NSE has no session on those days, so "Latest market data" will legitimately be older than today. Only worry if it is more than a trading day or two behind and Pipeline refresh says Failed or Partial.

### 2.4 Pipeline refresh in detail

The pipeline runs on GitHub Actions on weekdays at 14:30 UTC (20:00 IST) with a retry at 02:30 UTC (08:00 IST). It classifies each run:

| Outcome | Meaning |
|---|---|
| **Complete** | Every recent trading day was fetched. |
| **Partial** | Recent days are current, but older gaps or backfill remain. |
| **Failed** | A recent trading day is missing. Daily Movers then shows an error-level notice that its lists are **not** for the most recent session. |

### 2.5 Notices on the Daily Movers tab

That tab adds its own notices ([source: `momentum/freshness.ts`]): a failed or partial refresh; stale or cached data; a *Historical view* notice when you pick an older session; volume data missing or ending before the latest price date; and a failed or missing filings feed. If volume data is unavailable, **relative volume and liquidity cannot be computed, and most stocks become "Insufficient evidence".**

### 2.6 Other controls

- **History tab** — each time a refresh fetches a *new* market date, the dashboard stores a small summary in your browser: counts of bullish / sideways / bearish sectors, the 1M NIFTY 500 return, the top sectors and top stocks. Up to 180 entries. It is local to your browser and is never uploaded. Reloading a cached snapshot does not add entries.
- **Settings** — editable thresholds for the score, regime and pattern detectors ([Appendix B](#appendix-b-settings-reference)). Changes apply immediately and are stored in your browser. They change *classifications*, never the underlying data. **Caution:** the Daily Movers tab reuses the pattern settings (resistance lookback) and regime settings, so changing them changes that tab too.
- **Help** — the full "?" glossary in one place.

---

## 3. Market overview

Two blocks sit above the tabs.

### 3.1 Market Capitalisation Segments (four panels)

Each panel is a size-based NSE benchmark. They are calculated by exactly the same code as sectors.

| Panel | Index | Relationship to NIFTY 500 |
|---|---|---|
| **NIFTY 500 — Broad Market** | NIFTY 500 | The benchmark itself. Shows a **Benchmark** badge instead of a trend label. |
| **NIFTY Midcap 150 — Midcaps** | NIFTY Midcap 150 | All 150 constituents are also in NIFTY 500 (a subset). |
| **NIFTY Smallcap 250 — Smallcaps** | NIFTY Smallcap 250 | All constituents are also in NIFTY 500 (a subset). |
| **NIFTY Microcap 250 — Microcaps** | NIFTY Microcap 250 | **Zero overlap** with NIFTY 500 — a separate universe. |

Do not add constituent counts across panels: Midcap and Smallcap are *inside* NIFTY 500.

**Each panel shows**

| Item | Meaning / calculation | Interpretation |
|---|---|---|
| *As of* date and **close** | Latest date and closing value of that index. | The date should match "Latest market data". |
| **1D / 1W / 1M / 3M / 6M** | Index return over 1 / 5 / 21 / 63 / 126 **trading sessions** (see [§4.2](#42-returns-1d-1w-1m-3m-6m)). | Rising = the benchmark is higher than that many sessions ago. |
| **%>20D / %>50D / %>200D** with *eligible/total* | Share of the index's **constituent stocks** closing above their own 20/50/200-day simple moving average ([§4.3](#43-breadth-percent-above-moving-averages)). | High = broad participation. Low = few stocks supporting the index. |
| **Relative performance vs NIFTY 500** (1W, 1M, 3M, 6M) | Index return minus NIFTY 500 return, in percentage points (pp). Not shown for the NIFTY 500 panel (it would always be 0). | Positive = that size segment is beating the broad market over that window. |
| **Trend label** (Bullish / Sideways / Bearish / Insufficient data) | The regime rule in [§4.6](#46-regime-bullish--sideways--bearish). | A description of current conditions, not a forecast. |
| One-line reason | First reason from the regime rule (e.g. "1M return is positive (3.20%)"). | |
| Coverage line | "*x* of *y* constituents have price history". | Gaps reduce the "eligible" counts. |

For the **NIFTY 500 panel**, the trend label is not shown; the code classifies it from returns and breadth only, because "relative to itself" is always 0.

**Breadth and return can disagree.** An index can be up while most of its members sit below their averages (leadership by a few large stocks). The panels deliberately report them separately.

### 3.2 Market Overview (NIFTY 500)

| Element | What it is | How computed | Interpretation | Check alongside |
|---|---|---|---|---|
| **1D, 1W, 1M, 3M, 6M** | NIFTY 500 returns | ((latest close ÷ close *N* sessions ago) − 1) × 100, *N* = 1/5/21/63/126 | Rising across all windows = broad uptrend; 1D red but 3M/6M green = pullback inside an uptrend; the reverse = bounce inside a downtrend. | The three breadth numbers below; sector counts. |
| **Bullish / Sideways–Mixed / Bearish / Insufficient Data** tiles | Count of sectors in each class | Each of the **11 headline sectors** is classified ([§4.6](#46-regime-bullish--sideways--bearish)); tile shows *count / total*. | Many bullish = broad sector strength. Many bearish = broad weakness. | Individual sector rows. |
| **% Above 20DMA / 50DMA / 200DMA** | Breadth of all NIFTY 500 constituents | (stocks above own moving average ÷ eligible stocks) × 100 | See [§4.3](#43-breadth-percent-above-moving-averages). Falling index with rising breadth is unusual; rising index with falling breadth is a warning of narrow leadership. | Segment panels. |

**Why 11 headline sectors, not 15?** NIFTY Bank, PSU Bank, Private Bank and Healthcare overlap heavily with NIFTY Financial Services and NIFTY Pharma. They still appear in the Sectors table but are left out of the four count tiles so the same stocks are not counted twice.

### 3.3 Indices actually available

| Index | Where it appears | Notes |
|---|---|---|
| NIFTY 500 | Market Overview; Segment panel; benchmark for every relative figure | |
| NIFTY Midcap 150, Smallcap 250, Microcap 250 | Segment panels | |
| 15 sectoral indices | Sectors tab | Auto, Bank, Financial Services, FMCG, Healthcare, IT, Metal, Oil & Gas, Pharma, Realty, PSU Bank, Private Bank, Consumer Durables, Media, Chemicals |
| **NIFTY 50** | **Only on the Daily Movers tab** (market strip and stock panel) | Used as a second opinion on the market's direction. It is **not** in the Market Overview or segment panels. |
| NIFTY Capital Goods, Power, Construction, Insurance, Telecommunications | **Not tracked** | NSE's bulk file does not include them. The Sectors tab has a "Show sectors not currently tracked" button listing them. Their stocks are still visible through the Industries tab. |

### 3.4 How broad-market strength or weakness affects sectors and stocks

- In a **strong, broad market** (rising NIFTY 500, high %>50D and %>200D), most sectors and stocks rise together. Sector rank matters less than *relative* strength: who is rising faster?
- In a **weak market**, most stocks fall. A stock or sector that holds up (positive relative performance, high breadth) is showing relative strength — but can still fall if the market keeps falling.
- Daily Movers uses the market as **context**: the market-regime and same-day NIFTY 500 / NIFTY 50 moves feed the evidence score ([§6.13](#613-score)). A gainer on a strong market day gets some "credit" for the market's help; a gainer on a falling market day is flagged as moving against the market.

---

## 4. Sector and industry analysis

### 4.1 The Sectors table: every column

Default sort: **Score**, highest first. Filters: name search; classification (All / Bullish / Sideways–Mixed / Bearish / Insufficient data); **Min score** (Any, 1+ … 9+); Reset. The row count shows "*n* of 15 sectors".

| # | Column | Short meaning |
|---|---|---|
| 1 | **#** | Position in the *current* sort (not a fixed rank). |
| 2 | **Sector** | NSE sectoral index. ⓘ marks sectors that overlap another (hover for the note). |
| 3 | **Close** | Latest index close. |
| 4–8 | **1D, 1W, 1M, 3M, 6M** | Index returns. |
| 9–11 | **%>20D, %>50D, %>200D** | Breadth. |
| 12 | **52W Dist** | Distance from 52-week high. |
| 13 | **3M RS** | 3-month relative performance vs NIFTY 500 (pp). |
| 14 | **Score** | Strength score "earned/possible". |
| 15 | **Regime** | Bullish / Sideways / Bearish / Insufficient data. |
| 16 | **Data Quality** | complete / partial / unavailable. |

Click a row for the [sector detail view](#81-sector-and-industry-detail-views).

### 4.2 Returns: 1D, 1W, 1M, 3M, 6M

| Field | Explanation |
|---|---|
| **Meaning** | How much the index (or stock) has gained or lost between its latest close and its close *N* trading sessions earlier. |
| **Calculation** | Return % = ((latest close ÷ close *N* sessions ago) − 1) × 100, where *N* = **1** (1D), **5** (1W), **21** (1M), **63** (3M), **126** (6M). Counted in **trading sessions** (bars in the data), not calendar days. If fewer than *N* prior sessions exist the value is **N/A**. |
| **Example (illustrative)** | An index closed at 1,000 on the date 21 sessions ago and 1,080 today: 1M return = (1,080 ÷ 1,000 − 1) × 100 = **+8.0%**. |
| **Interpretation** | Positive = higher than at the start of the window. Compare windows: 1D/1W are noise-prone; 3M/6M show trend. A good 1D on top of poor 3M/6M is a bounce, not a trend. |
| **Practical use** | Read all five together. Strong across 1M, 3M and 6M = persistent strength. Strong 1M but weak 6M = recovery attempt. |
| **Limitation** | Says nothing about *why*, nor about the path (a +8% could be steady or one gap). Prices are closes only; dividends are not included. |

### 4.3 Breadth (percent above moving averages)

| Field | Explanation |
|---|---|
| **Meaning** | The share of a group's **member stocks** whose latest close is above their own simple moving average of the last 20 / 50 / 200 closes. These roughly mark short-term (about a month), intermediate (2–3 months) and long-term (about 10 months) trends. |
| **Calculation** | % = (stocks with close > own *N*-day SMA ÷ **eligible** stocks) × 100. The SMA is the plain average of the last *N* closes **including today**. A stock is *eligible* only if it has at least *N* comparable closes, has a bar within 7 calendar days of the date (not stale), and its SMA window does not cross a detected price discontinuity ([§12.5](#125-corporate-actions)). Ineligible stocks are **left out**, never counted as zero. If no stock is eligible the value is N/A. Exactly-equal counts as not above. |
| **Example (illustrative)** | A sector has 15 stocks; 12 have enough clean history; 9 of those 12 are above their 50-day average. %>50D = 9 ÷ 12 × 100 = **75%** (shown with "12/15 eligible" in the panels and detail view). |
| **Interpretation** | High (e.g. >70%) = most stocks are in uptrends: participation is broad. Low (e.g. <30%) = most stocks are in downtrends. Mid values = mixed. (These bands are rules of thumb for reading, not thresholds in the code. The code's only breadth threshold is 50%.) Compare windows: high %>20D with low %>200D = a short-term bounce inside a long-term downtrend. |
| **Practical use** | A rising index with falling breadth warns that fewer stocks are carrying the move. |
| **Limitation** | It counts stocks, not their size or the distance above the average. Small sectors (10–15 stocks) move in big steps: one stock = 7–10 percentage points. Ineligible stocks shrink the denominator. |

**Why breadth uses stocks, not the index.** The dashboard never uses the sector index's own moving average; it uses the **constituents'** own moving averages, which is a different (and more informative) signal.

### 4.4 Distance from 52-week high ("52W Dist")

| Field | Explanation |
|---|---|
| **Meaning** | How far the latest close is below the highest price of the past year. |
| **Calculation** | ((latest close ÷ highest **intraday high** in the trailing 365 calendar days) − 1) × 100. Needs about a year of history (span ≥ 350 days and ≥ 70% of 252 sessions in the window) or it shows **N/A**. |
| **Example (illustrative)** | High of 200 in the past year; close 180 → (180 ÷ 200 − 1) × 100 = **−10.0%**. |
| **Interpretation** | 0% would mean closing exactly at the high. Because the high is *intraday*, a close is nearly always slightly below 0%, even on a new-high day. **It can never be positive**, because the window includes the latest day's own high. Near 0 (e.g. −5% or closer) = near the highs. −30% = deep drawdown. |
| **Practical use** | Sectors near their highs with broad breadth are in established uptrends; sectors far below are recovering or still falling. |
| **Limitation** | Based on unadjusted prices, so a stock with a split/bonus inside the window can show N/A. NIFTY Chemicals' index history is shorter, so it may show N/A until a year accumulates. |

### 4.5 Relative strength vs NIFTY 500 ("3M RS")

| Field | Explanation |
|---|---|
| **Meaning** | Whether the group is beating or lagging the broad market. |
| **Calculation** | Relative performance (pp) = sector return − NIFTY 500 return over the same number of sessions. The table shows **3M** (63 sessions); the segment panels show 1W, 1M, 3M and 6M. The sector detail view also charts the **RS ratio** (sector close ÷ NIFTY 500 close, matched by date). |
| **Example (illustrative)** | Auto +5.0% over 3M, NIFTY 500 +2.0% → 3M RS = **+3.0pp**. If NIFTY 500 were +8.0%, Auto would be **−3.0pp** while still up in absolute terms. |
| **Interpretation** | Positive = outperforming. Negative = lagging. A rising RS-ratio line = strengthening versus the market, even in a falling market. |
| **Practical use** | Combine with breadth: positive RS **and** high breadth is the strongest combination in this dashboard. |
| **Limitation** | Subtracts two returns; it is not risk-adjusted and not a statistical test. The benchmark is NIFTY 500 only. |

### 4.6 Regime (Bullish / Sideways / Bearish)

The **Regime** column is the dashboard's trend label. It is a *rules-based description of current conditions*, not a forecast.

| Label | Rule (all must hold) |
|---|---|
| **Bullish** | 1M return > 0 **and** 3M return > 0 **and** 3M relative performance vs NIFTY 500 > 0 **and** at least **2 of the 3** breadth measures (20/50/200-DMA) **above 50%**. |
| **Bearish** | The mirror: 1M < 0, 3M < 0, 3M relative performance < 0, and at least 2 breadth measures **below 50%**. |
| **Sideways / Mixed** | Anything else that could be assessed — including conflicts such as positive returns with weak breadth. |
| **Insufficient data** | 1M return, 3M return or 3M relative performance is unavailable, or fewer than 2 breadth measures are available. Never silently shown as sideways. |

The 50% threshold, and the "2 breadth measures required", are **editable defaults** ([Appendix B](#appendix-b-settings-reference)). "Above 50%" is strict: exactly 50.0% counts as neither above nor below.

**Confidence (High / Medium / Low).** Shown in the sector detail view with reasons. It is a completeness check: one point each for (a) 6M return available, (b) 1M and 6M trends not contradicting each other, (c) all three breadth measures available. 3 points = High, 2 = Medium, otherwise Low. It is **not** a probability.

**Example (illustrative):** 1M +4%, 3M +9%, 3M RS +3pp, breadth 80% / 65% / 40%. Three conditions true; two breadth measures above 50 → **Bullish**. If breadth were 80% / 45% / 40% (only one above 50) → **Sideways**, even though returns are strong. That is the "positive returns but weak breadth" case.

> **Note.** For the **NIFTY 500 segment panel only**, the relative-performance condition is skipped (it would be 0 by definition), so it can still be classified from returns and breadth.

### 4.7 Strength Score (sector and industry, 0–9)

Shown as **earned/possible** (e.g. `7/9`). One point per condition passed, except relative performance, which is worth **2** by default:

| # | Condition | Points |
|---|---|---|
| 1 | 1M return > 0 | 1 |
| 2 | 3M return > 0 | 1 |
| 3 | 6M return > 0 | 1 |
| 4 | %>20D breadth > 50% | 1 |
| 5 | %>50D breadth > 50% | 1 |
| 6 | %>200D breadth > 50% | 1 |
| 7 | 3M relative performance vs NIFTY 500 > 0 | **2** (editable) |
| 8 | Within 5% of 52-week high (editable) | 1 |

Maximum = 1+1+1+1+1+1+2+1 = **9**.

**Missing data.** A condition that cannot be evaluated is removed from *both* the earned and the possible totals. So `4/5` means "4 of the 5 points that could be evaluated", not a weak 4/9. A percentage in brackets, e.g. `(56%)`, shows how much of the 9 points could be evaluated; hover for the same text.

| Field | Explanation |
|---|---|
| **Meaning** | A count of how many bullish conditions are met. |
| **Example (illustrative)** | Returns positive for 1M, 3M, 6M (3); breadth 80/65/40 → two pass (2); RS +3pp (2); 52W Dist −3% (1) → total **8/9**. |
| **Interpretation** | Higher = more of the checklist is satisfied. 8–9 = nearly everything bullish; 0–2 = nearly nothing. |
| **Practical use** | A sorting aid. The conditions overlap (a sector with positive 6M, 3M and 1M returns usually also has positive RS), so a score of 6 is not "twice as good" as 3. |
| **Limitation** | **Not a probability and not validated as predictive.** Equal weights are a design choice, not an estimate. |

### 4.8 Data Quality column

| Value | Rule (sector table) |
|---|---|
| **complete** | Nothing missing. |
| **partial** | Some metrics missing (hover for the list). |
| **unavailable** | Six or more items missing. |

### 4.9 Sector vs industry: what is different

| | **Sectors tab** | **Industries tab** |
|---|---|---|
| Group | One of 15 NSE sectoral **indices** | One of NSE's **20 industry labels** (from the "Industry" column of the NIFTY 500 list): Financial Services, Capital Goods, Healthcare, Automobile and Auto Components, Fast Moving Consumer Goods, Chemicals, Information Technology, Consumer Services, Metals & Mining, Power, Oil Gas & Consumable Fuels, Consumer Durables, Services, Realty, Construction, Construction Materials, Telecommunication, Textiles, Media Entertainment & Publication, Diversified |
| Returns | Official index level | **Simple (equal-weighted) average of the member stocks' returns** — computed by the dashboard, not published by NSE |
| Breadth | Constituents of the index | Constituents of the industry |
| Universe | Index constituents (10–20 stocks each) | NIFTY 500 stocks only |

**Industries table columns (11):** `#`, **Industry**, **Stocks** (member count), **Avg 1M**, **Avg 3M**, **Avg 6M**, **%>20D**, **Avg 52W Dist**, **Avg 3M RS**, **Score**, **Regime**. Default sort: **Stocks**, largest first. Search box only. Only %>20D is in the table; the detail view shows 20, 50 and 200.

**Industry rules that differ**

- Each metric is the **mean of the stocks that have it**; stocks lacking it are skipped (the detail view shows *n*, the number averaged). Stale stocks are excluded.
- Industries with fewer than **3** stocks (editable) are forced to **Insufficient data**.
- Data quality: **unavailable** if 5 or more items are missing.
- Because it is a mean, **one extreme stock can dominate a small industry**. Check *n* and the individual stocks.
- The industry score uses the same 0–9 checklist as sectors, on the averaged values.

> **Industry ≠ sector.** "Financial Services" (industry, 98 stocks in the NIFTY 500 list) contains banks, NBFCs, insurers and asset managers; "NIFTY Financial Services" (sector index) contains 20 of them.

### 4.10 How to identify…

| You want to find | Look for | Why |
|---|---|---|
| **Strong sectors** | Bullish regime; score 7–9; positive 3M RS; high %>50D and %>200D; 52W Dist close to 0 | Trend, relative strength, participation and proximity to highs all agree. |
| **Weak sectors** | Bearish regime; score 0–2; negative 3M RS; low breadth; deep negative 52W Dist | All checks fail together. |
| **Improving sectors** | 1M and 1W better than 3M/6M; %>20D rising faster than %>200D; RS ratio chart turning up; recent classification history (last 5 sessions) shifting toward Bullish | Short-term data leads the long-term. |
| **Deteriorating sectors** | Strong 6M/3M but weak 1M/1W; %>20D falling below %>50D; RS ratio turning down; the "classification changed on the most recent session" note | Short-term data leads on the way down too. |
| **Broad participation** | Index return positive **and** breadth > 60–70% on all three windows; eligible counts close to totals | Most members are contributing. |
| **A few stocks driving returns** | Index return positive but breadth well below 50%, particularly %>50D / %>200D | The index is rising while most members are not. |

> A sector can also be mostly driven by a few stocks even with high-looking breadth if the sector is small; always open the detail view and look at *eligible/total*.

### 4.11 Why positive returns with weak breadth deserve more caution

Compare two illustrative sectors, both with +6% 3M return:

| | Sector A | Sector B |
|---|---|---|
| 3M return | +6% | +6% |
| %>20D / %>50D / %>200D | 85% / 80% / 70% | 40% / 30% / 25% |
| 3M RS | +2pp | +2pp |
| Regime | Bullish | Sideways |
| Reading | Most stocks are above their averages; the return is shared. | A few heavy stocks lift the index while most members sit below their averages; the return is fragile to a reversal in those few. |

The score and regime already reflect this: Sector B fails three breadth conditions and cannot be Bullish. Still treat the label as a prompt to look deeper, not a verdict.

### 4.12 A high sector rank is not a stock entry

Sector rank is a statement about *the group*. It does not say:

- whether a particular stock is a leader or a laggard within the sector (see [Chapter 5](#5-stock-screening));
- whether the stock has already run too far (see [§5.6](#56-strong-versus-overextended));
- where a sensible risk level is, how liquid the stock is, or what its chart looks like;
- anything about the future. The project's own testing found no reliable predictive edge ([Chapter 10](#10-scores-and-historical-evaluation)).

---

## 5. Stock screening

### 5.1 What the Stock Screener tab is

A table of **NIFTY 500 constituents** (501 list entries). Each stock is scored out of 10 on trend, relative strength and three pattern checks. Default sort: **Score**, highest first. Only the first **200 matching rows** are displayed (a note appears if there are more); narrow the filters to see others. Export CSV is available.

### 5.2 Filters

| Filter | Effect |
|---|---|
| **Search** | Matches symbol or company name. |
| **Sector** | Keeps stocks that are constituents of the chosen sectoral index (each option shows that sector's regime and score). A stock may belong to several sectors. |
| **Industry** | Keeps stocks in the chosen NSE industry (option shows the industry's regime and score). |
| **Min score** | Any, 2+, 4+, 6+, 8+, 10+ (of the stock's earned points). |
| **Leading sectors/industries only** | Keeps stocks that belong to a "leading" sector **or** industry. "Leading" = regime **Bullish**, or **Sideways with score ≥ 5**. |
| **Near 52-week high** | Distance from 52-week high ≥ −5%. |
| **Approaching resistance** | The resistance flag ([§5.5](#55-pattern-flags)) is on. |
| **Consolidating** | The range-contraction flag is on. |
| **Triangle detected** | A *confirmed* triangle only. |
| **Reset filters** | Clears everything. |

Checkboxes combine with AND. A stock whose metric is N/A fails a checkbox it depends on.

> **Note.** The **Near 52-week high** checkbox and the **52W** badge always use −5%, even if you change the "near 52-week-high" threshold in Settings. That setting changes only the *score condition*.

### 5.3 Columns (10)

| Column | Meaning | Calculation / notes |
|---|---|---|
| **#** | Position in the current sort | |
| **Symbol** | NSE trading symbol, with the stock's NSE industry beneath | May show a badge: **"Prices from DATE only"** (a price break was detected; older prices are not used), **"Stale since DATE"** (no recent bar), or **"No price data"**. |
| **Close** | Latest close, ₹ | Unadjusted raw close. |
| **1D, 1M, 3M** | Stock returns | Same method as [§4.2](#42-returns-1d-1w-1m-3m-6m). 1W and 6M appear in the detail panel. |
| **52W Dist** | Distance from 52-week high | [§4.4](#44-distance-from-52-week-high-52w-dist), using the stock's own highs. |
| **3M RS** | Stock 3M return minus NIFTY 500 3M return, pp | [§4.5](#45-relative-strength-vs-nifty-500-3m-rs). |
| **Patterns** | Badges: **52W**, **Res**, **Cons**, **Tri**, **Tri?** | [§5.5](#55-pattern-flags). |
| **Score** | Earned / possible, 0–10 | [§5.4](#54-the-stock-score-010). |

There is no "regime" column for stocks; regime is applied to sectors, industries and segments.

### 5.4 The stock score (0–10)

A separate scale from the sector 0–9. Conditions:

| # | Condition | Points |
|---|---|---|
| 1 | Within 5% of 52-week high (editable) | 1 |
| 2 | 1M return > 0 | 1 |
| 3 | 3M return > 0 | 1 |
| 4 | Close above own 50-day SMA | 1 |
| 5 | Close above own 200-day SMA | 1 |
| 6 | 3M relative performance vs NIFTY 500 > 0 | **2** (editable) |
| 7 | Approaching a prior resistance level (heuristic) | 1 |
| 8 | Trading range contracted vs baseline (heuristic) | 1 |
| 9 | A confirmed triangle structure (heuristic) | 1 |

Maximum = **10**. As for sectors, a condition that cannot be evaluated is excluded from both earned and possible totals (so a stock with under 200 clean sessions might show `5/8`).

**Ranking.** Stocks are ranked simply by earned points (or by whichever column you click). There is no hidden weighting beyond the table above.

**Interpretation / caveats**

- Items 1 and 7 overlap (a stock near its high is often near resistance), so "approaching resistance" mostly re-counts proximity.
- Pattern points reward *being* in a pattern, not breaking out of it.
- A high score is a stronger checklist match, not a higher expected return (see [§10.2](#102-technical-score-versus-probability)).

### 5.5 Pattern flags

All three are **disclosed heuristics** with fixed windows (editable in Settings), not chart-pattern recognisers.

| Badge | Rule (default settings) | Plain English |
|---|---|---|
| **52W** | 52W Dist ≥ −5% | Within 5% of the one-year high. |
| **Res** ("approaching resistance") | **Resistance level** = highest intraday high of the **60 sessions before today**. Flag if the close is *below* that level but **within 3%** of it. Needs ≥ 61 bars. | Price is just under its recent peak and has not yet closed above it. |
| **Cons** ("consolidating") | Average daily range (high − low) ÷ close, over the last **15** sessions, is **≤ 0.6×** the same average over the last **60** sessions (the 60 includes the 15). | Daily swings have become much smaller than usual. Flags contraction only — not direction. |
| **Tri** (confirmed triangle) | In the last **40** sessions, find swing highs/lows (a bar whose high/low is the extreme of ±3 bars). Fit a straight line through each set. Shape: **ascending** (flat highs, rising lows), **descending** (falling highs, flat lows) or **symmetrical** (falling highs, rising lows). **Confirmed** only with ≥ 3 swing highs *and* ≥ 3 swing lows, each within 2% of its fitted line. A slope within ±0.03% of price per session counts as flat. | The recent highs and lows converge in a recognisable shape, with enough touches to trust the lines. |
| **Tri?** (tentative) | Shape matches but there are too few pivots or the fit is loose. | Shown for information; **never scored**, never filtered. |

> **Resistance is a reference, not a ceiling.** The level is simply the highest high of the last 60 sessions. It does not weigh how often it was tested, volume, or whether it matters to other traders. Price can pass through it or never reach it.

### 5.6 Strong versus overextended

The Stock Screener shows strength; it has no explicit "overextended" flag. Use these cues from the screener and the stock panel:

| Looks strong and healthy | Looks strong but possibly stretched |
|---|---|
| Score high, 52W Dist modestly below 0, close above 50- and 200-DMA, positive 3M RS, **and** consolidation or a base behind it | Same strength, but 1M return very large (e.g. +30% in a month), 1D spike, or a price far above its own averages |
| Gains spread over months | Gains compressed into days |
| Industry also strong | Only this stock is strong while its industry is weak |

The Daily Movers tab does flag stretch explicitly: **"Extended — reversal risk"** when the close is ≥ 15% from its 20-day average or ≥ 20% over 5 sessions in the direction of the move ([§6.12](#612-setup)).

### 5.7 Illustrative example

*(All values illustrative.)* Stock X: Close ₹520, 1M +6%, 3M +14%, 52W Dist −2.5%, 3M RS +8pp, above 50- and 200-DMA, 2.1% below a 60-session high of ₹531, range ratio 0.5, no triangle.

| Condition | Result | Pts |
|---|---|---|
| Near 52W high | ✓ | 1 |
| 1M > 0 | ✓ | 1 |
| 3M > 0 | ✓ | 1 |
| Above 50-DMA | ✓ | 1 |
| Above 200-DMA | ✓ | 1 |
| 3M RS > 0 | ✓ | 2 |
| Approaching resistance (−2.1% within 3%) | ✓ | 1 |
| Consolidating (0.5 ≤ 0.6) | ✓ | 1 |
| Triangle | ✗ | 0 |

Score **9/10** — badges 52W, Res, Cons. What this tells you: a strong, tight chart near its highs. What it does not tell you: that it will break out, that the breakout will hold, or that now is a good price.

---

## 6. Daily Movers: the Top Gainers & Losers table

This is the Daily Movers & Continuation tab's main view ("Top gainers & losers"). Each session it shows two tables — **Top *N* gainers** and **Top *N* losers** — for one NSE session (the latest by default; a **Session** drop-down lets you pick any of the most recent 260 sessions).

### 6.1 Which stocks are considered

- **Universe:** NIFTY 500 + NIFTY Microcap 250 lists (755 stocks), using *current* membership.
- **Change:** each stock's close against its **previous comparable close** (previous bar in the same continuous price segment).
- **Not ranked:** a stock whose bar starts a **price discontinuity** (suspected split/bonus, unverified ≥15% gap-down, or missing sessions) or has no previous bar. These appear in a separate **"Not ranked this session"** list with the unadjusted change and the reason — so a −50% bonus-day "loss" never shows up as a top loser.
- **Ranking:** gainers = largest positive change first; losers = most negative first; ties by symbol. **Never ranked by a score.** The list-size control (top 10 / 20 / 50) sets how many rows are shown.
- Stocks with no change (0.00%) are excluded from both lists.
- The strip above the tables tells you how many stocks had a comparable change, how many were unchanged, had no bar, or were excluded.

### 6.2 The columns at a glance (13 including rank)

| Column | One-line meaning |
|---|---|
| **#** | Rank within the list by % change. |
| **Symbol** | NSE symbol, company name, industry, size segment. |
| **Change** | % change, previous close → close. |
| **Close in range** | Where the close sits between the day's low and high. |
| **Rel. volume** | Today's volume ÷ average of the previous 20 sessions. |
| **Turnover** | Traded value today, ₹ crore (with "thin" / "BE" / "BZ" warnings). |
| **vs 52W high** | Close vs 52-week high. |
| **vs resistance** | Close vs the highest high of the prior 60 sessions. |
| **vs industry** | Stock's change minus its industry peers' median change. |
| **Evidence** | Evidence **category** (continuation / mixed / exhaustion-reversal / insufficient). |
| **Setup** | Rule-based **label** (7 possible). |
| **Score** | Net evidence points. |
| **For / against** | Count of listed factors supporting continuation / supporting reversal. |

Click any column heading except #, Evidence and Setup to sort. Click a row to open the [detail panel](#82-daily-movers-stock-panel).

> **Note — column names versus meaning.** In this application **"Evidence"** is the *category badge*, and the individual observations behind it are in the **For / against** counts and the detail panel's component scores and lists. **"Setup"** is the rule-based label. There is no separate column called "Sector": the grouping is the NSE *industry*.

### 6.3 Symbol

| | |
|---|---|
| **Definition** | The stock's NSE trading symbol, with company name, NSE industry, and size segment (large / mid / small / micro). |
| **Logic** | Segment is from *current* index membership: Microcap 250 → micro; else Smallcap 250 → small; else Midcap 150 → mid; else NIFTY 500 → large. It is a **proxy**: no market-cap figures are used. "Large" simply means "in NIFTY 500 but not in Midcap 150 or Smallcap 250". |
| **Units** | Text. |
| **Example** | `ABC · Capital Goods · mid` *(illustrative)*. |
| **Interpretation** | Use the symbol to find the stock on NSE or a charting site. Segment and industry help you gauge liquidity and peers. |
| **Caveats** | Membership is as of the last constituent fetch (the page header notes the date), not as of the session being viewed. Delisted or removed stocks are absent. |

### 6.4 Change

| | |
|---|---|
| **Definition** | The daily percentage price change. |
| **Calculation** | (close ÷ previous comparable close − 1) × 100. The reference is the **previous trading day's close** in the same continuous segment, **unadjusted** for dividends. |
| **Units / period** | Percent; one session. |
| **Example** | Previous close ₹200, close ₹214 → **+7.00%**. |
| **High / low** | Large moves are what put a stock on the list. Compare with the stock's usual volatility: the detail panel shows the move in standard deviations ([§8.2](#82-daily-movers-stock-panel)). A move of ≥3 standard deviations is treated as "unusual" by the score. |
| **Practical meaning** | The *what*; the other columns try to describe the *how* and the *context*. |
| **Caveats** | Small corporate actions (bonus < ~6:5, small rights issues) are not detected and can masquerade as moves; very large falls (≥15%) show a warning in the detail panel. This is not the same as a broker's *live* movers list, which can include intraday data. |

### 6.5 Close in range

| | |
|---|---|
| **Definition** | Where the day's closing price sat between the day's lowest and highest price. 100% = closed at the high, 0% = at the low. |
| **Calculation** | (close − low) ÷ (high − low), shown as a rounded percentage. N/A when high equals low (no range). |
| **Units / period** | Percent of one day's range. |
| **Examples (illustrative)** — day with low ₹95, high ₹105 | Close ₹104 → (104 − 95) ÷ 10 = **90%** (near the high). Close ₹100 → **50%** (middle). Close ₹96 → **10%** (near the low). |
| **Interpretation** | *Near the high:* buyers were still in control into the close. *Middle:* a balanced finish. *Near the low:* sellers were in control, and for a gainer this means the day's gain was largely given back. |
| **Rules using it** | Score: gainer **+1** at ≥ 70%, **−1** below 50%; loser **+1** at ≤ 30% (closing near the low), **−1** above 50%. Labels use 0.7 (strong) / 0.5 (fade) for gainers and 0.6 / 0.3 for losers ([§6.12](#612-setup)). |
| **Practical meaning** | A strong close on a gain says the gain survived the day's selling; a weak close says it did not. The detail panel adds candle body and wick shares. |
| **Caveats** | A single day's candle is not a forecast. A strong close does not guarantee the next session, and a weak one does not guarantee a drop. The daily bar cannot tell you *when* during the day the high or low occurred. |

### 6.6 Rel. volume

| | |
|---|---|
| **Definition** | Today's volume compared with the stock's own recent average. |
| **Calculation** | Today's volume (shares) ÷ the **mean daily volume of the previous 20 comparable sessions** (today excluded). Requires volume for at least **18** of those 20 sessions, otherwise **N/A**. Shown as e.g. `2.4x`. Sessions before a price discontinuity are not used. |
| **Units / period** | Multiple ("x") of a 20-session average. |
| **Examples** — average 1,000,000 shares/day | 500,000 → **0.5x**; 1,000,000 → **1.0x**; 2,000,000 → **2.0x**; 5,000,000 → **5.0x**; 10,000,000 → **10.0x**. |
| **Interpretation** | **0.5x:** unusually quiet; a price move on this volume has little participation behind it. **1.0x:** ordinary. **2.0x:** twice the usual activity. **5x–10x:** exceptional; often tied to news, results, index changes, block deals or a re-rating, and sometimes to thinly-traded stocks where one order is large. |
| **Rules using it** | Score: **+1 at ≥ 1.5x**, **−1 below 1.0x**, 0 in between. Labels need ≥ 1.5x for "Possible breakout", "Momentum continuation" and "Possible reversal", and call a gainer below 1.0x "Weak momentum". |
| **Practical meaning** | Volume shows *participation*, not *direction*. High volume on a gain says many traded; it does **not** say buyers were more eager than sellers — every trade has both. A large fall on 8x volume is just as "high participation" as a large rise. |
| **Caveats** | If volume data cannot be loaded, relative volume is N/A and most rows become "Insufficient evidence". Zero-volume days are treated as real zeros (and warned); missing rows are never treated as zero. Event days (results, index inclusion) can produce high volume that says nothing about trend. |

### 6.7 Turnover

| | |
|---|---|
| **Definition** | The total **value** of shares traded in the session, in ₹ crore (1 crore = 10 million rupees). |
| **Calculation** | NSE's "turnover (lakhs)" field ÷ 100. Values ≥ ₹100 cr show no decimals; smaller values show one decimal. A warning badge appears next to it: **"thin"** (median turnover of the previous 20 sessions under ₹1 crore) or **"BE" / "BZ"** (trade-for-trade series). |
| **Units / period** | ₹ crore, one session. |
| **Example** | 250,000 shares × ₹400 average price ≈ ₹10 crore. |
| **How it differs** | **Volume** = number of shares. **Turnover** = shares × price (rupees). **Relative volume** = today's volume vs its own average (a ratio, with no rupee meaning). A ₹5 stock trading 10 million shares has turnover ₹5 crore; a ₹5,000 stock trading 100,000 shares has ₹50 crore. |
| **Interpretation** | Bigger turnover = easier to enter or exit without moving the price. Under about ₹1 crore a day (the dashboard's "thin" line) a stock may be hard to trade in any size. |
| **Practical meaning** | Liquidity check. A +15% mover with ₹0.4 crore turnover may not be tradable at the quoted prices. The **Liquid only** filter hides stocks with a median turnover below ₹1 crore, trade-for-trade stocks, or no turnover baseline. |
| **Caveats** | The ₹1 crore line is a convention chosen by the project, not an NSE rule. Turnover on a single day can be inflated by block trades. |

### 6.8 vs 52W high

| | |
|---|---|
| **Definition** | How far the close is below the highest price of the last year. |
| **Calculation** | ((close ÷ highest **intraday** high in the trailing 365 calendar days) − 1) × 100, using only the stock's *comparable* price history. N/A if there is not about a year of clean history. |
| **Units / period** | Percent; trailing 365 calendar days. |
| **Example** | 52-week high ₹250, close ₹237.5 → **−5.0%**. |
| **Positive or negative?** | **Never positive** in this implementation: the window contains the day's own high, which is at least the close. A reading near 0 means near the high; −30% means 30% below it. |
| **Interpretation** | Near 0 (within 5%) = trading near the one-year high; the factor list counts this as supporting continuation for gainers (score does not). Far below = the move is a recovery from a deep drawdown. |
| **Practical meaning** | A gainer near its 52-week high has little "overhead supply" from recent buyers at higher prices (a common argument); a gainer far below has to work through it. The dashboard counts only the first as a "for" factor. |
| **Caveats** | Because the high is intraday, a stock that closes at a new high still shows slightly below 0. Stocks with a recent corporate-action break show N/A. |

### 6.9 vs resistance

| | |
|---|---|
| **Definition** | How the close compares with the highest price of the previous 60 sessions. |
| **How resistance is identified** | **Resistance = the highest intraday high in the 60 sessions before today** (today excluded). It is not derived from pivots, trendlines or repeated tests — just that one maximum. The lookback (60) is editable in Settings. Needs at least 61 comparable bars. |
| **Calculation** | (close ÷ resistance level − 1) × 100. **Positive = closed above it (a "breakout" by this definition)**; negative = still below. |
| **Units / period** | Percent; 60-session lookback. |
| **Examples** — level ₹500 | Close ₹510 → **+2.0%** (breakout). Close ₹490 → **−2.0%** (just below). Close ₹450 → **−10.0%**. |
| **Related states** | *Breakout today* = close above the level. *Failed breakout* = intraday high above the level but close at or below it. *Breakdown* (for losers) = close below the lowest low of the prior 60 sessions. *Retest held* = within the last 10 sessions the stock closed above a prior level, and today's low came within 2% of that level while the close stayed above. |
| **Interpretation** | A close above 60-session highs on strong volume is the pattern the "Possible breakout" label looks for. A failed breakout (spiked above, closed back below) scores −1 for gainers. |
| **Practical meaning** | Tells you whether the move is happening beneath a ceiling that recently stopped the stock, or has cleared it. |
| **Caveats** | **Resistance is an analytical reference, not a guaranteed ceiling.** A price can fall back through it, sail past it or never touch it. The level ignores how many times it was tested and whether other traders care about it. The "Distance from resistance" filter works on this same number. |

> **There is no support level in the application.** The only "support-like" calculation is the *breakdown* test (close below the prior 60-session low), used for losers; no support price is shown.

### 6.10 vs industry

| | |
|---|---|
| **Definition** | How much the stock outperformed or underperformed its **industry peers** that day. |
| **Benchmark used** | The **median 1-day change of the other stocks in the same NSE industry** within the dashboard's universe (NIFTY 500 + Microcap 250) that had a comparable change that day. It is not a sector index and it is not market-cap weighted. |
| **Calculation** | Stock change − peer median change, in percentage points (pp). Needs **at least 3 peers**, otherwise N/A. Hover for the peer median and count. |
| **Units / period** | Percentage points; one session. |
| **Example** | Stock +7.8%, peer median +1.9% → **+5.9pp**. A stock −6.4% with peers −1.2% → **−5.2pp**. |
| **Move scope** | The detail panel and "For/against" calls the move **sector-wide** if the peer median has the same sign as the stock's move and is at least 1% in size; otherwise **stock-specific**; with too few peers, **unknown**. |
| **Interpretation** | Large positive = stock-specific strength (news, results, re-rating) rather than an industry move. Near the peer median = it moved with its industry. |
| **Practical meaning** | Separates "my sector was hot" from "this stock was special". |
| **Caveats** | Industries are broad (e.g. "Capital Goods" has 70 NIFTY 500 stocks), so "peers" may be quite different businesses. The median of peers that day is a one-day figure. |

### 6.11 Evidence

The **Evidence** column shows one of four categories (hover for the rationale). Wording differs for losers:

| Category | Gainers | Losers | Rule |
|---|---|---|---|
| **Continuation characteristics** | "Continuation characteristics" | "Downside-continuation characteristics" | Net score **≥ +3**, with price-structure ≥ +1 **and** volume = +1 (the close and the volume must both confirm), and none of the exhaustion triggers below. |
| **Exhaustion / reversal risk** | "Exhaustion/reversal risk" | "Rebound/reversal risk" | Extension score ≤ −2, **or** price-structure score ≤ −2, **or** (extension ≤ −1 **and** net score ≤ 0). |
| **Mixed evidence** | | | Everything else — supporting and opposing signs conflict, or the close and volume do not both confirm. |
| **Insufficient evidence** | | | Fewer than **50** comparable sessions (new listing or recent price break), **or** relative volume unavailable, **or** no intraday range. |

Check order: Insufficient → Exhaustion/reversal → Continuation → Mixed.

Important: the category describes **observed conditions only**. "Continuation characteristics" does **not** mean "will continue".

### 6.12 Setup

The **Setup** column is a separate, rule-based label (hover for its definition). **The first matching rule wins.**

| Label | Applies to | Rule |
|---|---|---|
| **Insufficient evidence** | Both | Under 50 comparable sessions, no relative-volume baseline, or high = low. |
| **Extended — reversal risk** | Both | Close ≥ 15% from its 20-day average, or ≥ 20% over 5 sessions, **in the direction of the move** (gainers: above/up; losers: below/down — an "oversold" stretch). |
| **Weak momentum** | Gainer | Close in the lower half of the day's range (< 50%) **or** relative volume below 1.0x. |
| | Loser | Close in the bottom 30% of the range **and** below its 50-day average. |
| **Possible breakout setup** | Gainer | Close above the prior 60-session high **and** close in the top 30% (≥ 70%) of the range **and** relative volume ≥ 1.5x. |
| **Momentum continuation candidate** | Gainer | Close ≥ 70% of range, relative volume ≥ 1.5x, close above its 50-day average, and 1-month return ahead of NIFTY 500's (relative strength > 0). |
| **Possible reversal** | Loser | Close ≥ 60% of range (recovered off the low), relative volume ≥ 1.5x, and still above its 200-day average. |
| **Mixed signals** | Both | None of the above matched. |

The labels are checked in the order: insufficient → extended → (gainers: weak → breakout → continuation) / (losers: reversal → weak) → mixed. In particular, "Possible breakout" is only reached by a gainer that is not extended, closed in the top half, and had volume ≥ 1.0x.

These labels describe **how the day looked**. "Possible breakout setup" and "Possible reversal" are *names for conditions*, not predictions that a breakout or reversal will follow.

> **Note on "breakdown", "exhaustion" and "reversal risk".** There is no separate "Breakdown" label. A breakdown appears only as a +1 in the loser's price-structure score and in the For/against list. "Exhaustion" is an **evidence category**; "Extended — reversal risk" is a **setup label**. Both exist and are computed separately, so a row can show, for example, category "Mixed evidence" with the setup "Extended — reversal risk".

### 6.13 Score

| | |
|---|---|
| **Definition** | The **net evidence points** toward the move *continuing in today's direction*: up for a gainer, down for a loser. Positive supports continuation; negative supports a pause or reversal. |
| **Range** | −10 to +7 in principle, as the sum of five components. Shown with a sign (`+4`). "—" when the category is Insufficient. |
| **Direction** | Always relative to *today's* direction. A loser scoring +5 has strong evidence of *downside* continuation, not a "good buy". |
| **Components and ranges** | See table below. Each component is clamped to its range. |
| **Weighting** | None. Components are simply added. Their ranges differ, so market and relative-strength items can outweigh volume (range ±1 versus ±2). |
| **Not a probability** | The total is an **evidence tally**. It is not the chance of continuation and not an expected return. |
| **Higher = ?** | Higher means *more of the checks support continuation*. It does **not** mean a higher expected next-day return; the project's own evaluation did not find that ([Chapter 10](#10-scores-and-historical-evaluation)). The lists are ranked by % change, not by this score; the score is a column you may sort by. |

| Component | Range | Points (gainers; losers mirror, see notes) |
|---|---|---|
| **Price structure** | −2 … +2 | **+1** close at ≥ 70% of the range (losers: ≤ 30%, i.e. near the low). **−1** close below 50% (losers: above 50%) — the move was given back. **−1** adverse wick ≥ 40% of the range (gainers: upper wick; losers: lower wick) — intraday rejection. **+1** closed above the prior 60-session high (losers: closed below the prior 60-session low). **−1** (gainers only) traded above the prior 60-session high but closed back at/below it. |
| **Volume** | −1 … +1 | **+1** relative volume ≥ 1.5x; **−1** below 1.0x; 0 between. N/A if unavailable. |
| **Relative strength & sector** | −2 … +2 | **±1** the stock's 1-month return vs NIFTY 500 (+1 if it points the same way as today's move, −1 if opposite). **±1** the stock's tracked sector index's 1-month return vs NIFTY 500 (same direction rule). If the sector index figure is not available or is exactly zero, **+1** instead when the move is sector-wide (peers moved the same way). N/A if the stock's own 1-month relative strength is unavailable. |
| **Market** | −2 … +2 | **±1** if NIFTY 500 moved at least 0.5% that day **and** NIFTY 50 moved in the same direction (or is unavailable): + if it matches the stock's direction, − if opposite. **±1** for the market regime: Bullish = + for gainers / − for losers; Bearish = the reverse. |
| **Extension** | −3 … 0 | Can only subtract. **−2** if the close is ≥ 15% from its 20-day average, or ≥ 20% over 5 sessions, in the move's direction. **−1** if today's move is ≥ 3 standard deviations of its own recent daily changes. **−1** if the 10-session move is ≥ 15% in the direction **and** volume over the three sessions before today was under 0.8x the volume of the 20 sessions before those (participation was fading). |

> **Note.** A few "For / against" factor thresholds differ slightly from the score thresholds (e.g. the For/against list treats a loser closing at ≥ 60% of range as a rebound factor, whereas the score's penalty starts above 50%). Both are as coded; see [§6.14](#614-for--against).

### 6.14 For / against

| | |
|---|---|
| **Definition** | Two counts, `for / against`: the number of listed factors that support the move **continuing** (green) and the number that support a **reversal** (red). |
| **How assembled** | Each factor is a plain-English rule checked against the numbers, with the numbers quoted in the detail panel. Factors that can appear: close location near the extreme or given back; volume ≥1.5x or <1.0x; position relative to 50- and 200-day averages; 1-month relative strength; sector-wide move; NIFTY 500 direction (same condition as the score); market regime; stretched vs 20-day average; stretched over 5 sessions; abnormal move (≥3σ); and — **for gainers only** — breakout, failed breakout, within 5% of 52-week high, confirmed triangle before the move, tight range before the move; plus a held retest (for or against depending on direction) and a gap that extended or faded. |
| **Not weighted** | A count of 7 doesn't mean 7 times as likely; one factor may matter more than five others. It's also not a probability. |
| **Example** | `6 / 1`: six continuation factors, one reversal factor. Open the panel to see which. |
| **Why contradictory evidence matters** | The "against" side is where the risk lives: an "abnormal move", a "failed breakout" or a "stretched" flag can be the most informative item even if outnumbered. A score or label that looks positive can hide a stretched move. Read both lists. |
| **Caveats** | The counts and the score use overlapping but not identical thresholds. A factor present in one list can be absent from the score. |

### 6.15 Worked example (all values illustrative)

**Hypothetical top gainer — "ALPHA"** (a mid-cap in "Capital Goods"; NIFTY 500 +0.2% that day, market regime Sideways)

| Column | Value | Read it as |
|---|---|---|
| Change | **+7.8%** | Big move; sets context. |
| Close in range | **88%** | Closed near the high: the gain held into the close. |
| Rel. volume | **2.6x** | Well above the 20-session average: meaningful participation. |
| Turnover | **₹42 cr** | Liquid enough that quoted prices are plausible. |
| vs 52W high | **−3.1%** | Near its one-year high. |
| vs resistance | **+1.4%** | Closed above the 60-session high (by this definition, a breakout). |
| vs industry | **+5.9pp** | Peers rose only +1.9% (median): stock-specific strength, partly sector-wide. |

*Component scores:* Price structure **+2** (strong close +1; closed above prior high +1). Volume **+1**. Relative strength **+2** (stock 1M +4.2pp vs NIFTY 500, +1; Capital Goods has no tracked sector index, and industry peers moved the same way, so the sector-wide bonus +1). Market **0** (NIFTY 500 +0.2% below the 0.5% trigger; regime Sideways). Extension **−1** (today's move is 3.4σ of its recent daily changes; 20-day-average distance 9% and 5-session return +12% are below the stretched thresholds). **Net = +4**.

*Evidence:* net ≥ 3, price ≥ 1, volume +1 → **Continuation characteristics**. *Setup:* not extended, close ≥ 70%, relative volume ≥ 1.5x, above prior high → **Possible breakout setup**. *For / against:* roughly 7 / 1 (the one against: abnormal move).

*How to interpret together:* a clean, well-supported gainer. The pieces that carry the argument are the *close* (88%) and the *volume* (2.6x) confirming the *breakout* (+1.4%) in a stock outperforming its industry. The pieces that argue for caution are the **3.4σ move** (unusual for this stock) and the fact that a +7.8% day has already happened. **None of this predicts tomorrow.** Historically (the project's own evaluation) top gainers with this label closed higher the next session about as often as any stock did ([Chapter 10](#10-scores-and-historical-evaluation)). Next steps: read the filings, check the chart, decide on liquidity, risk and a plan of your own.

**Hypothetical top loser — "BETA"** (small-cap in "Chemicals"; NIFTY 500 −0.9%, NIFTY 50 −0.8%, market regime Bearish; stock not in a tracked sector index)

| Column | Value | Read it as |
|---|---|---|
| Change | **−6.4%** | Large fall. |
| Close in range | **12%** | Closed near the low: sellers in control at the close. |
| Rel. volume | **3.1x** | Heavy participation — in a fall, this means heavy *selling and buying*, not just selling. |
| Turnover | **₹18 cr** | Reasonably liquid. |
| vs 52W high | **−31.0%** | Already far below its high. |
| vs resistance | **−24.0%** | Far below the 60-session high; no breakout context. |
| vs industry | **−5.2pp** | Peers fell −1.2% (median): mostly stock-specific. |

*Components:* Price structure **+2** (close near low +1; closed below the prior 60-session low +1). Volume **+1**. Relative strength **+2** (1M relative strength −3.5pp, in the move's direction: +1; no tracked sector index and peers fell −1.2% so the sector-wide bonus +1). Market **+2** (NIFTY 500 and NIFTY 50 both down ≥ 0.5%, +1; Bearish regime, +1). Extension **0** (20-day distance −9%, 5-session −11%, 2.4σ: none triggered). **Net = +7.**

*Evidence:* **Downside-continuation characteristics.** *Setup:* loser, close ≤ 30% and below its 50-day average → **Weak momentum**. *For / against:* about 7 / 0.

*How to interpret together:* all conditions describe a stock that fell on a weak market with heavy volume and closed at the low. That describes *the day*. Note what the numbers cannot tell you: whether panic selling is exhausted, whether there was news (check the filings in the panel), or whether a bounce comes tomorrow. In the project's history, losers with a bearish label did *not* fall reliably the next day either: roughly 44–47% closed higher ([Chapter 10](#10-scores-and-historical-evaluation)). The dashboard gives no entry, stop or target.

---

## 7. Daily Movers: other views and filters

### 7.1 Header controls and market strip

| Control | Options | Effect |
|---|---|---|
| **Session** | The latest session (default) or any of the most recent 260 sessions | Rebuilds the whole page for that date using only data available at that close. A "Historical view" notice appears. |
| **List size** | top 10 / 20 / 50 | How many rows each list shows. (Candidates are always built for the top 50 gainers and top 50 losers so the Continuation and Exhaustion views have a pool.) |

The **market strip** shows: market regime of NIFTY 500 for that date; NIFTY 500's change that day; NIFTY 50's change and whether it is above its 50-day average; % of NIFTY 500 stocks above their 50-day average; and how many stocks were eligible, unchanged, had no bar, or were excluded for price discontinuities. The page also shows the session date, data sources, universe size and when the filings feed was last read.

### 7.2 The four views

Pick a view with the buttons above the tables. All use the same 13 columns ([§6.2](#62-the-columns-at-a-glance-13-including-rank)).

| View | Contents | Purpose / when to use | Default sort |
|---|---|---|---|
| **Top gainers & losers** | Two tables: top *N* by % change up, top *N* by % change down | The standard "movers" list. Start here. | Gainers: change, high→low. Losers: change, most negative first. |
| **Unusual volume** | Top *N* stocks by **relative volume** (today ÷ previous-20 mean), **either direction**; unchanged stocks excluded; needs the volume baseline | Find stocks with abnormal activity whether or not they are top movers — including volume surges with small price moves. | Rel. volume, high→low |
| **Continuation characteristics** | From the top-50 gainers and top-50 losers, those whose evidence **category** is *Continuation* (losers: downside continuation), sorted by size of move | See which big movers have both a confirming close and confirming volume. **The project's own testing found this category did *not* reliably continue** ([Chapter 10](#10-scores-and-historical-evaluation)). | Score, high→low |
| **Exhaustion / reversal risk** | From the same pool, those in the *Exhaustion/reversal* category (losers: *rebound/reversal risk*) | See big movers showing stretch, rejection or fading support. **Not an instruction to trade against the move.** | Score, low→high |

How they differ: *Top gainers & losers* is **ranked by price change only**. *Unusual volume* is ranked by **participation only**. The last two are **filtered by the evidence category** (and then listed by the size of the move), so they can contain stocks that are not in the displayed top *N* of the first view.

### 7.3 Filters (apply to every view)

| Filter | Options | Effect |
|---|---|---|
| **Min move** | any, ≥ 2%, ≥ 3%, ≥ 5%, ≥ 10% | Keeps stocks whose absolute % change is at least this. |
| **Rel. volume** | any, ≥ 1x, ≥ 1.5x, ≥ 2x, ≥ 3x | Keeps stocks with relative volume at least this. Stocks with N/A relative volume are removed whenever a minimum is set. |
| **Industry** | All industries, or one of the NSE industries | Keeps one industry. *(There is no sector-index filter on this tab.)* |
| **Size** | All sizes; Large (NIFTY 500 ex Midcap/Smallcap); Midcap 150; Smallcap 250; Microcap 250 | Filters on the size proxy from *current* index membership. |
| **Distance from resistance** | Any; At/above resistance; Within 3% below or above; Within 5%; Within 10% | Keeps stocks whose close is at most that far *below* the 60-session high (those already above it pass). Stocks with N/A resistance are removed. |
| **Pattern** | Any pattern; Closed above resistance; Breakout retest held; Within 5% of 52-week high; Consolidating before the move; Confirmed triangle before the move | Pattern checks. "Before the move" means evaluated on data through the *previous* session. |
| **Setup** | All setups, or one of the 7 labels | Filters on the **Setup** label. |
| **Evidence category** | All; Continuation characteristics (losers: downside); Mixed evidence; Exhaustion/reversal risk (losers: rebound); Insufficient evidence | Filters on the **Evidence** badge. |
| **News status** | Any; Exchange filing found; No filing (window covered); Not covered (unknown) | Based on NSE filings in the window between the previous close and the next open. "No filing (window covered)" is shown only when the feed was read across the *whole* window ([Chapter 9](#9-news-and-nse-filings)). |
| **Liquid only** (checkbox) | on/off | Hides stocks with any liquidity warning (median turnover under ₹1 crore, or trade-for-trade BE/BZ series) or with no turnover baseline. |
| **Reset** | | Restores defaults. |

The table header shows "*x* of *y* shown" so you can see how much a filter removed.

The page also includes the **Historical evaluation** panel ([§10.5](#105-the-evaluation-panel-in-the-app)) and, when relevant, the **Not ranked this session** list.

---

## 8. Stock detail panels

There are three detail panels: sector, industry, and stock. The stock has two flavours, one for the Screener and one for Daily Movers.

### 8.1 Sector and industry detail views

Opened from the Sectors or Industries tab.

| Element | What it shows |
|---|---|
| **Price history** (sector) | Chart of the index close. |
| **Relative strength vs NIFTY 500 (RS ratio)** (sector) | Line of sector close ÷ NIFTY 500 close. Rising = outperforming. |
| **Returns across all timeframes** | 1D, 1W, 1M, 3M, 6M. (Industry: *average* returns, with *n* stocks for each.) |
| **Moving-average breadth** | %>20, 50, 200-DMA with *eligible/total*, plus distance from 52-week high. (Industry: also average 3M relative performance, with *n*.) |
| **Strength score breakdown** | Each of the nine scoring conditions with ✓ / ✗ / — (not available) and its points. |
| **Why this classification?** | The reasons from the regime rule, a conflict note if the 1M and 6M trends disagree, and the confidence level with reasons. |
| **Recent classification history** (sector) | The regime as it would have been for each of the last 5 sessions, recalculated from price history using **today's constituent list**. A note appears if the last session's classification changed. |
| **Data source & quality** | complete / partial / unavailable, and what is missing. |

### 8.2 Daily Movers stock panel

Opened by clicking a row in any Daily Movers table. Sections, in order:

| Section | Content | See |
|---|---|---|
| **Header** | Symbol, company, industry, size segment, rank ("#3 top gainer for the NSE session of …") | [§6.3](#63-symbol) |
| **Evidence badge, Setup badge, explanation paragraph** | A paragraph assembled only from the calculated components and the historical statistics. | [§6.11](#611-evidence), [§6.12](#612-setup) |
| **Component scores** | One row per dimension (Price structure, Volume/participation, Relative strength & sector, Market, Extension/exhaustion) with the score, its range and the reasons; and the **Net** total with the rationale. | [§6.13](#613-score) |
| **Supports further upside / further weakness** | The continuation factors, with numbers. | [§6.14](#614-for--against) |
| **Supports a reversal** | The reversal factors. | |
| **Reasons for low confidence** (if any) | Insufficient-evidence gates, liquidity warnings, data-quality notes, market regime not classifiable, too few industry peers, and — for losers of ≥ 15% — a reminder that the fall may include an unadjusted corporate action. | |
| **Historical next-session record for this group and label** | Appears after you run the historical evaluation (see below). Shows observations (dates), % next close higher (with 95% interval), mean/median next-session change, % beating NIFTY 500, % where the next low fell below today's low, and next open→close return net of cost. Labelled "not a probability for this stock, and not a forecast". | [Chapter 10](#10-scores-and-historical-evaluation) |
| **Price action** | Change, open→close, gap at open, close in the day's range, body / upper wick / lower wick shares of the range, distance from 20-session swing high, returns over 3/5/10/20 sessions, the move in standard deviations (**σ**, today's change ÷ standard deviation of the previous 20 daily changes), distance from 20/50/200-day averages, and distance from the 52-week high. | |
| **Patterns** | The resistance level, its date and the close's distance from it; breakout / failed breakout note; whether a breakout retest held; and whether the stock was consolidating or formed a triangle before today. | [§6.9](#69-vs-resistance) |
| **Volume and participation** | Volume (shares), relative volume (2 decimals), turnover, median turnover (20 sessions), delivery % today versus its 20-session average, and NSE series (EQ / BE / BZ / RR); any liquidity warnings. | [§6.6](#66-rel-volume), [§6.7](#67-turnover) |
| **Sector and market context** | Industry peers' median change (and count), whether the move looks sector-wide or stock-specific, stock and industry 1-month return vs NIFTY 500, NIFTY 500 and NIFTY 50 that day, market regime; if the stock is in a tracked sector index: that index's change today, stock minus index (pp), the index's 1-month relative strength and the share of its stocks above their 50-day average. | [§6.10](#610-vs-industry) |
| **Exchange filings and catalysts** | Filings in the window; each with category, timing (before or after the close), link, date, summary, a generic "why it can matter" sentence, and a possible-follow-up note. | [Chapter 9](#9-news-and-nse-filings) |
| **Price / Volume charts** | Last up to 120 comparable sessions of closing price, and of volume. | |
| **Last 10 sessions** | Table of date, open, high, low, close, volume and delivery %. | |
| **Charts elsewhere** | Links to the NSE quote page and a TradingView chart for the symbol. | |
| **Data quality** | Status (ok / limited), number of comparable sessions used, and from which date. | |

**Delivery %** = deliverable quantity as a percentage of traded quantity (from NSE). It is 100% by rule in the BE/BZ series. It is shown for information and is **not used in any score or label**.

The panel displays a standing notice: *"Research information only … not a buy or sell recommendation. No entry price, stop-loss or target is given."*

### 8.3 Screener stock panel

Opened from the Stock Screener tab. Sections: price integrity warning (if any); price history chart; returns 1D–6M; distance from 52-week high; 3M relative performance; above own 50-DMA (Yes/No/N/A); above own 200-DMA; the three pattern heuristics with their measured values; "Why this score — pass/fail reasons"; data quality. It carries the same disclaimer. It does not show volume, filings or a "for/against" analysis.

### 8.4 From summary to detailed assessment

1. In a table, note the row's headline numbers.
2. Open the panel and read the **explanation paragraph** and **component scores** to see which components drive the net.
3. Read **both** the continuation and reversal lists.
4. Check **Price action** and **Patterns** for stretch (σ, distance from the 20-day average) and for the resistance level.
5. Check **Volume and participation** and warnings for liquidity.
6. Check **Sector and market context**: was it the sector, or the stock?
7. Read the **filings** — and the coverage line.
8. Look at the charts, then use the links to examine the chart on a full charting platform.
9. Optionally run the historical evaluation and read how this group and label did.

---

## 9. News and NSE filings

### 9.1 What is shown

The dashboard shows **exchange filings**, not news articles. Each item comes from NSE's official corporate-announcements RSS feed (`nsearchives.nseindia.com/content/RSS/Online_announcements.xml`), collected by the scheduled pipeline into `announcements.json`. It uses no sentiment: the category comes only from the keywords in NSE's own **subject** line, and the page tells you to open the filing to judge it.

An item is linked to a stock only if the filing's link prefix is exactly a tracked symbol, or its normalised company name equals a tracked company's; conflicting matches are dropped and unmatched items are discarded, never guessed. Only stocks in the Daily Movers universe are covered. Items are kept for 30 days.

### 9.2 The window

For a session *t*, the window runs from the **previous session's close (15:30 IST)** to the **next session's open (09:15 IST)**, or to "now" if the next session hasn't happened. Each filing is tagged:

| Tag | Meaning |
|---|---|
| **before the close** | Published after the previous close and up to 15:30 on *t* — it could have contributed to *t*'s move. |
| **after the close** | Published after 15:30 on *t* — known before the next session but not reflected in *t*'s close. |

### 9.3 Filing categories

Assigned by the first matching keyword rule on the subject (order matters):

| Category | Triggered by (examples) | Why it *can* matter (the app's generic text) |
|---|---|---|
| **Financial results** | "financial result", "results"; board-meeting outcome mentioning results | Earnings often move prices based on how they differ from expectations; the filing doesn't say what the market expected. |
| **Orders / contracts** | "order", "contract" (not court/tribunal) | Orders can change revenue visibility; size relative to revenue matters. |
| **Acquisition / merger** | acquisition, amalgamation, merger, demerger, scheme of arrangement, takeover | Can change the business or capital structure. |
| **Corporate action** | dividend, bonus, split, buyback, rights issue, record date, book closure | Can change the quoted price mechanically on the ex-date without changing value. |
| **Fund raising / allotment** | fund raising, preferential, QIP, allotment, capital | New shares or debt can dilute or fund growth. |
| **Credit rating** | credit rating | A change often reads as a financial-health signal. |
| **Legal / regulatory** | insolvency, litigation, penalty, show cause, court, tribunal, SEBI, search, raid, fraud, default | May carry penalties or restrictions. |
| **Management / board change** | director, KMP, SMP, management, appointment, resignation, cessation, auditor | Usually less price-moving than results. |
| **Meeting / investor communication** | board meeting, shareholders meeting, investor, analyst, con. call, presentation, press release | Often a schedule notice. |
| **Routine compliance** | NAV, newspaper, trading window, certificate, ESOP/ESOS/ESPS, XBRL, regulation, loss of share, duplicate | Rarely price-relevant. |
| **Other filing** | everything else | Open it to judge. |

Because rules are keyword-based, a category can be wrong or overly broad (e.g. "capital" in a subject triggers *Fund raising*). Treat the category as a filing-type hint.

If a filing of the same category for the same stock appeared more than 24 hours earlier in the retained data, the panel notes "possibly a follow-up".

### 9.4 Relevance, causation and absence

- **A filing near a move does not prove the filing caused the move.** Prices respond to many things at once; timing alone is not causation. The panel shows a filing's timing (before/after the close) precisely to avoid implying that an after-the-close filing explains today's move.
- **No filing does not mean no news.** The feed carries only company filings submitted to NSE. It excludes media reports, brokerage notes, social media, rumours, sector-wide news, and anything on other exchanges or sources. Large moves can happen with no filing at all.
- **Coverage limits.** NSE's feed holds **only the current IST day**. The pipeline reads it roughly once or twice per trading day. So filings published between reads can be missed, and nothing before collection began exists. The dashboard records exactly which time spans each successful read covered and reports: **"No exchange filing found — the feed was read across this whole window"** (covered), **"No filing found, but the feed covered only x% of this window"** (partial), or **"Not covered … Unknown, not 'no news'"** (not covered).
- **History is short.** Collection began around 27 Oct 2026 (the first recorded feed read), so earlier sessions have no filings at all; historical views before that show "not covered". For recent sessions, coverage is typically partial. **Always check the coverage line.** The News filter's "No filing (window covered)" option is rarely satisfied for that reason.
- The historical evaluation does **not** use filings.

---

## 10. Scores and historical evaluation

### 10.1 Key ideas in plain English

| Term | Meaning |
|---|---|
| **Technical score** | A count of rule checks (e.g. "close above 50-day average ✓"). It is built from price and volume rules. |
| **Probability** | A calibrated chance that something will happen (e.g. "62% of cases like this rose"). The dashboard **deliberately shows none**, because its checks found no evidence that its labels beat a simple baseline. |
| **Historical hit rate** | The share of past cases where something happened (e.g. next close higher). It describes the past sample only. |
| **Expected return** | The average gain you might expect in the future. A hit rate is not an expected return: you can win 60% of the time and lose money if the losses are bigger. And a past hit rate is not a forecast. |
| **Base rate** | The hit rate of doing the simplest thing: e.g. taking *every* top-20 gainer, ignoring the score. A signal is only useful if it beats its base rate by more than chance. |
| **Lift** | A category's hit rate minus the base rate, in percentage points. |
| **Precision / recall** | Precision: of the stocks flagged, the share that "continued". Recall: of all that continued, the share that were flagged. |
| **Confidence interval (95%)** | The range of values consistent with the data. If the interval for a signal's hit rate includes the base rate, the data cannot tell the two apart. |
| **Clustered intervals** | Stocks that move on the same day move together (market and sector effects), and the same stock appears on many days. So the dashboard widens its intervals by clustering by date and by stock; **the number of distinct dates, not the raw count of observations, is the better guide to sample size**. |
| **Walk-forward evaluation** | A test that predicts each date using only *earlier* dates' outcomes, as you would have had in real time. It uses no information from the future. |
| **Brier score / skill** | A measure of how good probability forecasts are (lower is better). Skill = 1 − (label's Brier ÷ base-rate Brier). **Skill ≤ 0 means the labels did no better than the group's base rate.** |
| **Next-session outcome** | What happened on the trading day after the signal day, kept separate: close-to-close change, change vs NIFTY 500, higher high, lower low, and the next-open→next-close return after cost. |
| **Transaction costs** | Brokerage, taxes, bid–ask spread and slippage. The evaluation subtracts a flat round-trip cost (default 20 basis points = 0.20%; options 10/20/30/50). |
| **Survivorship bias** | Using only stocks that still exist today leaves out those that were delisted or fell out of the index, so past results can look better (or distort loser statistics) than a real-time investor would have seen. |
| **Corporate-action limitation** | Prices are unadjusted for splits, bonuses, rights and dividends, so the dashboard avoids comparing prices across detected breaks; small undetected ones remain possible. |

### 10.2 Technical score versus probability

Everything labelled "Score", "For / against", "Evidence" or "Setup" is **an observation about the day**, not a statement about tomorrow. The documentation for the project is explicit: the count of factors "is not a probability", and **no probability is shown anywhere** because the walk-forward test found no skill ([§10.4](#104-what-the-results-mean)).

### 10.3 Documented historical results

Source: `NEXT_DAY_MOMENTUM.md`, produced by `npx tsx scripts/audit/momentum-evaluation.mts`. **Data through 2026-10-27**; evaluation dates **2025-08-19 → 2026-10-26 (292 sessions)**; **11,673 candidate observations** (top 20 gainers and top 20 losers per day); universe **755 stocks**; costs **20 bps**; volume features start once 20 sessions of volume exist. The project's bias review is dated 2026-10-28. *(This guide's author re-ran the script on the repository's data and obtained the same figures; the live site may have a later data date, so re-run the evaluation in the app to see your current numbers.)*

**Table A — Next-session outcomes**

| Group | n (dates) | Next close higher | Mean next day | Beat NIFTY 500 | Next open→close, net of 20 bps |
|---|---|---|---|---|---|
| All eligible stocks (baseline) | 213,550 (292) | 46.9% | +0.02% | 46.2% | −0.32% |
| NIFTY 500 index | 292 | 50.3% | −0.02% | — | — |
| Top-20 gainers | 5,835 (292) | 46.1% [43.9, 48.3] | +0.15% [−0.02, 0.31] | 45.9% | −0.38% |
| Top-20 losers | 5,838 (292) | 46.9% [44.5, 49.4] | −0.10% [−0.27, 0.07] | 46.7% | −0.40% |
| Gainers · Momentum continuation | 991 (247) | 44.6% | +0.06% | 44.4% | −0.34% |
| Gainers · Possible breakout | 552 (198) | 48.7% | +0.24% | 50.5% | −0.25% |
| Gainers · Extended — reversal risk | 845 (212) | 48.0% | +0.28% | 48.4% | −0.30% |
| Losers · Extended (oversold) | 204 (111) | 55.4% [47.8, 63.0] | +0.74% [−0.02, 1.50] | 52.0% | **+0.40%** |
| Losers · Weak momentum | 2,171 (253) | 44.8% | −0.21% | 44.7% | −0.55% |
| Losers · Possible reversal | 9 (9) | insufficient sample | | | |

(Brackets are 95% intervals. Other label rows exist in the app's panel.)

**Table B — Do the evidence categories beat taking every top mover?** ("Continued" = the next close moved further in the day's direction.)

| Group · category | Flagged (dates) | Precision | 95% CI | Base rate | Lift | Recall |
|---|---|---|---|---|---|---|
| Gainers · continuation → continued | 1,139 (215) | 46.5% | 43.1–49.9 | 46.1% | +0.5pp | 19.7% |
| Gainers · exhaustion → reversed | 1,488 (253) | 54.4% | 51.1–57.7 | 53.8% | +0.6pp | 25.8% |
| Losers · downside continuation → continued | 803 (205) | 56.2% | 50.8–61.5 | 52.9% | +3.2pp | 14.6% |
| Losers · rebound risk → reversed | 485 (207) | 50.1% | 44.8–55.4 | 46.9% | +3.2pp | 8.9% |

Other documented results: walk-forward Brier skill **−0.002 (gainers) and +0.0001 (losers)** for the labels, and **−0.003 / −0.001** for the evidence categories; the "higher high" rate for gainers was 59% versus 44.5% for the baseline (this reflects the range they had just set, "not an edge").

### 10.4 What the results mean

**These results do not establish a reliable next-day predictive edge.** In plain terms:

1. **No separation from the baseline.** Gainers' next-day "up" rate (46.1%) is statistically indistinguishable from the universe's (46.9%): the 95% intervals overlap. The mean of +0.15% has an interval that includes zero.
2. **Every category lift lies within uncertainty.** Each base rate falls inside the category's 95% interval.
3. **The walk-forward test shows no skill** (≈ 0 or negative), which is why the dashboard shows no probability.
4. **After costs, the tradable return is negative** for almost every group. The one positive subgroup (oversold losers, +0.40% from 204 observations on 111 dates) was **not stable over time** (+2.53%, +0.09%, −0.13% in the three chronological thirds). Treat it as noise.
5. **Only a mechanical effect shows up** — gainers more often make a higher high the next day, which reflects the range just set.
6. **Short and single-regime sample.** About 14 months, largely bearish-to-sideways, one market. Little can be concluded about other conditions.

The project's own conclusion: *the continuation scoring has not shown useful out-of-sample improvement over simply taking the day's top movers; it remains an exploratory research tool.* **The feature must not be treated as a proven trading strategy.**

**Known biases (documented):**

- **Survivorship:** today's constituents are applied to the whole history; stocks delisted or removed are missing. This could understate the downside continuation of losers; for gainers the direction is unclear.
- **Corporate actions:** prices are unadjusted; discontinuity days are excluded (120 stock-days not ranked, of which 40 suspected corporate actions; only 6 of 11,679 observations dropped for a discontinuous next bar). Bonuses below ~6:5 and small rights issues are undetected. Genuine ≥15% gap-downs on the next day are dropped along with corporate actions, which flatters the worst outcomes slightly.
- **Dividends** are not adjusted (typically under 1% on the ex-date).
- **No historical filings** are used.
- **Costs:** a flat assumed round-trip cost; actual costs and slippage vary, especially in thin stocks.
- **Execution:** the close-to-close outcome isn't tradable (the signal is only known at the close). The next-open→close outcome assumes you could trade at the open and at the close.

### 10.5 The evaluation panel in the app

At the bottom of the Daily Movers tab, **Run historical evaluation** rebuilds every past session's gainers/losers from the data available at that close and records what happened on the next session. Controls: list size (10/20/50) and cost (10/20/30/50 bps). It runs in your browser in a few seconds. Output tables: baselines; by evidence category; precision/recall/lift versus the base rate; by chronological third; first-appearance-only; by liquidity; by move size; by industry; by setup label; by market regime; by volume confirmation; walk-forward calibration; exclusions; limitations. Rows with fewer than **30 observations or 20 dates** are flagged "insufficient sample".

Column key: *n (dates)*; *Next close higher* and its 95% CI; *Mean*, *Median*; *10th/90th pct*; *Down ≥3%*; *Beat NIFTY 500*; *Higher high* (next high above today's high); *Lower low*; *Open→close net* (after cost).

### 10.6 The Backtest tab (screening rules)

Separately, the **Backtest** tab tests the Stock Screener's rules (nine, including the composite score ≥ 6) against past prices.

| Setting | Default | Notes |
|---|---|---|
| Holding period | 10 sessions (1–60) | Entry at the **next session's open**, exit at the close *N* sessions after the signal. |
| Round-trip cost | 20 bps (0–500) | |

**Columns:** Rule; Signal N; Win Rate; Avg Net Return; Median Net Return; Baseline Avg Net Return; Baseline N; **Edge vs Baseline** (signal average minus unconditional average, pp). A "low N" badge appears under 30 signals.

**How to read it:** the baseline is "hold any stock, any day, over the same period". The tab opens with a warning that **it is not evidence any rule is profitable**: survivorship bias, overlapping trades, one ~14-month window, no significance test, in-sample tuning if you change Settings. The project's audit (hold 10, 20 bps) found most rules with a small negative or near-zero edge, e.g. "Near 52-week high" −0.43pp, "Triangle (confirmed)" −0.55pp, "3M relative performance positive" +0.33pp — all within the limits above. See `AUDIT_REPORT.md`.

---

## 11. Practical workflow

> This is a **research workflow**, not an automatic buy/sell process. The dashboard cannot tell you what to buy, when, at what size or where to exit.

### 11.1 Step-by-step

| Step | Action | Where | What you are looking for |
|---|---|---|---|
| 0 | **Check freshness** | Header | Latest market data date; Pipeline refresh; Status. |
| 1 | Check broad market direction | Segment panels; Market Overview | NIFTY 500 returns across 1M/3M/6M; breadth; are midcaps/smallcaps confirming? |
| 2 | Identify strong and weak sectors | Sectors tab (sorted by Score) | Regime, score, 3M RS. |
| 3 | Check breadth and relative strength | Sector detail | %>20/50/200, RS-ratio chart, recent classification history. |
| 4 | Check the industry view | Industries tab | Whether the stocks in the sector's industry agree; *n* and outliers. |
| 5 | Open the Stock Screener | Stock Screener tab | Filter to leading sectors/industries; sort by Score. |
| 6 | Look for stocks strong *relative to their industry* | Screener + stock panel | Positive 3M RS, above 50/200-DMA, near highs. |
| 7 | Open Daily Movers | Daily Movers & Continuation | Confirm the session date and notices. |
| 8 | Review gainers and losers | Top gainers & losers view | Size of move; is it in your sector of interest? |
| 9 | Examine relative volume and turnover | Rel. volume, Turnover | Participation, liquidity. |
| 10 | Check the close in range | Close in range | Did the move hold into the close? |
| 11 | Review 52W high, resistance, industry | vs 52W high, vs resistance, vs industry | Context; stock-specific vs sector-wide. |
| 12 | Read the evidence for and against | Detail panel | Both lists; extension. |
| 13 | Check filings and coverage | Detail panel | What was filed, when, and what's *not* covered. |
| 14 | Do your own work | Outside the dashboard | Chart, liquidity in your size, your risk limit, your plan. |

### 11.2 Scenario examples (all values illustrative)

**A. Strong market, strong sector.**
NIFTY 500 +9% in 3M, %>50D = 72%. Sector regime Bullish 8/9 with %>200D 80%, 3M RS +4pp. In the Screener (leading sectors only) you find stocks scoring 8+/10. *Reading:* conditions favour trend-following research. *Cautions:* when everything is green, ask what is already priced in; check that the stock isn't extended ([§5.6](#56-strong-versus-overextended)).

**B. Weak market, strong individual stock.**
NIFTY 500 −7% in 3M, %>50D = 25%, regime Bearish. Stock Y: 3M +6%, 3M RS +13pp, above 50- and 200-DMA, near its 52-week high. *Reading:* real relative strength. *Cautions:* it is swimming against the tide; its industry's regime matters; falling markets often drag strong stocks down too. Relative strength is not immunity.

**C. Top gainer with unusually high volume but a weak close.**
+9%, rel. volume 6.0x, close in range 28%. *Reading:* many traded, but the gain did not hold into the close — upper-wick and fade; score −1 for the close (below 50%) and likely −1 for a wick ≥40%. Setup: **Weak momentum** (close below half of the range). *Take-away:* volume confirms *activity*, not buyers; this is the "high volume, weak close" pattern to be suspicious of. Check the filings for an event (results, deal) that explains the volume.

**D. Top loser with unusually high volume and a close near the low.**
−8%, rel. volume 5.0x, close in range 6%, below 50-DMA. *Reading:* heavy selling that persisted into the close. Category likely Downside-continuation if market and relative strength agree; Setup **Weak momentum**. *Cautions:* high-volume selloffs can also mark capitulation; the project's data show losers' next days were mixed (~44–47% closed higher). Do not read this as either "short it" or "buy the dip". Check if the fall is a corporate action ([§12.5](#125-corporate-actions)) or a filing.

**E. A stock near resistance.**
Close −1.5% below the 60-session high, range ratio 0.5. Screener flags **Res** and **Cons**. *Reading:* coiled near a recent peak. *Cautions:* "resistance" is only the highest high of 60 sessions; a close above it on volume under 1.0x of average still earns the breakout point but also takes −1 on volume. Wait to see whether it clears *and* holds is your judgement, not the dashboard's.

**F. Strong but overextended.**
Daily Movers: gainer +11%, close ≥ 18% above its 20-day average. Setup: **Extended — reversal risk**; Extension component −2; category Exhaustion/reversal. *Reading:* the stock has moved far from its own recent average. Such stretched moves are more often followed by pauses or pullbacks *in general*, but the project's data did not show a reliable next-day reversal either. *Take-away:* it's a prompt to examine risk, not a short signal.

### 11.3 Habits that go with the dashboard

- Treat labels as questions, not answers.
- Look for **disagreement** between indicators — the most informative cases.
- Use the Backtest and evaluation panels to calibrate your expectations: they are sobering.
- Keep your own record of what you looked at and why.

---

## 12. Data sources, refresh and limitations

### 12.1 Sources

| Dataset | Source | Used for |
|---|---|---|
| **Index history** (20 series: NIFTY 50, NIFTY 500, 15 sectors, Midcap 150, Smallcap 250, Microcap 250) | NSE daily all-indices close file (`ind_close_all_DDMMYYYY.csv`) | Index returns, 52-week highs, relative strength |
| **Stock history** (OHLC) | NSE full equity bhavcopy (`sec_bhavdata_full_DDMMYYYY.csv`), series EQ, RR, BE, BZ | Stock metrics, breadth, patterns, movers |
| **Volume, turnover, delivery %, series** | The same bhavcopy rows | Daily Movers only |
| **Constituent lists & industries** | niftyindices.com constituent CSVs (NIFTY 500, 15 sectors, Midcap 150, Smallcap 250, Microcap 250) | Breadth, industries, universe, size segment |
| **Company filings** | NSE corporate announcements RSS feed | Daily Movers filings |

Full details are in [`DATA_SOURCES.md`](../DATA_SOURCES.md).

### 12.2 Freshness — **end-of-day, not real time**

All data is **end-of-day**. The latest figure is the last completed session. The dashboard **cannot show live or intraday prices**, and the "Refresh Data" button only re-reads files the pipeline published. The pipeline normally runs after NSE publishes its files (about 20:00 IST) with an early-morning retry, subject to GitHub scheduling delays. Index and stock history cover about 14 months (a 420-day fetch window). Hosting caches files for up to ~10 minutes after a new deploy.

### 12.3 Pipeline status and missing data

- Every date's outcome (ok, missing, earlier-session, failed, invalid, incomplete) is recorded; a failed download never removes valid data, and nothing is interpolated.
- A timeout is never treated as a holiday.
- **Missing values are shown as N/A, never zero.** Missing metrics reduce a score's *possible* points rather than counting as failures.
- Stale stocks (no bar within 7 days of the market date) get no metrics or score and are left out of breadth and industry averages.
- Placeholder "DUMMY" symbols and constituents that haven't started trading have no price rows.
- The Data quality warnings box lists current issues.

### 12.4 Constituent lists and historical membership

- Lists are fetched **manually** (a workflow run after index reconstitutions) and carry no effective date — only the time they were fetched. So the lists may lag NSE's latest changes.
- **The current lists are applied to all historical dates** (survivorship bias): in the Backtest, the evaluation, the "recent classification history" strip and the Daily Movers size segment. A change log records changes from now on; membership before that is unknown.
- The Daily Movers universe is NIFTY 500 + NIFTY Microcap 250 (the components of Nifty Total Market, checked on 2026-10-27, with two later index changes noted in `NEXT_DAY_MOMENTUM.md`).
- Five NSE sectoral indices are not tracked. A handful of stocks in narrower sector indices but not in NIFTY 500 appear in sector breadth but not in the Screener or Industries.

### 12.5 Corporate actions

NSE bhavcopy prices are **raw**. A 1:1 bonus appears as −50%. The dashboard detects discontinuities and does not compare prices across them:

| Detected as | Rule | Effect |
|---|---|---|
| Suspected corporate action | Open **and** close both ≤ 60% (or ≥ 1/0.6 ≈ 167%) of the previous close | Metrics use only prices after the break. |
| Unverified discontinuity | A fall with open **and** close both ≤ 85% of the previous close — could be a bonus/rights issue **or a genuine crash** | Same; labelled "unverified". |
| Missing sessions | A NIFTY 500 trading day missing between two of a stock's bars | Same. |

Affected stocks show **"Prices from DATE only"**; metrics needing longer windows show N/A. **Not detected:** bonuses smaller than about 6:5, small rights issues, dividends. So "clean" does not guarantee the price series is adjusted.

### 12.6 Known limitations of the evaluation

See [§10.4](#104-what-the-results-mean). In short: about 14 months, one market regime, survivorship bias, unadjusted prices, no historical filings, flat costs.

### 12.7 Not used

NSE's website pages/APIs (bot-protected), the niftyindices historical API, Groww (paid per-account API; no top-gainers endpoint), and news articles or sentiment. Yahoo Finance is used only in an audit script to cross-check data, never displayed.

---

## 13. Glossary

| Term | Meaning |
|---|---|
| **Advance/decline** | Count of stocks rising vs falling. **Not provided** as such; the dashboard's "breadth" is % above moving averages instead. |
| **Adverse wick** | The part of a candle pointing against the move (upper wick for a gainer, lower wick for a loser). A wick ≥ 40% of the range scores −1. |
| **Base rate** | Success rate of the naive approach (e.g. taking every top-20 gainer). Signals must beat it. |
| **Basis point (bps)** | 1/100 of a percent. 20 bps = 0.20%. |
| **BE / BZ series** | NSE "trade-for-trade" segments where every trade must be settled by delivery; no intraday netting; delivery % is 100% by rule. Flagged as a liquidity warning. |
| **Benchmark** | NIFTY 500, to which relative figures are compared. |
| **Brier score** | Mean squared error of probability forecasts; lower is better. Used in the walk-forward test. |
| **Breadth** | How many stocks in a group participate — here, % above their 20/50/200-day averages. |
| **Breakdown** | A close below the lowest low of the prior 60 sessions (used for losers). |
| **Breakout** | A close above the highest high of the prior 60 sessions. |
| **Bullish / Sideways / Bearish** | The dashboard's regime labels ([§4.6](#46-regime-bullish--sideways--bearish)). Descriptions of conditions, not forecasts. |
| **Candle body / wick** | Body = distance between open and close; wicks = extension beyond them to the high and low. Shown as shares of the day's range. |
| **Capitulation** | A heavy-volume sell-off thought to mark selling exhaustion. Not measured by the app. |
| **Close in range** | (close − low) ÷ (high − low); 100% = closed at the high. |
| **Confidence (regime)** | Heuristic completeness/agreement of the regime inputs. Not a probability. |
| **Confidence interval (95%)** | Range of values consistent with the data; wide intervals mean little certainty. |
| **Consolidation** | Here: average daily range over 15 sessions ≤ 0.6× the 60-session average. |
| **Continuation** | The move extending in the same direction. "Continuation characteristics" = evidence category, not a prediction. |
| **Corporate action** | Split, bonus, rights issue, demerger, dividend etc. Changes the quoted price without a market-driven move. |
| **Crore / lakh** | 10 million / 100,000 (Indian numbering). 1 crore = 100 lakh. |
| **Delivery %** | Share of traded quantity that was actually delivered. Displayed only. |
| **Discontinuity / price break** | A bar that cannot be compared with the previous one (suspected corporate action, unverified gap-down, missing sessions). |
| **DMA / SMA** | Moving average of the last 20/50/200 closes (simple, equal-weighted, including today). The app says "DMA" and "SMA" interchangeably. |
| **Edge vs baseline** | A rule's average return minus the unconditional average, in pp. |
| **Equal-weighted average** | Each stock counts the same regardless of size. Used for industries. |
| **Evidence category** | Continuation / Mixed / Exhaustion-reversal / Insufficient ([§6.11](#611-evidence)). |
| **Exhaustion** | A move showing signs of running out of steam (stretch, rejection). A category, not a certain turning point. |
| **Extended** | Far from the recent average: ≥ 15% from the 20-day average or ≥ 20% over 5 sessions. |
| **Failed breakout** | Traded above the prior 60-session high but closed back at/below it. |
| **52-week high** | Highest intraday high in the trailing 365 calendar days. |
| **Gap** | Open vs previous close, in %. |
| **Hit rate** | Share of past cases in which an outcome occurred. |
| **Industry** | NSE's classification label of each company; the dashboard builds an equal-weighted aggregate. |
| **Lift** | Category precision minus base rate (pp). |
| **Liquidity** | How easily a stock can be traded without moving its price; judged here by turnover. |
| **MFE / MAE** | Maximum favourable / adverse excursion; best / worst price after a next-open entry, from the daily high/low. |
| **Market regime** | The Bullish/Sideways/Bearish classification of NIFTY 500 or a group. |
| **Median** | Middle value; used for peer changes and turnover baselines. |
| **Move scope** | Whether a move is sector-wide, stock-specific or unknown (too few peers). |
| **N/A** | Not available — missing data, never zero. |
| **NIFTY 50 / 500** | NSE's large-cap and broad-market indices. |
| **Next-session outcome** | What happened the trading day after the signal day. |
| **pp (percentage points)** | Difference between two percentages (8% − 5% = 3pp). |
| **Precision / Recall** | See [§10.1](#101-key-ideas-in-plain-english). |
| **Price integrity** | Whether a stock's metrics rest on a continuous price history ("clean", "post-discontinuity only", "stale", "no data"). |
| **Rebound risk** | The loser equivalent of exhaustion risk. |
| **Regime history** | The last 5 sessions' recalculated classification in the sector view. |
| **Relative performance** | Return minus NIFTY 500's return, in pp. |
| **Relative strength (RS)** | Performance versus a benchmark. Not RSI. |
| **RS ratio** | Sector close ÷ NIFTY 500 close; rising = strengthening. |
| **Relative volume (Rel. volume)** | Today's volume ÷ mean of the previous 20 comparable sessions. |
| **Resistance** | Here: highest intraday high of the prior 60 sessions. An analytical reference only. |
| **Retest** | Pullback to a recently broken level that holds. |
| **Series (EQ, RR, BE, BZ)** | NSE trading series; EQ = regular equity, RR = REIT/InvIT, BE/BZ = trade-for-trade. |
| **σ (sigma / standard deviation)** | Used for "move vs own volatility": today's change ÷ the standard deviation of the previous 20 daily changes. |
| **Setup label** | The rule-based label in the Setup column ([§6.12](#612-setup)). |
| **Stale** | No bar within 7 calendar days of the market date; or (status) latest date more than 5 days old. |
| **Strength score** | Count of satisfied bullish checks: sectors/industries out of 9, stocks out of 10. |
| **Support** | A price area where falling prices have paused. **Not computed** by the app. |
| **Survivorship bias** | Overstating past results by using only stocks that still exist today. |
| **Trade-for-trade** | See BE/BZ. |
| **Triangle (ascending/descending/symmetrical)** | Converging trendlines through swing highs and lows (confirmed only with ≥ 3 pivots each, within 2%). |
| **Turnover** | Value of shares traded (₹ crore). |
| **Unverified discontinuity** | A ≥15% gap-down (open and close) that may be a corporate action or a genuine fall. |
| **Volume** | Number of shares traded. |
| **Walk-forward evaluation** | Testing each date using only earlier dates' information. |

---

## Appendix A: Verification notes and discrepancies

**Method.** Each documented metric was traced to its implementation (files listed below). The live site's JavaScript bundles (main and the lazily-loaded Daily Movers chunk) were fetched and searched for every tab name, column heading, filter label and view name documented here; all were present, and the repository's `src/` matches the deployed commit. The headline evaluation figures were reproduced by running the project's own script on the repository's data (read-only).

**Key source files:** `src/lib/calculations/*` (returns, breadth, regime, scoring, patterns, validation, stock scoring, industry), `src/lib/momentum/*` (features, assess, classify, discovery, filters, news, evaluation, outcomes), `src/components/*`, `src/config/*`, `scripts/lib/announcements.mts`.

**Discrepancies and points to be aware of**

| # | Observation |
|---|---|
| 1 | **Data date.** The checked-out repository's data ends 2026-10-27; the live site's data was at 2026-10-29 when checked. Code is identical; only data differs. Documented evaluation numbers are as of 2026-10-27. |
| 2 | **NIFTY 50 in "Market overview".** NIFTY 50 is not in the Market Overview or segment panels; it appears only in Daily Movers. |
| 3 | **"Evidence" and "Setup" columns.** "Evidence" is the category badge; "Setup" is the label. There is no column listing raw evidence items; those are in the For/against counts and the detail panel. |
| 4 | **No "Sector" filter on Daily Movers.** The grouping filter is *Industry*. No advance/decline line and no support level are computed. |
| 5 | **Fixed −5% threshold.** The Screener's 52W badge and "Near 52-week high" checkbox, and Daily Movers' "within 5% of 52-week high" filter/factor, use a fixed −5%, while the score condition uses the editable setting. |
| 6 | **Settings affect Daily Movers.** The resistance lookback and regime thresholds are shared; some texts in the detail panel say "60-session" even if the setting changes. |
| 7 | **Slightly different thresholds** between the score and the For/against list (e.g. loser close-location penalty > 50% vs rebound factor ≥ 60%). Both as coded. |
| 8 | **"Status = Partial"** is the normal state while the manifest carries data-quality warnings (corporate-action breaks), which it does at the time of writing. |
| 9 | **Tentative triangles** ("Tri?") are never scored or filtered. |
| 10 | **Metric glossary example** for the stock score mentions "6/9 (not /10)" — consistent with the missing-data rule (one point unavailable). |
| 11 | **Hard-coded text.** The Daily Movers intro states the documented evaluation is "data to 27 Oct 2026". It will not update by itself. |
| 12 | **Delivery %** is displayed but not used in any score or label. |
| 13 | Industry **Regime** uses the default regime options (relative performance required); the NIFTY 500 panel is the only exemption. |

**Metrics whose calculation remains unclear:** none found. Items requiring human judgement rather than code verification: the reading bands quoted for breadth (e.g. ">70%") are interpretive rules of thumb, flagged as such in the text.

## Appendix B: Settings reference

All are in **Settings** and stored in your browser. Defaults shown. Changing them re-classifies instantly; the Backtest warns that re-running after tuning is in-sample.

| Setting | Default | Used by |
|---|---|---|
| Breadth bullish threshold (%) | 50 | Strength score breadth conditions |
| Near 52-week-high threshold (%) | 5 | Score condition (sector/industry/stock) |
| Relative-performance score weight (points) | 2 | Score; also changes the maximum possible points (9 for sectors/industries, 10 for stocks, at the default) |
| Regime breadth threshold (%) | 50 | Regime classification |
| Minimum breadth measures required | 2 | Regime (otherwise Insufficient data) |
| Minimum stocks per industry | 3 | Industry aggregate reliability |
| Resistance lookback (sessions) | 60 | Resistance, breakout, Daily Movers |
| Resistance proximity (%) | 3 | "Res" flag |
| Consolidation recent / baseline windows | 15 / 60 | "Cons" flag |
| Consolidation contraction ratio | 0.6 | "Cons" flag |
| Triangle lookback / pivot spacing | 40 / 3 | Triangle detection (minimum pivots, 2, and the flat-slope band, ±0.03% per session, are fixed defaults not shown in the panel) |

A **Local data** section lets you clear the cached snapshot (with confirmation).
