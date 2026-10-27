# Next-Day Momentum research

A dashboard tab that lists one NSE session's top gainers and top losers, sets out the evidence for and against
each move continuing into the next session, and shows how similar setups did historically. It is a research tool
that describes observed conditions. **It does not predict tomorrow's prices and gives no buy/sell, entry,
stop-loss or target levels.**

## Data

| What | Source | Notes |
|---|---|---|
| Prices (OHLC) | `public/data/stocks.json`: NSE equity bhavcopy, existing pipeline | Unadjusted for corporate actions (see below) |
| Volume, turnover, delivery %, series | `public/data/stock-activity.json`: **new**, extracted from the *same* bhavcopy rows (`TTL_TRD_QNTY`, `TURNOVER_LACS`, `DELIV_PER`, `SERIES`) | No extra downloads. Loaded only by this tab, so the main dashboard payload is unchanged. |
| Exchange filings | `public/data/announcements.json`: **new**, NSE corporate-announcements RSS (`nsearchives.nseindia.com/content/RSS/Online_announcements.xml`) | Official, no authentication. The feed holds only the current IST day, so history starts when collection started, and gaps between pipeline runs are uncovered. |
| Universe | NIFTY 500 + NIFTY Microcap 250 lists in `constituents.json` (the Nifty Total Market components) | Diffed against the official `ind_niftytotalmarket_list.csv` on 2026-10-27: 755 symbols each; differences are 2 index changes made after the lists were last fetched on 2026-10-09 (`ICICIPRULI` → `ICICILIFE`, `CCAVENUE` → `PFIZER`). Re-run *Update sector constituent lists* to pick them up. |
| Market regime, breadth | Existing calculations (`computeRegime`, `isAboveMovingAverage`, returns) | Identical to the NIFTY 500 panel on the latest date (checked by `tests/momentum/realData.test.ts`). |

**Not used:**
- **Groww.** Groww's Trade API is a paid per-account subscription (about ₹499/month according to third-party listings) with daily-expiring tokens. It has no top-gainers endpoint. A token could not be kept secret on a public GitHub Pages site. Its website lists come from private endpoints, which are not scraped. The page states that its lists are computed from NSE end-of-day data and can differ from Groww's live intraday lists.
- **News articles or sentiment.** No unpaid, authorised source was found. Filings are categorised from NSE's own subject line. No positive or negative sentiment is ever inferred.

## Discovery

For a session *t*, every universe stock with a bar on *t* gets its change against its previous **comparable**
bar. A bar that starts a price discontinuity is not ranked: a suspected corporate action (open and close both
≥40% away), an unverified gap-down (both ≥15% lower) or missing sessions. Such stocks are listed under "Not
ranked" with the unadjusted change and the reason. The top *N* (default 20, fixed) positive changes are the
gainers, and the top *N* negative changes are the losers. Lists are ranked by change, like a broker's movers page,
and never by a score.

## Features (all from data at *t*'s close)

- **Price:** change, open→close, gap, close location in the day's range, 3/5/10/20-session returns, move ÷ own 20-day volatility, distance from 20/50/200-day SMA, distance from the 52-week high.
- **Patterns** (existing detectors): close vs prior 60-session high (breakout or failed breakout), a held retest of a breakout from the last 10 sessions, consolidation and triangle *before* today's move.
- **Volume:** relative volume (today ÷ previous-20 mean), turnover, median 20-day turnover, delivery % against its 20-day average. There are liquidity warnings for under ₹1 crore median turnover and for the BE/BZ trade-for-trade series. A missing volume row is "unavailable", never zero.
- **Context:** median change of NSE-industry peers (sector-wide vs stock-specific), stock and industry 1-month return vs NIFTY 500, NIFTY 500's change, and the market regime.
- **Filings:** items between the previous close and the next open, labelled before or after the close, with coverage reported. "No filing found" appears only when the feed covered the whole window; otherwise the page says "not covered: unknown".

## Labels (fixed before any outcome was examined; `src/lib/momentum/classify.ts`)

| Label | Rule (first match wins) |
|---|---|
| Insufficient evidence | < 50 comparable sessions, no relative-volume baseline, or high = low |
| Extended — reversal risk | ≥15% from the 20-day SMA or ≥20% over 5 sessions, in the move's direction |
| Weak momentum | Gainer: close in the lower half of the range, or RVOL < 1. Loser: close in the bottom 30% and below the 50-day SMA |
| Possible breakout setup | Gainer: close above the prior 60-session high, close location ≥ 0.7, RVOL ≥ 1.5 |
| Momentum continuation candidate | Gainer: close location ≥ 0.7, RVOL ≥ 1.5, above the 50-day SMA, 1-month RS vs NIFTY 500 > 0 |
| Possible reversal | Loser: close location ≥ 0.6, RVOL ≥ 1.5, above the 200-day SMA |
| Mixed signals | Nothing above matched |

