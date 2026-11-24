# Breakout characteristics study (Track A, experiments 1–4)

> **Exploratory.** The historical data used here (2025-08-25 → 2026-11-17, before the live fence 2026-11-18) was already
> examined by the Phase 1B baseline. Nothing here is an untouched test. Findings can motivate new rule versions; only
> those versions' own prospective (live, shadow) sessions can validate them.

Section 1 was written and committed **before** any result of this study was computed. Results are in section 2.

## 1. Pre-declared plan (2026-11-24)

### 1.1 Questions
1. **Top-50 restriction (Exp 1).** Does requiring a breakout to be among the day's top-50 gainers help or hurt? Does it
   select stocks that are already overextended?
2. **Characteristics (Exp 2).** Which existing (and a few new, clearly marked) characteristics distinguish breakouts
   with good and bad subsequent outcomes? Are the relationships monotonic, nonlinear, unstable or absent?
3. **Score and rank (Exp 3).** Do the evidence score, its components and the daily-change rank carry predictive
   information, or do they only describe the move that already happened?
4. **Ablation (Exp 4).** What does each label condition and each continuation component contribute? Why do ~90% of
   breakouts already have continuation characteristics?

### 1.2 Data, safety and reproducibility
- Market data read with `git show` from the pinned commit `5740ac60…` (the Phase 1B baseline commit), never from the
  working tree; every observation and outcome date strictly before the fence 2026-11-18. The baseline digest
  `568512f8…5795` must still reproduce.
- Production functions unchanged (`prepareUniverse`, `moversOn`, `rankMovers`, `buildCandidate`, `marketContextAt`);
  rule version `mv1-8ecef864` asserted; `DEFAULT_SETTINGS`.
- Outcomes from the shared, frozen OD1 engine (`scripts/ledger/od1.mts`) at **h = 1, 2, 5, 10**, each reported
  separately, never pooled.

### 1.3 Populations
| Key | Definition |
|---|---|
| `Aplus` | Every eligible universe stock-day with a positive change |
| `B` | Top-50 gainers per session (production pool) |
| `BO_all` | **Every** eligible gainer whose label is `possible-breakout` (identical conditions, any rank) |
| `BO_top50` | `BO_all` with rank ≤ 50 (= Phase 1B group C) |
| `BO_out` | `BO_all` with rank > 50 |
| `RAW_BO` | Every eligible gainer that closed above its prior 60-session high (no other condition) |
| `E` / `F` | `BO_all` with / without evidence category `continuation` |

Matched baselines (same session): for every breakout, the mean outcome of non-breakout gainers in the same
**session × daily-change bucket** stratum (M1), and in the same session × change bucket × size segment (M2), and
session × change bucket × liquidity tercile (M3). The matched effect is the breakout's outcome minus its stratum's
control mean, averaged over breakouts with at least one control.

### 1.4 Metrics (per horizon h)
- OD1 shares of completed outcomes: **adverse** (Failed + Reversal), **confirmed**, and the full class distribution;
  coverage (complete ÷ (complete + unavailable)); pending reported separately.
- Directional hit rate (R_h > 0) and benchmark-relative hit rate (X_h > 0); mean and median R_h and X_h (%).
- **Tradable** (separate from the above): entry at the open of t+1, exit at the close of t+h, minus a round-trip cost;
  20 bps primary, 10 and 40 bps sensitivity. Same window validity as OD1.
- Signal frequency: stock-days, distinct sessions, per session.

### 1.5 Pre-declared feature bins
Existing features (used by mv1 today) and **NEW** research features (not in mv1):

| Feature | Bins |
|---|---|
| Relative volume (×) | <1, 1–1.5, 1.5–2, 2–3, 3–5, ≥5 |
| Daily change (%) | 0–2, 2–4, 4–6, 6–10, ≥10 |
| Close location | <0.5, 0.5–0.7, 0.7–0.8, 0.8–0.9, ≥0.9 |
| Distance above resistance (%) | 0–1, 1–2, 2–4, 4–7, ≥7 |
| Gap (%) | <0, 0–1, 1–2, 2–4, ≥4 |
| Move ÷ 20-day volatility (z) | <1.5, 1.5–2, 2–3, 3–4, ≥4 |
| Consolidation ratio (15 ÷ 60 range) | <0.6, 0.6–0.8, 0.8–1.0, 1.0–1.2, ≥1.2 |
| **NEW** Base length (sessions since the resistance high) | 1–5, 6–20, 21–40, 41–60 |
| Body share | <0.5, 0.5–0.7, 0.7–0.85, ≥0.85 |
| Upper wick share | <0.1, 0.1–0.2, 0.2–0.3, ≥0.3 |
| Delivery % (today) | <30, 30–45, 45–60, ≥60 |
| **NEW** Delivery vs its 20-day mean (pp) | <−10, −10–0, 0–10, ≥10 |
| Median turnover, prior 20 (₹ cr) | <1, 1–5, 5–25, 25–100, ≥100 |
| Sector index RS, 1 month (pp) | none, <−3, −3–0, 0–3, ≥3 |
| Industry RS, 1 month (pp) (computed in mv1, not scored) | n/a, <−3, −3–0, 0–3, ≥3 |
| Stock RS, 1 month (pp) | <0, 0–5, 5–15, 15–30, ≥30 |
| **NEW** Distance from 20-day average (%) | <3, 3–6, 6–10, 10–15, ≥15 |
| **NEW** 5-session return (%) | <5, 5–10, 10–15, 15–20, ≥20 |
| **NEW** 20-day volatility (%) | <1.5, 1.5–2.5, 2.5–3.5, ≥3.5 |
| Size segment | large, mid, small, micro, other |
| Market regime | bullish, sideways, bearish, insufficient-data |
| Flags | consolidating before, triangle before, retest, sector-wide move, above 50-day average, above 200-day average |

### 1.6 Uncertainty and multiplicity
- Stocks on one day are not independent. Intervals come from a **moving-block bootstrap over sessions** (blocks of 10
  consecutive sessions, at least the longest horizon, so overlapping windows stay together), seed 20261124, 1,000
  resamples, 95% percentile intervals. Comparisons between groups resample the same session blocks for both groups.
- Primary contrast per ordinal feature: **last bin minus first bin** (as listed); per flag: true minus false; regime:
  bearish minus (bullish + sideways); segment: micro minus (large + mid).
- Primary metrics for the multiplicity family: adverse share at h = 1 and h = 5. Benjamini–Hochberg false-discovery
  control at q = 0.10 across all Exp 2 primary contrasts × the two metrics. A bootstrap p-value is
  2 × min(P(diff ≤ 0), P(diff ≥ 0)). Everything else is descriptive.
- A finding is called **supported (exploratory)** only if it survives the FDR control **and** has the same sign in both
  chronological halves of the sessions. Otherwise: *suggestive*, *unstable* or *no evidence*.

### 1.7 What this study will not do
- No threshold is optimised and no production rule is changed. Candidate improvements become new versions, run in
  shadow mode first, with promotion criteria declared before their live evaluation.
- Survivorship: current index membership is applied to all history (no membership history in the data); delisted
  and removed stocks are missing. This biases all groups similarly but flatters absolute outcomes.
- Corporate actions: prices are unadjusted; bars that start a detected discontinuity are excluded, and windows that
  cross one are unavailable.

## 2. Results

(Added after the run; see the commit that adds this section.)
