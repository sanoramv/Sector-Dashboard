# NSE Sector Strength Dashboard — Quick Start (5 minutes)

**Open:** <https://sanoramv.github.io/Sector-Dashboard/> · **Full reference:** [User Guide](USER_GUIDE.md)

> A research and screening tool built on **end-of-day** NSE data. It gives **no buy/sell advice, entries, stops or targets**, and its scores are **rule-check counts, not probabilities**. The project's own test found **no reliable next-day edge** in the Daily Movers labels ([why](USER_GUIDE.md#104-what-the-results-mean)).

## Minute 1 — Check the data is current

Look at the header (top of the page).

| Header item | You want to see |
|---|---|
| **Latest market data** | The most recent NSE trading day (weekends and holidays have no session). |
| **Pipeline refresh** | "Complete · …". "Partial" or "Failed" means the newest session may be missing. |
| **Status** | **Live** or **Partial** are usable (Partial is normal while corporate-action warnings exist). **Stale** = data is more than 5 days old. **Cached** = click **Refresh Data**. |

"Loaded in browser" is only when *your browser* last downloaded the files, not when NSE data was updated. Details: [§2.3](USER_GUIDE.md#23-header-and-data-freshness-labels).

## Minute 2 — Read the market

Above the tabs:

- **Market Capitalisation Segments** — NIFTY 500, Midcap 150, Smallcap 250, Microcap 250: returns (1D–6M), % of stocks above their 20/50/200-day averages, and a Bullish / Sideways / Bearish label.
- **Market Overview** — NIFTY 500 returns, how many of 11 sectors are bullish / sideways / bearish, and broad breadth.

Rising returns **with** high breadth (most stocks above their averages) is broad strength. Rising returns with low breadth means a few stocks are doing the work. ([Chapter 3](USER_GUIDE.md#3-market-overview))

## Minute 3 — Find strong and weak sectors (Sectors tab)

Sorted by **Score** (0–9) by default. For each sector check:

| Column | Quick read |
|---|---|
| **Regime** | Bullish needs 1M and 3M returns up, 3M relative strength above 0, and breadth above 50% on at least 2 of 3 averages. |
| **%>20D / %>50D / %>200D** | Share of the sector's stocks above their own moving averages. |
| **3M RS** | Sector 3M return minus NIFTY 500's, in percentage points. |
| **52W Dist** | How far the close is below the one-year high (0% = at the high). |
| **Score** | Count of bullish checks passed, e.g. `7/9`. `4/5` means only 5 checks had data. |

Click a row for the detail view (charts, score breakdown, reasons). A high rank is about the *group*, not an entry signal. ([Chapter 4](USER_GUIDE.md#4-sector-and-industry-analysis))

## Minute 4 — Shortlist stocks (Stock Screener tab)

Tick **Leading sectors/industries only**, sort by **Score** (0–10), and look at the **Patterns** badges:

`52W` near the 52-week high · `Res` just below its 60-session high · `Cons` tight recent range · `Tri` confirmed triangle · `Tri?` tentative (not scored).

Badges are simple rule checks, not predictions. Click a stock for its pass/fail list. ([Chapter 5](USER_GUIDE.md#5-stock-screening))

## Minute 5 — Study the last session's movers (Daily Movers & Continuation tab)

Check the session date and any notices, then read the **Top gainers / Top losers** tables:

| Column | Quick read |
|---|---|
| **Change** | % move vs the previous close. |
| **Close in range** | 100% = closed at the day's high, 0% = at the low. A weak close on a gain means the gain was given back. |
| **Rel. volume** | Today's volume ÷ the previous-20-session average. 2.0x = twice normal. Shows participation, **not** direction. |
| **Turnover** | Value traded (₹ crore). Under ~₹1 crore median = "thin". |
| **vs 52W high / vs resistance** | Distance from the one-year high / the highest high of the prior 60 sessions (positive = closed above). |
| **vs industry** | Move minus the median move of industry peers (pp). Large = stock-specific. |
| **Evidence / Setup** | Rule-based category and label describing how the day looked. |
| **Score** | Net evidence points (−10 to +7). A tally, not a probability. |
| **For / against** | Counts of factors for continuation / for reversal. Read the lists in the detail panel. |

Click a row to see every component, the filings (with coverage) and the context. Use the other views (Unusual volume, Continuation, Exhaustion / reversal risk) and the filters to narrow. ([Chapters 6–8](USER_GUIDE.md#6-daily-movers-the-top-gainers--losers-table))

## Then do your own work

The dashboard narrows the search; it does not make decisions. Before acting on anything, check the chart, your position size against the stock's liquidity, your risk limit and your plan. Filings cover only what companies file with NSE and are collected sparsely — **no filing shown does not mean no news** ([Chapter 9](USER_GUIDE.md#9-news-and-nse-filings)).

## Five rules of thumb

1. Check the **date** first. Data is end-of-day, never live.
2. Read returns **together with breadth** and relative strength.
3. Read **both** the "for" and "against" evidence.
4. **N/A** means unavailable, never zero. Badges like "Prices from DATE only" mean a possible split/bonus was detected.
5. Past hit rates are not forecasts. See [Chapter 10](USER_GUIDE.md#10-scores-and-historical-evaluation).
