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

## 2. Results (computed 2026-11-24 08:47 UTC, after the plan commit `ff723b1`)

Run: `npx tsx scripts/research/historical-validation.mts --out research-data/historical-validation.json` (~3 min),
result digest `643f773176479135f84edffc6913513b1e9f637b9fb96726a0ea323294f2f73a`, rule `mv1-8ecef864`, 1,000 block
resamples. Study code unchanged in behaviour (its own output on period (a) is byte-identical before and after the small
refactor that added the date range).

### 2.1 Data actually used
- **928 sessions, 2021-11-15 → 2025-08-07** (≈ 4× the examined period); 8 universe periods of 750 members; 333,359
  gainer stock-days. Regimes: 433 bullish, 279 sideways, 216 bearish sessions (none insufficient).
- Signals per session: top-50 gainers 49.6; breakouts any rank 6.97 (top-50: 4.71); raw breakouts 22.8.
- Coverage limits: 57–76% of members per period carry today's industry/sector classification (renamed and delisted
  stocks do not); 80% of gainer rows have no sector index (sector context weaker than in production); 1.3% of rows are
  insufficient-evidence.

### 2.2 Group outcomes (OD1; adverse = Failed + Reversal; 95% intervals)
| Group | Stock-days | Per session | h1 adverse % | h5 adverse % | h1 confirmed % | h10 mean X (pp) |
|---|---|---|---|---|---|---|
| All gainers (Aplus) | 333,359 | 359 | 27.1 [25.4, 28.4] | 28.3 [25.4, 31.0] | 25.4 | +0.26 [−0.10, +0.55] |
| Top-50 gainers (B) | 46,066 | 49.6 | 32.9 [31.3, 34.2] | 32.7 [29.8, 35.3] | 27.2 | +0.14 [−0.30, +0.52] |
| Breakout, any rank (= BO-wide) | 6,469 | 6.97 | 31.2 [29.5, 32.7] | 31.7 [29.1, 34.5] | 31.7 | +0.29 [−0.14, +0.68] |
| Breakout, top-50 (production) | 4,373 | 4.71 | 32.3 [30.4, 33.9] | 32.1 [29.1, 35.0] | 32.2 | +0.39 [−0.07, +0.83] |
| Breakout, outside top-50 | 2,096 | 2.26 | 28.8 [26.7, 31.3] | 31.0 [27.9, 34.2] | 30.5 | +0.07 [−0.40, +0.55] |
| Raw breakout (close > 60-session high) | 21,116 | 22.8 | 31.1 [29.6, 32.3] | 30.2 [27.9, 32.8] | 28.3 | +0.38 [−0.06, +0.78] |
| BO-raw (shadow definition) | 19,327 | 20.8 | 30.4 [29.0, 31.6] | 30.0 [27.6, 32.5] | 27.8 | +0.33 [−0.09, +0.71] |
| BO-cap10 (shadow definition) | 4,028 | 4.34 | 31.6 [29.7, 33.2] | 31.6 [28.8, 34.5] | 32.3 | +0.38 [−0.08, +0.79] |
| Breakout + continuation (E) | 6,142 | 6.62 | 30.9 [29.3, 32.5] | 31.7 [29.1, 34.5] | 31.6 | +0.30 [−0.15, +0.69] |
| Breakout, not continuation (F) | 327 | 0.35 | 35.2 [29.1, 42.5] | 31.8 [26.0, 38.6] | 32.4 | +0.18 [−0.85, +1.18] |

### 2.3 Confirmatory items (BH q = 0.10 over C1–C4; all four passed BH; one-sided p)
| Id | Test | Result (h1 unless stated) | Halves | Verdict |
|---|---|---|---|---|
| C1 | Breakouts worse in bearish sessions | **+4.0 pp** [−1.7, +9.9], p = 0.089 (examined: +16.4) | −0.1 / +10.3 | **Not replicated** (fails the first half; much smaller) |
| C2 | Bearish penalty is market-wide (all gainers) | **+2.7 pp** [−0.5, +6.3], p = 0.045 | +2.7 / +2.9 | **Replicated by the pre-declared rule, weak** (two-sided 95% interval includes 0) |
| C3 | Day change ≥ 10% worse | **+9.8 pp** [+2.4, +16.6], p = 0.004; h1 adverse 40.6% vs 30.8% | +8.4 / +11.4 | **Replicated** (strongest result; fades with h: h5 +6.1 [−0.6, +13.4]) |
| C4 | Raw breakout h10 mean X > 0 | **+0.38 pp** [−0.06, +0.78], p = 0.044 (examined: +0.99) | +0.60 / +0.17 | **Replicated by the rule, weak** (about a third of the examined size; interval includes 0) |

