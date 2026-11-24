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

## 2. Results (run 2026-11-24)

Reproduce: `npx tsx scripts/research/breakout-characteristics.mts --out <file outside public/>.json` (about 20 s;
1,000 block-bootstrap resamples). 104,831 gainer stock-days over 302 sessions (2025-08-26 → 2026-11-17). Every Phase 1B
figure reproduces exactly (for example top-50 breakouts: 902 stock-days, OD1 h1 adverse 32.3%, confirmed 30.9%), and
the ablation code reproduces every production label and evidence category (0 mismatches, checked on every run).

Intervals are 95% moving-block bootstrap intervals (blocks of 10 sessions). They are wider than Phase 1B's
session-bootstrap intervals because they also respect overlapping windows.

**Deviation from the plan (disclosed):** the pre-declared "last bin minus first bin" contrast picked extreme bins with a
single observation (`consolidating`, consolidation ratio < 0.6: n = 1), which produced meaningless "significant"
contrasts. Contrasts now skip extreme bins with fewer than 30 stock-days (`MIN_CONTRAST_N`). No other rule changed.

### 2.1 Experiment 1: the top-50 restriction

| Group | Stock-days (sessions) | Per session | h1 adverse | h1 confirmed | h5 adverse | h10 mean X (%) | h5 net 20 bps (%) |
|---|---|---|---|---|---|---|---|
| All positive-change gainers (A+) | 104,831 (302) | 347 | 30.7 [28.1, 34.0] | 24.3 | 31.5 | +0.26 | −0.15 |
| Top-50 gainers (B) | 15,064 (302) | 49.9 | 34.1 [31.7, 37.0] | 26.4 | 33.9 | +0.25 | −0.32 |
| Breakout, any rank | 1,363 (225) | 4.51 | 31.4 [27.7, 36.2] | 30.1 | 32.7 | +0.36 | −0.47 |
| Breakout, top-50 (production) | 902 (217) | 2.99 | 32.3 [28.6, 37.2] | 30.9 | 33.0 | +0.45 | −0.52 |
| Breakout, outside top-50 | 461 (153) | 1.53 | 29.6 [24.5, 36.7] | 28.7 | 32.3 | +0.17 | −0.38 |
| Close above the 60-session high, no other condition | 4,707 (241) | 15.6 | 30.0 [26.8, 33.9] | 27.3 | 31.5 | **+0.99 [0.16, 1.99]** | −0.22 |

- Top-50 minus outside: no measurable difference at any horizon (h1 adverse +2.8 pp [−3.1, +7.8]; h5 +0.7 [−5.9, +6.6];
  h10 mean X +0.28 [−0.53, +1.05]). **The restriction neither helps nor hurts; it discards a third of the breakouts.**
- Overextension: top-50 breakouts are bigger moves (median day change 5.4% vs 2.7%; move 2.6 vs 1.4 standard deviations;
  2.1% vs 1.1% above the old high; relative volume 3.1× vs 1.9×) and less liquid (median turnover ₹47 cr vs ₹79 cr).
  Within the same change bucket the two groups behave alike (2–4%: h1 adverse 35.0% vs 31.1%; 4–6%: 29.0% vs 14.3%,
  n 56). The real problem is the **≥ 10% bucket** (57 stock-days, all top-50): h1 adverse 54.4%, h5 46.4%.
- Matched baseline (same session, same change bucket): breakouts are a little more often **confirmed** at h1
  (+4.2 pp [1.5, 6.4]) and no less often adverse (−1.5 [−4.1, +0.8]); nothing at h5 or h10; matching also on size
  segment or liquidity gives the same picture. **A breakout adds little beyond "a gainer of that size on that day".**
- Tradable (next open → close at h, 20 bps): negative on average for every group at every horizon. At 10 bps the best
  case (raw breakout, h10) is +0.07%. Close-to-close and benchmark-relative figures are not tradable returns.

### 2.2 Experiment 2: individual characteristics (breakouts at any rank)

48 primary contrasts (24 features × adverse at h1 and h5), Benjamini–Hochberg q = 0.10:

| Characteristic (contrast) | h1 adverse diff (pp) | p | Verdict |
|---|---|---|---|
| **Regime: bearish vs bullish + sideways** | **+16.4 [6.9, 26.7]** (h5 +10.1 [−3.0, 20.0]) | <0.001 | **supported (exploratory)**, both halves |
| Daily change ≥ 10% vs 0–2% | +21.3 [5.7, 39.3] (h5 +15.3) | 0.006 | suggestive (fails FDR), both halves |
| Gap 2–4% vs < 0 | −11.4 [−25.1, −1.7] | 0.018 | suggestive |
| Distance from 20-day average 10–15% vs 3–6% (NEW), h5 | −10.4 [−18.9, −2.2] | 0.012 | suggestive: *more* stretched did *better* |
| Consolidation ratio ≥ 1.2 vs 0.6–0.8, h5 | −14.8 [−29.1, −1.6] | 0.028 | suggestive: *expanding* range did better |
| All others (volume, close location, wick, body, base length, delivery, turnover, sector, industry and stock RS, move size, 5-day return, volatility, segment, triangle, retest, sector-wide) | — | ≥ 0.08 | no evidence |

Shapes worth knowing (descriptive, not tested):
- **Relative volume:** flat between 1.5× and 5×; ≥ 5× slightly worse at h1 (35.7%). More volume is not better.
- **Distance above resistance:** 2–4% best (h1 27.9%, h5 27.3%); ≥ 7% bad (n = 12: 58% / 67%).
- **Gap:** breakouts that opened below the previous close were worst at h1 (39.3%); 1–4% gaps best.
- **Sector index RS ≥ 3 pp:** worse at every horizon (h1 38.7%, mean X negative). Leading sectors did not help.
- **Consolidation flag:** fires on **1 of 1,363** breakouts. A 60-session high almost never follows a range at 0.6× its
  norm, so this mv1 characteristic is inert for breakouts.
