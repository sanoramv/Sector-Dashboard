# Independent historical validation of the breakout findings (B5)

> **Section 1 is the frozen plan, committed 2026-11-24 BEFORE any outcome, label count by outcome, or other result of
> the period 2020-11 → 2025-08 was computed.** Only data-integrity facts were known (`docs/research/HISTORICAL_DATA.md`,
> validation section). Results go in section 2, deviations in section 3. Nothing in section 1 may be edited after
> results exist; any later change is recorded as a deviation with its reason and timing.

## 1. Frozen plan

### 1.1 Purpose and dataset separation
Test whether the seven exploratory findings of `docs/research/BREAKOUT_CHARACTERISTICS.md` §2 (in-sample period
2025-08-26 → 2026-11-17) hold on a **new, unexamined** period. Three datasets stay strictly separate:
- **(a) examined:** 2025-08-25 → 2026-11-17 (production data; findings came from here);
- **(b) this validation:** observations 2021-11 → 2025-08 from the local NSE archive (never examined for outcomes);
- **(c) prospective:** live mv1 sessions from 2026-11-19 and shadow sessions (`docs/research/SHADOW_PREDICTIONS.md`).
No threshold, bin, group or rule is tuned on (b). A pattern first noticed in (b) is reported as exploratory, never as
validated.

### 1.2 Data
- Source: `research-data/nse` (official NSE `sec_bhavdata_full` and `ind_close_all` archives; manifest-verified;
  report `research-data/validation-2020-2025.json`, 0 problems). Never mixed with `public/data`; never committed.
- Calendar: sessions with a NIFTY 500 row, 2020-11-02 → 2025-08-22, **excluding 2021-11-04** (Muhurat session, no
  equity file). Weekend special sessions included.
- Stock bars: rows of series EQ, BE, BZ, RR (production `TRACKED_SERIES`); OHLC unadjusted; activity rows (volume,
  turnover, delivery %, series) from the same rows, as the production pipeline extracts them.
- Corporate actions: the production break detector (`splitAtPriceBreaks`, detect and exclude), unchanged.
- Index series: NIFTY 500 (benchmark), NIFTY 50 and every sector/segment index the production configuration tracks,
  matched by NSE index name; an index absent on a date is simply absent (production behaviour).

