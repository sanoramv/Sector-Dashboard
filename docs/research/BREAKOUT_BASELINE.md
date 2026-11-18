# Breakout research baseline (Phase 1B)

> **Exploratory historical research, not validated prediction accuracy.** Nothing here shows that any rule predicts
> future prices or produces a profitable trade. The only confirmatory evidence will come from the protected live
> holdout (Momentum Ledger, rule version `mv1-8ecef864`), after at least 250 completed live sessions and the owner's
> explicit authorisation to unblind.

Frozen on 2026-11-18. Reproduce with:

```
npx tsx scripts/research/breakout-baseline.mts [--out <file outside public/>.json]
npx vitest run --config vitest.research.config.ts        # research tests (synthetic data)
```

Expected result digest (sha256 of the rounded, key-sorted result): `568512f87ac1b2be62b404b88fe7ff0ddb1a2cf2e22adab11b2c3f0212a35795`.
A different digest from the same command means the inputs or the code differ; it is a new baseline, not a re-run.

## 1. Research objective

Improve the reliability of **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout
setup**. This phase only *measures* the deployed rules. No threshold, indicator, score or label was changed, and no
rule was selected.

Primary question: does a stock with both *Possible breakout setup* and *Continuation characteristics* (group E) have
better subsequent outcomes than a breakout without continuation characteristics (group F)?

## 2. Historical range

| Item | Value |
|---|---|
| Observation sessions | **302**, 2025-08-26 → 2026-11-17 (the first calendar session, 2025-08-25, has no previous close) |
| Trading calendar | NIFTY 500 sessions in the data: 303, 2025-08-25 → 2026-11-17 |
| Outcome dates | All strictly before the fence; the last session (2026-11-17) has only *pending* outcomes |
| Fence | **2026-11-18** = `enabledFrom` of `public/data/ledger/protocol/versions/mv1-8ecef864.json` (the first live-holdout session). Nothing on or after it is read or used |

## 3. Source data

Read with `git show` from one pinned commit, never from the working tree (later data commits contain live-holdout
sessions):

| File | Blob | Bytes |
|---|---|---|
| Commit | `5740ac60cb4820274db7612288d3e3b4414f226d` (activation commit; `latestMarketDate` 2026-11-17) | |
| `public/data/manifest.json` | `7af5749da274544ecaa13ae6a9f9c101862e85ef` | 3,979 |
| `public/data/index-series.json` | `c8d4f4048eacdecbc8d9210526aeeae6053a96b5` | 883,270 |
| `public/data/constituents.json` | `f49c5676672ca5dcab2e3db0a9d2232a8a1a7114` | 188,395 |
| `public/data/stocks.json` | `7013c1c497a8da60f18ae2dff0ca644959980b49` | 16,621,779 |
| `public/data/stock-activity.json` | `71ffeac7abdd42adb4299c46aaf49bde7e768078` | 5,701,420 |

The script reads `manifest.json` first and refuses to read anything else if its `latestMarketDate` is not a real date
before the fence; it then validates every date in every series (index, stock, activity) and aborts on any invalid,
missing or fenced date. It never reads prediction records, receipts, ledger state or holdout files; it reads only the
create-only version records, to confirm the fence is not later than any `enabledFrom`.

## 4. Rule version and settings

- Production rule version: **`mv1-8ecef864`**; the script aborts if the working tree hashes to anything else.
- Production functions used unchanged: `prepareUniverse`, `moversOn`, `rankMovers`, `makeBuildContext`,
  `buildCandidate` (Setup label and Evidence category), `marketContextAt` (regime), `nextSessionOutcome`,
  `computeOutcomeStats`, `clusteredMean`.
- Settings: `DEFAULT_SETTINGS` (as used by live capture, `scripts/ledger/config.mts`):
  `scoring {breadthBullishThresholdPct 50, near52wHighThresholdPct 5, relativePerformancePoints 2}`,
  `regime {minBreadthMeasuresRequired 2, breadthThresholdPct 50}`, `industry {minConstituentsForAggregate 3}`,
  `screening {resistanceLookbackSessions 60, resistanceProximityPct 3, consolidationLookbackSessions 15,
  consolidationBaselineSessions 60, consolidationContractionRatio 0.6, triangleLookbackSessions 40,
  trianglePivotSpacing 3, triangleMinPivots 2, triangleFlatSlopePctPerSession 0.03}`.