- **Close location** (0.7–1.0) and **upper wick** (< 0.3): no gradient.

**The regime effect is a market effect, not a breakout effect.** In bearish sessions every gainer group is worse (A+ h1
adverse 38.4% vs 27–29%; top-50 40.3% vs 31%), and breakouts are no worse than same-day gainers of the same size
(+1.9 pp [−4.7, +9.5]). Avoiding breakouts in bearish regimes would have avoided bad outcomes, but so would avoiding any
gainer.

### 2.3 Experiment 3: score and rank

- **Score bands (top-50 gainers):** h1 adverse falls from 37.4% (score ≤ −1) to 27.3% (≥ 5); h5 mean X rises from −0.40%
  to +0.42%.
- **Same session, same change bucket:** high score (≥ 3) minus low score (≤ 1) shrinks to −1.8 pp [−4.7, +0.7] at h1.
  Most of the gradient is **which day it was**: the market component alone spans 40.0% (−2) to 28.5% (+2). The score
  is also correlated with the completed move (Spearman 0.37 with day change, 0.34 with close location).
  - Small residual at longer horizons: h5 net +0.42% [0.07, 0.82], h10 +0.44% [0.01, 0.92]. Suggestive, outside the
    FDR family.
- **Rank:** ranks 1–10 are the worst gainers (h1 adverse 38.1%) and ranks > 100 the best (29.6%). Among breakouts, rank
  shows no pattern beyond the ≥ 10% effect.
- **Relative-strength component:** non-monotonic (−1 is worst at 38.6%, −2 is 31.9%); sign-only scoring loses
  information.
- **Verdict:** the score mostly **describes the day and the move that already happened**; its stock-specific predictive
  value, holding the day constant, is small and uncertain.

### 2.4 Experiment 4: ablation

| Variant (any rank) | Per session | h1 adverse | h1 confirmed | h5 adverse | h10 mean X |
|---|---|---|---|---|---|
| Production breakout | 4.51 | 31.4 | 30.1 | 32.7 | +0.36 |
| Without close ≥ 0.7 | 5.81 | 31.4 | 29.2 | 33.8 | +0.41 |
| Without volume ≥ 1.5× | 6.33 | 31.1 | 29.3 | 33.1 | +0.38 |
| Without the extended gate | 6.56 | 31.7 | 30.1 | **31.5** | **+0.88** |
| Without close and volume conditions | 11.4 | 30.5 | 27.1 | 33.1 | +0.60 |
| Close above the 60-session high only | 15.6 | 30.0 | 27.3 | 31.5 | +0.99 |

- Close-location and volume conditions **cut the signal 2.5× without improving outcomes**. Only confirmed at h1 drops
  slightly (30.1 → 27.1).
- Breakouts the extended gate removes did **not** do worse (h5 and h10 slightly better). The gate is not supported as a
  quality filter for breakouts.
- **Why ~90% (here 93%) are continuation:** every breakout already has price structure +2 and volume +1 (all 1,363),
  so continuation reduces to relative strength + market + extension ≥ 0.

| Continuation definition | Share continuation | F − E adverse h1 | h2 | h5 | h10 |
|---|---|---|---|---|---|
| Production (total ≥ 3) | 93% | +11.5 [−1.0, 20.7] | +14.3 [0.2, 27.0] | +13.2 [−0.4, 26.0] | +5.8 |
| Total ≥ 4 (context must be net positive) | 76% | **+12.7 [5.4, 19.9]** | +12.1 [3.7, 19.3] | +7.5 [−0.5, 15.3] | +4.4 |
| Total ≥ 5 | 50% | +7.4 [1.9, 13.4] | +4.4 | 0.0 | −3.4 |
| Relative strength removed | 74% | +17.0 [9.9, 23.0] | +13.3 | +9.1 | +5.6 |
| Market removed | 96% | −1.4 | −2.5 | +1.4 | +6.5 |
| Extension removed | 97% | +7.5 | +12.9 | +8.5 | +4.6 |

  - Removing the market component makes the split worthless; removing relative strength makes it sharper. The
    information in "continuation" is mostly the **market context** (with the regime caveat above).
  - The definitions in this table were inspected after the fact; they are hypotheses, not findings.

### 2.5 Horizons
All four horizons point the same way and grow noisier with h (intervals roughly double from h1 to h10). The ≥ 10% move
and bearish-regime effects are strongest at h1–h2. The raw breakout's benchmark-relative edge grows with h (+0.19% at h1
to +0.99% at h10). Nothing at any horizon is tradable at 20 bps on average.

### 2.6 Limitations
- One ~15-month period. Sessions in the first half have few breakouts (352 vs 1,011) because the rules need 50+ bars
  and a 60-session lookback. Regimes cluster in time (bullish 60, sideways 111, bearish 69 sessions).
- Survivorship (current membership), unadjusted prices, current industries and segments.
- Everything here was examined in-sample; "supported (exploratory)" means "worth a prospective test", nothing more.

### 2.7 Candidate rules for prospective (shadow) testing
Pre-declared here; each will get its own version identifier and be evaluated only on future sessions against mv1 on
the same sessions.

1. **BO-wide:** breakout conditions at any rank (drop the top-50 requirement).
2. **BO-raw:** close above the prior 60-session high with no close or volume condition, still excluding day change
   ≥ 10% and ≥ 7% above the old high.
3. **BO-cap10:** production breakout excluding day change ≥ 10%.
4. **Regime flag:** no rule change; report every candidate split by regime, and treat bearish-regime signals as a
   separate, lower-quality group.
