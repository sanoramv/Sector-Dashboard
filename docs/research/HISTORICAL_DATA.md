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
- **Corporate actions:** ~~`PREV_CLOSE` is the exchange's adjusted previous close~~ — **wrong (corrected 2026-11-24)**.
  In `sec_bhavdata_full`, `PREV_CLOSE` on an ex-date is the UNADJUSTED previous close (TATASTEEL 1:10 split,
  28-Jul-2022: prev close 959.40, open 98.10; NESTLEIND 1:10, 05-Jan-2024: 27,116.40 vs 2,754). Splits and bonuses must
  be handled by the production price-break detector (`splitAtPriceBreaks`, detect and exclude), exactly as in the
  examined study; true adjustment would need NSE's corporate-action feed (not in these archives).
- **Industry/sector history:** not available from the archives; only today's classification. Delisted stocks have no
  industry unless it is recovered from older constituent files.
- **Market capitalisation:** not in the archives (no shares outstanding); turnover is the available size proxy.

## Validation of the 5-year archive (B4, 2026-11-24; `scripts/research/history-validate.mts`)
Report: `research-data/validation-2020-2025.json` (local). Result: **0 integrity problems.**
- **Files:** index 1,194 ok / 67 missing (holidays); stock 1,251 ok / 10 missing. Every ok file exists, gunzips and
  matches its manifest sha256 (of the downloaded bytes); every file passes the production archive checks
  (`validateArchiveText`, `interpretArchive`).
- **Calendar:** 1,194 sessions with a NIFTY 500 row, 2020-11-02 → 2025-08-22, including six weekend special sessions
  fetched with `--dates` (2020-11-14, 2023-11-12, 2024-01-20, 2024-03-02, 2024-05-18, 2025-02-01; without them every
  stock showed a spurious jump on the following session).
- **Holiday duplicates explained:** 58 equity files carry an EARLIER session date (NSE serves the previous file on a
  holiday); they are ignored, never used as the requested date. (This was the "33 stock files without an index file".)
- **2022-08-08:** NSE served an Excel workbook under the `.csv` name. Converted locally (stdlib XML reader, values
  rounded to 2 decimals) and verified: every EQ close equals the 2022-08-10 `PREV_CLOSE` (1,814 / 1,814; 2022-08-09 was a
  holiday). Manifest entry marked `recovered: xlsx-converted` with the source hash.
- **2021-11-04 (Muhurat, 1-hour Diwali session):** index file exists, the equity URL serves 03-Nov. No stock bars;
  research drops this session from the calendar (otherwise every stock would show a missing-session break).
- **Index quirk:** the 2023-04-06, 04-10 and 04-11 index files write "Index Date" month-first; accepted only when the
  swapped date equals the requested date (the production parser would reject them as a later session — safe).
- **Rows:** median 2,350 securities/day (EQ median 1,805, min 1,444); 0 duplicate symbol+series rows; 0 OHLC
  violations (low ≤ open, close ≤ high, prices > 0). 6,558 series changes (EQ ↔ BE/BZ moves, e.g. surveillance).
- **Survivorship:** 3,004 symbols; 552 stop trading more than a month before the end (delisted, suspended or merged),
  1,254 start after the beginning (new listings). Both are kept, so a turnover-rank universe is survivorship-free.
- **Benchmarks:** NIFTY 50 and NIFTY 500 every session; 23 of 25 sector/segment indices every session; Healthcare
  1,177 and Microcap 250 1,064 sessions (launched during the period).
- **Not available:** historical index membership, historical industry classification, market capitalisation,
  corporate-action factors. Research substitutes: turnover-rank universe; today's industry where the symbol still
  exists (else unknown); detect-and-exclude for corporate actions.

## Acquisition status
- 2020-11-02 → 2025-08-22 (5-year target, joining the 2025-08-25 start of the existing data): **COMPLETE**
  2026-11-24 08:33 UTC (resumed after a restart at 2023-06-01; special sessions 08:35 UTC). ~126 MB, git-ignored.
- 10-year target (2016 onwards): feasible with the older formats; not started (needs the second parser).

## Before research use (next steps)
1. Integrity pass: per-file row counts, duplicate symbols, OHLC sanity, calendar against the NIFTY 500 file.
2. ~~Corporate-action factors from `PREV_CLOSE`~~ (not possible, see above): use the production break detector.
3. A turnover-rank universe per date, then re-run the breakout study (pre-declared) on 2020-11 → 2025-08 as a **new**,
   unexamined period. That is the first genuinely out-of-sample test of the 2025–2026 findings.