- `MOMENTUM_RULES`: strongCloseLocation 0.7, weakCloseLocation 0.3, fadeCloseLocation 0.5, reversalCloseLocation 0.6,
  volumeConfirmRvol 1.5, lightVolumeRvol 1, extendedFromSma20Pct 15, extended5dPct 20, abnormalMoveZ 3,
  sectorWideMinPeerMovePct 1, gapPct 2, minBarsForEvidence 50.
- `ASSESSMENT_RULES`: adverseWickShare 0.4, multiSessionRunPct 15, fadingParticipation 0.8, continuationMinTotal 3.
- Research parameters: top-N 50; cost 20 bps round trip; OD1 k 0.5, floor 0.20%, sigma window 20, ≥ 22 comparable
  bars; bootstrap seed 20261118, 2,000 resamples, 95% percentile interval.

## 5. Universe and populations

Universe: NIFTY 500 + NIFTY Microcap 250 as listed in the pinned `constituents.json` (755 symbols; current membership
applied to all history). A stock-day is *eligible* when the stock has a comparable bar that session (bars that start a
price discontinuity are not ranked, exactly as on the page).

| Group | Definition |
|---|---|
| A | Every eligible universe stock-day |
| A+ | Eligible stock-days with a positive day change (OD1 gainer rules apply) |
| B | Top 50 gainers per session: `rankMovers(movers, "gainer", 50)` (largest change first, ties by symbol), the page's candidate pool |
| C | B with Setup = `possible-breakout` |
| D | B with Setup = `momentum-continuation` |
| E | C with Evidence category = `continuation` |
| F | C with Evidence category ≠ `continuation` (observed: 69 `mixed`, 18 `exhaustion-reversal`) |

Plain-English rules (from the code): **Possible breakout setup** = a top-50 gainer not already labelled *Extended*
(≥ 15% above its 20-day average or ≥ 20% in 5 sessions) or *Weak momentum* (close in the lower half of the range or
relative volume < 1.0), that closed in the top 30% of the day's range on ≥ 1.5× its 20-session average volume and above
the highest intraday high of the previous 60 sessions. **Continuation characteristics** = evidence score ≥ +3 with the
close (price structure ≥ +1) and volume (+1) both confirming, and no exhaustion trigger. For a breakout, price
structure is already +2 and volume +1, so E = breakout AND (relative-strength + market + extension points) ≥ 0.

Invariants checked on every run (the run aborts otherwise): E and F partition C; C and D are disjoint; at most 50 B
rows per session; no duplicate stock-day; no observation or outcome date on or after the fence; and the legacy subset
of B equals the production `runMomentumEvaluation(topN 50)` gainer observations exactly (15,001 = 15,001; label,
category, repeat flag and return all identical).

## 6. Methodology

Three outcome families, never mixed:

1. **Legacy next session** (production `nextSessionOutcome`): close-to-close C(t+1)/C(t) − 1 (not tradable: the signal
   is known only at the close), and next open → next close, gross and net of 20 bps. Computed only when the next bar
   exists in the same comparable segment.
2. **Five-session close-to-close** R5 = C(t+5)/C(t) − 1, on windows that are complete under OD1's validity rules.
3. **OD1 outcome classes** (sealed `protocol/od1.json`), research implementation in the script:
   σ = population SD of the 20 daily % changes ending at t−1 (≥ 22 comparable bars); ε_h = max(0.5·σ·√h, 0.20);
   R_h, X_h (vs NIFTY 500), H\*, L\* over t+1…t+h; first match wins: Reversal (D∧B), Failed (D∧¬B), Confirmed (P∧E∧N),
   Partial (¬D, some of P/E/N), Sideways. *Pending* when t+h is beyond the data or on/after the fence; *unavailable*
   for insufficient-history, no-bar, discontinuity (checked in that order; within the window the first offending bar
   decides). Headline shares use completed outcomes only; unavailable and pending are reported beside them.
   **Adverse = Failed + Reversal.**

"Candidate coverage" = stock-days per session and share of the top-50 pool. "Outcome coverage" (OD1) = complete ÷
(complete + unavailable).

## 7. Results (exploratory)

Next-session figures are legacy close-to-close unless stated. Intervals are 95%, clustered two ways by session and
stock (production `clusteredMean`).