### 1.3 Universe (substitute for NIFTY 500 + Microcap 250 membership)
Historical index membership is not in the archives. Substitute, decided here:
- Semi-annual reconstitution, effective the first session of **April and October**. Ranking window: the 120 sessions
  ending on the last session of **February / August** (a one-month lag, like NSE's announcements). Only data before the
  effective date is used (no look-ahead).
- Eligible for ranking: EQ-series rows only; traded on ≥ 108 of the 120 sessions; **not an ETF**. ETF = in NSE's
  current ETF list (`research-data/reference/eq_etfseclist.csv`, sha256 `c2b95e57…c7e4`), or (not in NSE's current
  equity list `EQUITY_L.csv`, sha256 `9df2b889…6ed2`, AND the symbol matches
  `/(BEES|ETF|IETF)$|ETF|^(LIQUID|GOLD|SILVER)|NIFTY|SENSEX|NEXT50|MON100|MAFANG|MAHKTECH|^NV20|^CPSE|BHARAT22|ICICIB22|^SETF|LIQ$/`).
- Rank by median daily `TURNOVER_LACS` in the window; members = ranks 1–750. Lists fed to the unchanged production
  code: `nifty500` = ranks 1–500 (also the breadth universe), `midcap150` = 101–250, `smallcap250` = 251–500,
  `microcap250` = 501–750 (so segment large = 1–100). This is **not** NIFTY 500 membership and is never called that.
- Industry and sector-index membership: today's classification (`public/data/constituents.json`) for symbols that
  still exist under the same symbol; otherwise unknown (no sector index, industry unknown). Limitation: renamed and
  delisted stocks lose sector context; reported as a coverage figure.
- Survivorship: delisted, merged and renamed symbols stay in the universe while they rank (survivorship-free).

### 1.4 Period, rows and outcomes
- One prepared universe per reconstitution period; within a period the production functions run unchanged
  (`prepareUniverse`, `moversOn`, `rankMovers`, `buildCandidate`, `marketContextAt`, `DEFAULT_SETTINGS`), rule version
  `mv1-8ecef864` asserted. Rows = every member with a positive change (as `buildRows` in the study).
- Observation sessions: from the first session with ≥ 255 prior archive sessions (about 2021-11-15) through the last
  session whose h = 10 window ends on or before 2025-08-22. Each observation uses the period membership in force on that
  date.
- Outcomes: the sealed OD1 engine at h = 1, 2, 5, 10 (`od1For` as in the study: comparable segments, sigma window,
  NIFTY 500 benchmark), plus the tradable return open(t+1) → close(t+h) net of 10/20/40 bps (20 primary). A window that
  crosses the end of the data is pending and excluded.
- Populations, bins, matched baselines, metrics: **exactly** those of the study §1.3–§1.5 (same code, same
  definitions), plus the three shadow variants BO-wide, BO-raw, BO-cap10 as descriptive groups.

### 1.5 Hypotheses (the findings to validate) and their tests
Directional (confirmatory family, BH-FDR q = 0.10 over C1–C4):

| Id | Finding (study §2) | Test on (b) | Replicated if |
|---|---|---|---|
| C1 | Bearish regime worse for breakouts | BO_all h1 adverse, bearish − (bullish + sideways) | diff > 0, survives BH, same sign in both halves |
| C2 | The regime effect is market-wide | Aplus h1 adverse, bearish − (bullish + sideways) | as C1 |
| C3 | Day change ≥ 10% worse | BO_all h1 adverse, change ≥ 10 − change 0–2 | as C1 |
| C4 | Raw breakout has a positive benchmark-relative edge at h10 | RAW_BO h10 mean X | > 0, survives BH, same sign in both halves |

One-sided p for C1–C4: P(bootstrap diff ≤ 0) (C4: P(mean ≤ 0)).

"No difference" findings (equivalence margin ±5 pp on adverse share, 95% interval):

| Id | Finding | Contrast | Replicated if |
|---|---|---|---|
| E1 | Top-50 restriction neither helps nor hurts | BO_top50 − BO_out, h1 and h5 adverse | 95% CI inside [−5, +5] |
| E2 | Close/volume conditions do not improve outcomes | BO_all − RAW_BO, h1 and h5 adverse | 95% CI inside [−5, +5] |
| E3 | Breakouts add little beyond same-day, same-size gainers | M1 matched effect, h1 adverse | CI inside [−5, +5] |
| E4 | Evidence score has little stock-specific value | high (≥ 3) − low (≤ 1) score top-50 gainers, same session × change bucket, h1 adverse | CI inside [−5, +5] |

Outcome labels for E1–E4: *replicated* (inside), *contradicted* (CI excludes 0), *inconclusive* (otherwise).

Descriptive checks (no test): D1 consolidation flag fire rate among breakouts (finding: ~0.1%); D2 sector index RS ≥ 3
pp worse at every horizon; D3 nothing tradable: for every group and horizon, mean net-of-20-bps tradable return and its
95% interval (replicated if no group/horizon has a lower bound > 0).

### 1.6 Uncertainty
Moving-block bootstrap over sessions, block 10, 1,000 resamples, seed 20261124, percentile intervals (the study's
procedure). Halves: first and second half of the observation sessions. All four horizons are reported for every
contrast; only the horizons named above are confirmatory.

### 1.7 Reporting
Section 2 reports every C, E and D item with its label, all four horizons, signal frequency per session, the shadow
variants' historical behaviour, data coverage (sector context, insufficient-evidence share) and plain statements of
negative or inconclusive results. Run from a committed script; output JSON outside `public/`; result digest recorded.

### 1.8 Known limitations (stated in advance)
Turnover-rank universe is not index membership; today's industries; unadjusted prices with detect-and-exclude; regimes
cluster in time; free-float market cap unavailable; four years is still one market history.

## 2. Results
(Not yet computed.)

## 3. Deviations
(None yet.)