Each stock also lists its continuation and reversal factors with the numbers behind them. The counts are not a
probability.

## Outcomes (session *t*+1, kept separate; `src/lib/momentum/outcomes.ts`)

- **Close-to-close:** C(t+1)/C(t) − 1 > 0. This is not tradable: the signal is only known at the close.
- **Versus NIFTY 500:** the above minus NIFTY 500's close-to-close return.
- **Higher high:** H(t+1) > H(t). **Lower low:** L(t+1) < L(t).
- **Tradable:** next open → next close, minus a round-trip cost (default 20 bps).
- **MFE/MAE:** the next day's high and low relative to the next open. These are daily bounds; the order within the day is unknown.

## Safeguards

- **Point in time:** every feature for *t* uses comparable bars ≤ *t* (tests rewrite all later data and check that nothing changes). Outcomes use only *t*+1.
- **Nothing is fitted:** thresholds are constants. The only "learned" numbers come from the walk-forward check, which predicts each date from earlier dates' outcomes only (tested). It is scored against the group's own base rate.
- **Effective sample size:** same-day observations are correlated, so 95% intervals are clustered by date and the number of distinct dates is shown. Repeat appearances are counted. Below 30 observations or 20 dates a statistic is marked "insufficient sample".
- **Baselines:** all eligible universe stocks on the same dates, and NIFTY 500 itself.
- **Exclusions are reported, not hidden:** unranked discontinuity days, candidates whose next bar is a discontinuity, and next sessions with no bar.
- **Known biases:** current constituents applied to the whole history (survivorship); one year in a single market; genuine ≥15% gap-down next days are dropped together with corporate actions, which flatters the worst outcomes; corporate actions smaller than about 6:5 go undetected; no historical filings.

## Historical result (data 2025-08-04 → 2026-10-27; reproduce with `npx tsx scripts/audit/momentum-evaluation.mts`)

292 sessions (2025-08-19 → 2026-10-26) and 11,673 candidate observations (top 20 per group per day). Volume
features start once 20 sessions of volume exist.

| | n (dates) | Next close higher | Mean next day | Beat NIFTY 500 | Next open→close, net 20 bps |
|---|---|---|---|---|---|
| All eligible stocks (baseline) | 213,550 (292) | 46.9% | +0.02% | 46.2% | −0.32% |
| NIFTY 500 index | 292 | 50.3% | −0.02% | — | — |
| Top-20 gainers | 5,835 (292) | 46.1% [44.0, 48.2] | +0.15% [−0.01, 0.31] | 45.9% | −0.38% |
| Top-20 losers | 5,838 (292) | 46.9% [44.5, 49.4] | −0.10% [−0.27, 0.07] | 46.7% | −0.40% |
| Gainers · Momentum continuation | 991 (247) | 44.6% | +0.06% | 44.4% | −0.34% |
| Gainers · Possible breakout | 552 (198) | 48.7% | +0.24% | 50.5% | −0.25% |
| Gainers · Extended — reversal risk | 845 (212) | 48.0% | +0.28% | 48.4% | −0.30% |
| Losers · Extended (oversold) | 204 (111) | 55.4% [47.8, 63.0] | +0.74% [−0.02, 1.50] | 52.0% | +0.40% |
| Losers · Weak momentum | 2,171 (253) | 44.8% | −0.21% | 44.7% | −0.55% |
| Losers · Possible reversal | 9 (9) | insufficient sample | | | |

**What the evidence says:**
- **There is no evidence that top gainers continue higher the next day.** Their next-day "up" rate (46.1%) is no different from the universe's (46.9%), and the 95% intervals overlap. The mean is a slightly positive +0.15%, but its interval includes zero.
- **None of the labels separates next-day outcomes reliably.** In the walk-forward test, the label frequencies did no better than the group base rate: Brier skill −0.002 for gainers and +0.0001 for losers. That is why **no probability is shown** anywhere.
- **The tradable next-open→close return is negative for every group and label after 20 bps** except oversold losers (+0.40%, from 204 observations over 111 dates). That subgroup is **not stable over time**: +2.53% in the first third of the history, +0.09% in the second, −0.13% in the third. Treat it as noise until much more history accumulates.
- **What does hold is mechanical:** gainers make a higher high the next day 59% of the time, against 44.5% for the baseline. That reflects the range they have just set; it is not an edge.

## Files

- `src/lib/momentum/*`: universe preparation, features, classification, discovery, outcomes, walk-forward evaluation, filings timing, filters and freshness notices.
- `src/components/Momentum*.tsx`: the page, the tables, the detail panel and the evaluation panel.
- `scripts/lib/announcements.mts`, `scripts/fetch-announcements.mts`: filings collection.
- `src/lib/activity.ts`, `src/types/activity.ts`: the activity-file format, shared by the pipeline and the app.
- Tests: `tests/momentum/*`, `tests/pipeline/{activity,announcements}.test.ts`, `tests/components/Momentum.test.tsx`.