| Group | Stock-days (sessions) | Per session | t+1 up | t+1 down | t+1 mean / median | t+1 open→close gross / net | 5-session up / mean | OD1 h=1 Confirmed | **OD1 h=1 Adverse** | OD1 h=5 Confirmed | OD1 h=5 Adverse |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A all eligible | 221,431 (302) | 733 | 47.4% [45.1, 49.8] | 52.3% | +0.04% / −0.10% | −0.10% / −0.30% | – | – | – | – | – |
| A+ closed higher | 104,831 (302) | 347 | 46.7% [44.4, 49.1] | 53.0% | +0.04% / −0.13% | −0.11% / −0.31% | 46.8% / +0.19% | 24.3% [22.7, 25.9] | 30.7% [28.3, 33.2] | 26.6% | 31.5% [29.1, 34.0] |
| B top-50 gainers | 15,064 (302) | 49.9 | 46.2% [44.2, 48.3] | 53.6% | +0.08% / −0.21% | −0.22% / −0.42% | 46.3% / +0.17% | 26.4% [24.8, 27.9] | 34.1% [31.9, 36.3] | 28.3% | 33.9% [31.6, 36.1] |
| C Possible breakout | 902 (217) | 2.99 | 48.8% [45.0, 52.6] | 51.1% | +0.13% / −0.06% | −0.17% / −0.37% | 47.8% / −0.00% | 30.9% [27.6, 34.2] | 32.3% [28.5, 36.2] | 28.3% | 33.0% [28.9, 37.0] |
| D Momentum continuation | 1,831 (253) | 6.06 | 45.2% [42.1, 48.3] | 54.7% | −0.02% / −0.26% | −0.24% / −0.44% | 45.9% / +0.06% | 28.2% [25.8, 30.5] | 36.3% [33.0, 39.5] | 30.4% | 36.6% [33.4, 39.8] |
| **E breakout + continuation** | **815 (201)** | 2.70 | 49.9% [46.0, 53.7] | 50.0% | +0.19% / −0.01% | −0.14% / −0.34% | 48.3% / +0.12% | 31.4% [27.9, 34.8] | **31.0% [27.2, 34.8]** | 28.6% | 31.7% [27.7, 35.8] |
| **F breakout, no continuation** | **87 (54)** | 0.29 | 39.1% [26.9, 51.3] | 60.9% | −0.36% / −0.66% | −0.51% / −0.71% | 43.4% / −1.14% | 26.4% [15.9, 37.0] | **44.8% [32.9, 56.7]** | 25.3% | 44.6% [32.3, 56.8] |

OD1 class counts and denominators (h=1 / h=5):

| Group | Complete | Unavailable | Pending | Confirmed / Partial / Sideways / Failed / Reversal |
|---|---|---|---|---|
| A+ | 96,686 / 95,131 | 7,774 / 7,843 | 371 / 1,857 | 23,481 / 32,270 / 11,210 / 9,438 / 20,287 · 25,303 / 35,534 / 4,289 / 1,412 / 28,593 |
| B | 13,703 / 13,488 | 1,311 / 1,326 | 50 / 250 | 3,614 / 4,155 / 1,261 / 3,276 / 1,397 · 3,811 / 4,498 / 612 / 955 / 3,612 |
| C | 897 / 874 | 1 / 2 | 4 / 26 | 277 / 285 / 45 / 242 / 48 · 247 / 323 / 16 / 99 / 189 |
| D | 1,824 / 1,805 | 3 / 4 | 4 / 22 | 514 / 518 / 130 / 553 / 109 · 548 / 552 / 45 / 203 / 457 |
| E | 810 / 791 | 1 / 2 | 4 / 22 | 254 / 263 / 42 / 213 / 38 · 226 / 300 / 14 / 85 / 166 |
| F | 87 / 83 | 0 / 0 | 0 / 4 | 23 / 22 / 3 / 29 / 10 · 21 / 23 / 2 / 14 / 23 |

Unavailable reasons are almost entirely insufficient-history (A+ 7,749 at h=1; B 1,299), i.e. stocks with fewer than
22 comparable bars, concentrated early in the period; the rest are discontinuity and no-bar.

## 8. Uncertainty and comparisons

Differences (first minus second), percentage points, with a 95% percentile interval from resampling whole sessions
with replacement (seed 20261118, 2,000 resamples). Resampling sessions keeps same-day correlation between stocks.

