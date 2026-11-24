# Historical NSE data for research (Track C)

Research-only. Downloaded to the git-ignored `research-data/` folder and **never mixed with production data** until its
quality has been established. Downloader: `scripts/research/fetch-history.mts`.

## Sources checked (2026-11-24, official NSE archives, free)

| Data | Archive | Earliest found | Notes |
|---|---|---|---|
| Daily stock OHLC, prev close, volume, turnover, trades, **delivery** | `products/content/sec_bhavdata_full_DDMMYYYY.csv` | 2019-10 (2018-11 not found) | Every listed security and series (EQ, BE, BZ, SM, …), about 1,950 rows/day, **including stocks later delisted**. Same format the production pipeline uses |
| Older daily stock OHLC | `content/historical/EQUITIES/YYYY/MON/cmDDMONYYYYbhav.csv.zip` | 2016 (checked) | Older format; delivery comes from `archives/equities/mto/MTO_DDMMYYYY.DAT` (2016 checked). Needs a second parser |
| Index closes (all NSE indices, incl. NIFTY 500 and sectors; also P/E, P/B) | `content/indices/ind_close_all_DDMMYYYY.csv` | 2014 (checked) | About 86 indices/day in 2020 |

## What this gives and what it does not

- **Survivorship:** the stock files list every security that traded, so a universe can be rebuilt **without**
  survivorship bias (for example, the top 500 by trailing median turnover on each date). Historical *index membership*
  is not in the archives; NSE publishes reconstitutions as press releases (PDF). Turnover-rank membership is the
  practical substitute.
- **Corporate actions:** `PREV_CLOSE` in the stock file is the exchange's adjusted previous close. A ratio
  `PREV_CLOSE(t) / CLOSE(t−1)` different from 1 identifies the split or bonus factor on its ex-date. That allows real
  adjustment instead of the current detect-and-exclude approach. Dividends are not adjusted (small for this purpose).
- **Industry/sector history:** not available from the archives; only today's classification. Delisted stocks have no
  industry unless it is recovered from older constituent files.
- **Market capitalisation:** not in the archives (no shares outstanding); turnover is the available size proxy.

## Acquisition status
- 2020-11-02 → 2025-08-22 (5-year target, joining the 2025-08-25 start of the existing data): started 2026-11-24
  ~05:30 UTC, stock and index files, 1.2 s per request. Progress: `research-data/nse/manifest.jsonl`.
- 10-year target (2016 onwards): feasible with the older formats; not started (needs the second parser).

## Before research use (next steps)
1. Integrity pass: per-file row counts, duplicate symbols, OHLC sanity, calendar against the NIFTY 500 file.
2. Corporate-action factors from `PREV_CLOSE`, verified against the 41 breaks the production detector already lists.
3. A turnover-rank universe per date, then re-run the breakout study (pre-declared) on 2020-11 → 2025-08 as a **new**,
   unexamined period. That is the first genuinely out-of-sample test of the 2025–2026 findings.