All horizons (adverse pp): C1 h1 +4.0, h2 +2.7, h5 +2.9, h10 +1.9 (all intervals include 0); C2 +2.7, +3.0, +4.0, +3.9;
C3 +9.8, +6.7, +6.1, +6.3; C4 mean X h1 +0.12, h2 +0.04, h5 +0.12, h10 +0.38.

### 2.4 "No difference" items (equivalence ±5 pp, 95% interval)
| Id | Contrast | h1 | h5 | Verdict |
|---|---|---|---|---|
| E1 | Top-50 minus outside-top-50 breakouts | **+3.4** [+1.1, +5.6] | +1.0 [−1.9, +3.9] | h1 **contradicted**: top-50 breakouts were slightly WORSE next day; h5 replicated |
| E2 | Breakout (close/volume conditions) minus raw breakout | +0.05 [−0.9, +1.1] | +1.5 [+0.4, +2.6] | **Replicated**: the conditions do not improve outcomes (if anything slightly worse at h2–h10) |
| E3 | Breakout minus same-day, same-size non-breakout gainers | +1.6 [+0.3, +2.9] | (+1.8) | **Replicated** within ±5 pp: a breakout adds nothing beyond the day's move (slightly worse) |
| E4 | High (≥ 3) minus low (≤ 1) evidence score, same day and move size | +0.8 [−1.1, +2.5] | (−0.8) | **Replicated**: the score has no stock-specific value holding the day constant |

### 2.5 Descriptive items
- **D1 replicated:** the consolidation flag fires on 9 of 6,469 breakouts (0.14%); it is inert.
- **D2 not replicated:** breakouts in leading sectors (sector RS ≥ 3 pp) were not worse (h1 adverse 29.5% vs 27.8–31.7%
  in other bins). Caveat: 80% of rows lack a sector index here.
- **D3 replicated: nothing is tradable after costs.** Net of 20 bps (next open → close at h), every group is negative
  at h1, h2 and h5 (e.g. production breakout h1 −0.52% [−0.64, −0.40]); at h10 means are slightly positive
  (+0.15 to +0.28%) with intervals well below zero to well above (e.g. raw breakout +0.28% [−0.34, +0.81]). No group or
  horizon has a positive lower bound.

### 2.6 Exploratory observations first seen here (NOT validated; candidates for prospective tests only)
Among the study's Exp 2 contrasts on (b), these survive FDR and both halves: very large moves relative to the stock's
own volatility (z ≥ 4) worse at h1 (+9.2 pp) and h5 (+6.1); relative volume ≥ 5× worse at h1 (+4.5); breakouts above
the 200-day average worse at h1 (+6.9); micro-cap segment worse at h1 (+3.6); high-volatility stocks (20-day σ ≥ 3.5%)
better (−12.7 / −14.5 pp); high-turnover stocks better at h1 (−7.7); an expanding range before the breakout
(consolidation ratio ≥ 1.2) better at h5 (−13.4; it was also the direction in period (a), −14.8, "suggestive" there).

### 2.7 Plain-English conclusion
- **Holds up:** (1) day moves of 10% or more are a warning sign for the next session; (2) the close-location and volume
  conditions, the evidence score and the consolidation flag add nothing measurable; (3) a breakout behaves like any
  other gainer of the same size on the same day; (4) nothing is profitable after realistic costs on average.
- **Weaker than it looked:** the bearish-regime penalty (market-wide, about +3 pp, not the +16 pp seen in 2025–26 for
  breakouts) and the raw breakout's 10-day edge (+0.4 pp, not +1.0).
- **Contradicted:** the top-50 restriction is not neutral at h1 — top-50 breakouts did slightly worse next day than
  breakouts outside the top 50 (+3.4 pp), consistent with the ≥ 10% effect (all big movers are top-50).
- **For the shadow rules:** BO-cap10 and BO-raw remove the ≥ 10% moves that consistently do worse; neither shows a
  tradable edge. These historical figures do not replace the prospective shadow evaluation.

## 3. Deviations
- Observation end: the plan says "through the last session whose h = 10 window ends on or before 2025-08-22"; the run
  ends at 2025-08-07 (= the 11th-last calendar session), which is exactly that rule. No deviation in substance.
- The study script gained an optional date range for `buildRows` and exported its existing statistics helpers
  (before any result; period (a) output byte-identical). No other deviation.