| Comparison (n, sessions) | t+1 up | t+1 mean | t+1 open→close net | OD1 h=1 Confirmed | **OD1 h=1 Adverse** | OD1 h=5 Confirmed | OD1 h=5 Adverse |
|---|---|---|---|---|---|---|---|
| **E − F** (815 vs 87; 201 vs 54) | +10.8 [−1.2, 23.1] | +0.55 [−0.29, 1.42] | +0.37 [−0.43, 1.25] | +4.9 [−5.8, 16.1] | **−13.8 [−25.8, −1.7]** | +3.3 [−7.7, 13.4] | −12.9 [−25.9, −0.9] |
| E − C (815 vs 902) | +1.1 [−0.1, 2.3] | +0.05 [−0.03, 0.15] | +0.04 [−0.04, 0.13] | +0.5 [−0.6, 1.6] | −1.3 [−2.6, −0.2] | +0.3 [−0.7, 1.3] | −1.2 [−2.5, −0.1] |
| E − B (815 vs 15,064) | +3.7 [0.4, 7.1] | +0.11 [−0.11, 0.32] | +0.09 [−0.10, 0.28] | +5.0 [1.9, 8.2] | −3.1 [−6.4, 0.4] | +0.3 [−2.6, 3.5] | −2.1 [−5.7, 1.4] |
| E − A+ (815 vs 104,831) | +3.2 [−0.4, 6.9] | +0.14 [−0.09, 0.37] | −0.02 [−0.22, 0.18] | +7.1 [3.8, 10.4] | +0.2 [−3.5, 4.1] | +2.0 [−1.2, 5.4] | +0.2 [−3.4, 3.9] |

Stability across chronological thirds of the sessions (cuts 2026-01-21 and 2026-06-23), OD1 h=1 adverse:
B 37.5 / 30.9 / 34.7; C 34.9 / 32.0 / 31.9; E 35.0 / 30.1 / 30.7; F 33.3 (n 6) / 44.7 (n 47) / 47.1 (n 34).

**Reading:**
- F does worse than E (adverse about 14 pp higher at both horizons, interval excluding zero), consistently in the two
  thirds where F has data. F is small (87 stock-days in 54 sessions; 6 in the first third), and about 24 comparisons are
  reported, so this is weak evidence on its own.
- **Economic meaning is small.** F is 10% of breakouts (0.29 per session), so restricting to E lowers the breakout
  adverse share by only 1.3 pp (E − C). E is no less likely to be adverse than any stock that simply closed higher
  (E − A+ +0.2 pp). Its higher Confirmed share is partly mechanical (Confirmed needs a new high after a strong day).
- **Tradability:** next open → next close net of 20 bps is negative for every group, E included (−0.34%). A positive
  close-to-close rate is not a profitable trade.

## 9. Data exclusions

- Not ranked (bar starts a discontinuity): 42 suspected corporate actions, 6 unverified gap-downs, 6 missing-session
  gaps, 68 first bars (counts over all 302 sessions, both directions).
- Legacy next-session outcome missing for B: 12 discontinuity, 1 no next bar, 50 pending (2026-11-17).
- OD1: see the unavailable and pending columns in section 7. Missing outcomes are never counted as successes or failures.

## 10. Survivorship and corporate-action limitations

- **Survivorship:** current index membership (lists fetched for the pinned commit) is applied to all history; stocks
  removed or delisted during the period are missing. Industry and size segment are current, not historical.
- **Corporate actions:** prices are unadjusted. Bars that start a detected discontinuity are excluded from ranking and
  invalidate outcome windows that cross them; actions smaller than the detection thresholds (about 6:5) and dividends
  are not adjusted. Genuine ≥ 15% gap-downs are excluded together with corporate actions, which flatters the worst
  outcomes slightly.

## 11. Known weaknesses

- One market period of about 15 months (mostly bearish-to-sideways); regime groups cluster in time.
- The pinned data starts 2025-08-25 (rolling retention; older bars survive only in Git history). With the 50-bar and
  volume-baseline requirements, the first third contains few labelled breakouts (110).
- Settings in force on past dates were never recorded; today's defaults are applied throughout (they equal the live
  `mv1-8ecef864` settings).
- The OD1 code here is a **research implementation**, tested against the sealed worked examples and boundaries (30
  tests) and consistent with the design document's independent replay (top-50 gainers: Confirmed 26.4% at h=1 and
  28.3% at h=5, identical to design §15.5). It is not the governed Phase B engine and must not compute live outcomes.
- σ is measured before the event; post-event noise is larger, so absolute class shares are somewhat inflated
  (comparisons with the same-definition base rate are unaffected).
- Interval floating-point ties at exact ε boundaries are evaluated in IEEE double without rounding (the protocol
  specifies no rounding).
- Many comparisons were inspected; nothing here survives a multiplicity correction with confidence.

## 12. Comparison with previous research

| Source | Population | Possible breakout | Result |
|---|---|---|---|
| `NEXT_DAY_MOMENTUM.md` (2026-10-28) | Top-20 gainers, 292 sessions | 552 (198) | 48.7% next close higher, +0.24% mean |
| Re-run of `scripts/audit/momentum-evaluation.mts` (2026-11-18, data to 2026-11-02) | Top-20 | 545 (197) | 48.6% |
| Read-only scratch analysis (2026-11-18) | Top-50, 301 sessions | 897 (216) | 48.8%, OD1 h=1 adverse 32.3% |
| **This baseline** | **Top-50, 302 sessions** | **902 stock-days / 897 with a legacy outcome (217 / 216 sessions)** | **48.8%, OD1 h=1 adverse 32.3%** |

Every count, class count and percentage of the scratch analysis is reproduced exactly. Differences are presentational
or methodological, not in the data:
1. Stock-days now include rows whose outcome is pending or unavailable (B 15,064 vs 15,001; C 902 vs 897; E 815 vs
   810), and the session count includes 2026-11-17 (302 vs 301), as OD1's denominators require. Legacy statistics use
   the same 15,001 / 897 / 810 / 87 rows as before.
2. The bootstrap uses a documented seeded PRNG (mulberry32, seed 20261118), so its intervals differ slightly from the
   scratch run (for example E − F h=1 adverse [−25.8, −1.7] vs [−25.7, −3.4]); point estimates are identical.
3. The top-20 studies are a different population (fewer, larger movers); they are not comparable to top-50 figures.

## 13. Pre-registered hypotheses (frozen 2026-11-18, before any live outcome exists)

Confirmatory test: **only** on live-holdout records of rule version `mv1-8ecef864` with a receipt of class `live`,
after ≥ 250 completed live sessions and explicit owner authorisation. Historical results below are exploratory and
in-sample; they motivated the hypotheses and cannot confirm them.

Live cohort (fields in the daily prediction records): `group = "gainer"` with a `lists[]` entry `{list: "gainer",
rank ≤ 50}` (B); C = B with `classification.setup = "possible-breakout"`; E = C with `classification.evidence =
"continuation"`; F = C with `classification.evidence ≠ "continuation"`.
Outcome: OD1 adverse share (Failed + Reversal) ÷ completed outcomes; **h = 1 primary, h = 5 secondary**, never pooled;
unavailable and pending reported beside every share.
Test: difference in adverse share with a 95% session-bootstrap interval (resampling sessions, seed 20261118, 2,000
resamples), reported with numerators, n, sessions and coverage. A hypothesis is supported only if the interval excludes
zero in the predicted direction.

| ID | Hypothesis (prediction-time fields only) | Predicted direction | Historical, h=1 adverse (h=5) |
|---|---|---|---|
| **H1** | Market regime: C on sessions with header `market.regime = "bearish"` vs C with `market.regime ∈ {"bullish", "sideways"}`; `insufficient-data` excluded (12 historical rows) | Bearish higher | +14.4 pp [3.5, 25.0], n 142 vs 748 (+10.3 [0.2, 20.4]) |
| **H2** | Continuation evidence: F vs E | F higher | +13.8 pp [1.7, 25.8], n 87 vs 815 (+12.9 [1.0, 26.0]) |
| **H3** | Very large single-day gain: C with `price.changePct ≥ 10` vs C with `price.changePct < 10` | ≥ 10% higher | +23.6 pp [11.5, 35.6], n 57 vs 845 (+14.4 [1.7, 26.8]) |

Threshold provenance: H1 and H2 use existing categorical outputs (no threshold). H3's 10% is the pre-existing boundary
of the production `magnitudeBucket` ("10%+", `src/lib/momentum/evaluation.ts`), not tuned here; **disclosure:** this
split was among about ten inspected in the read-only exploratory pass, so its historical result is partly selected and
should be discounted.

**Unresolved (owner decisions, to be fixed before unblinding):**
1. Materiality: the minimum difference in adverse share that would justify a rule change.
2. Multiplicity: how the three tests are adjusted (Holm–Bonferroni is suggested).
3. Power: at historical rates, 250 live sessions give roughly 750 C, 70 F and 50 "≥ 10%" breakouts. H2 and H3 may be
   too small to resolve a 10–15 pp difference; the review may need to wait for more sessions.

No other hypotheses are registered. Others (gap size, distance above the old high, abnormal z-score, liquidity,
repeats) showed no clear pattern in the exploratory pass and are not tested.

## 14. Status of this document

This is **exploratory research**. It establishes a reproducible baseline of how the deployed `mv1-8ecef864` rules
behaved historically; it does not establish predictive accuracy, does not select a rule, and changes nothing in the
dashboard or the Momentum Ledger.
