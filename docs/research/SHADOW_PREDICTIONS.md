# Shadow predictions BO-wide, BO-raw, BO-cap10 — pre-declaration (v1)

> **Frozen before any shadow capture exists.** Written and committed 2026-11-24, before any shadow record was written
> and before any outcome of a session after 2026-11-17 was examined for these rules. Owner approval of the shadow
> capture: 2026-11-24 (`docs/PROJECT_STATUS.md` §H). Publishing the implementation needs a separate release
> recommendation and owner approval. Any later change to this document's definitions creates NEW version identifiers;
> existing shadow records are never modified, replaced or backfilled.

## 1. Purpose and status
The breakout characteristics study (`docs/research/BREAKOUT_CHARACTERISTICS.md` §2.7) proposed three candidate rules.
That study is **exploratory** (one in-sample period, 2025-08-26 → 2026-11-17). These shadow versions test the rules
**prospectively**, on sessions whose outcomes did not exist when the rules were fixed, side by side with the frozen
production benchmark `mv1-8ecef864` on the same sessions. Shadow results never change production labels, the mv1
records, the evaluation policy, `od1.json` or `holdout.json`.

## 2. Population (common to all variants)
- Session D: a session for which the production capture wrote a valid `mv1-8ecef864` prediction file.
- Market data: the same public data (`public/data`) and the same production functions the mv1 capture uses
  (`prepareUniverse`, `marketContextAt`, `moversOn`, `buildCandidate`), with the default settings.
- Candidates: every universe stock with a **positive** day change on D that `moversOn` ranks (stocks starting a
  detected price discontinuity are excluded, as in production), at **any** gainer rank (rank = position among all
  gainers by change, ties by symbol, as in `rankMovers`).
- Integrity check (fail closed): the shadow computation's gainers of rank ≤ 50 must reproduce the mv1 file's gainer
  list for D exactly (symbols, ranks, setup and evidence labels). If not, no shadow file is written for D.

## 3. Variant definitions (v1)
`label` is the mv1 setup label from `src/lib/momentum/classify.ts`; `distance` is
`patterns.resistance.distancePct` = (close / highest high of the prior 60 sessions − 1) × 100; `change` is the day
change in percent.

| Variant | Included when | Source |
|---|---|---|
| **BO-wide** | `label = possible-breakout`, any rank | §2.7 item 1: breakout conditions at any rank |
| **BO-raw** | `patterns.breakoutToday = true` (close above the prior 60-session high) AND `change < 10` AND `distance < 7` | §2.7 item 2 |
| **BO-cap10** | `label = possible-breakout` AND gainer rank ≤ 50 AND `change < 10` | §2.7 item 3 |
| *mv1 benchmark* | `label = possible-breakout` AND gainer rank ≤ 50 (the production "Possible breakout setup" list) | production |

Decisions on the open points (made here, before any capture, without new outcomes):
1. **BO-raw has no insufficient-evidence gate and no extended gate.** Reason: the study's tested group `RAW_BO`
   (`breakoutToday === true`) had neither, and the committed text names only the two exclusions. Adding gates would
   test an unexamined rule. Consequence: some BO-raw candidates may have fewer than 50 comparable bars; OD1 still
   needs a 20-session sigma, otherwise the outcome is `unavailable` (reported).
2. **BO-cap10 keeps the top-50 restriction.** "Production breakout" means the rule as deployed (top-50 gainer list);
   BO-wide already covers the any-rank question, so the three variants each change one thing: rank (wide), conditions
   (raw), the ≥ 10% cap (cap10).
3. **Boundaries:** "excluding day change ≥ 10%" means included only when `change < 10`; "≥ 7% above the old high"
   means included only when `distance < 7`. Values are used unrounded.
4. **Regime flag (§2.7 item 4):** no rule change; every result is also reported split by the market regime of D
   (bullish, sideways, bearish, insufficient-data), and bearish-regime signals are a separate, lower-quality group.

## 4. Version identifiers
`<variant>-v1-<h8>` with `<variant>` in `bo-wide`, `bo-raw`, `bo-cap10`, where `<h8>` is the first 8 hex digits of
the sha256 of the canonical JSON of `{ variant, definition (the exact text of the table row), mv1RuleVersion,
shadowRuleFileSha256 }` and `shadowRuleFileSha256` is the sha256 of `scripts/shadow/definitions.mts`. The production
rule files are covered through `mv1RuleVersion` (`computeVersion`). Any change to either changes every identifier; a
new identifier starts with no history.

## 5. Capture
- Files: `public/data/shadow/<versionId>/<D>.json`, create-only, one per variant and session, beside (never inside)
  `public/data/ledger`. Each row freezes: symbol, rank, change, the prediction-day bar (open, high, low, close), the
  frozen `volatility20`, the mv1 label and evidence category, resistance distance, and a `recordHash`; the header
  records the version, the mv1 rule version, the mv1 file's sha256 and `predictionsSha256`, the market-data file
  hashes, the generation time and the GitHub run.
- Timing: a shadow file for D is written only when the run time is at or before the cut-off of D (09:00 IST on the next
  trading session, `resolveCutoff`, the same rule as mv1). A late session is skipped, never backfilled.
- The capture step in `update-data.yml` runs after the mv1 capture with `continue-on-error`; it can never block the
  market-data update or the mv1 capture. A failure is visible as a failed step.
- First shadow session: the first session captured by the production workflow after the owner approves publication.
  Nothing before it is ever created.

## 6. Eligible sessions for evaluation
A session D counts for a variant only when ALL hold: the shadow file exists and its first-adding commit (committer
time) is at or before the cut-off of D; the mv1 session is eligible under the evaluation policy (2026-11-18 is
excluded); the integrity check of §2 passed. Every other session is listed with its reason and never evaluated.

## 7. Outcomes and metrics (frozen)
- Outcomes: the sealed OD1 definitions (`protocol/od1.json`) at h = 1, 2, 5, 10, computed with the production engine
  functions (`od1Maturity`, `evidenceFor`, `od1Outcome`; frozen sigma and prediction-day bar; any revision blocks the
  horizon). The mv1 benchmark is evaluated with the **same code on the same data** on the same eligible sessions; its
  values are cross-checked against the stored mv1 outcome records where those exist (any mismatch is reported).
- Shadow outcomes are derived on every run from the committed shadow files and the public data (not stored).
- Adverse = Failed + Reversal (OD1). Pooled over stock-days within a group.
- **Primary contrasts (9):** for each variant, variant minus mv1 on the same sessions: P1 h1 adverse share (pp),
  P2 h5 adverse share (pp), P3 h10 mean benchmark-relative return X (pp).
- Intervals: moving-block bootstrap over sessions (the same resampled sessions for both groups), block 5, 2,000
  resamples, seed 20261124; percentile intervals. p = 2 × min(P(diff ≤ 0), P(diff ≥ 0)).
- Descriptive only: h2 and all other horizon/metric pairs, confirmed share, mean R, tradable return open(t+1) →
  close(t+h) net of 10/20/40 bps, signals per session, the stock-days in a variant but not in mv1 (and vice versa),
  split by regime and by chronological half.

## 8. Checkpoints, multiplicity and promotion criteria
Checkpoints at 20, 50, 100 and 250 eligible sessions (owner-approved). At 20 and 50: report only.
**Decision looks at 100 and 250 only**, each with BH-FDR q = 0.10 over the 9 primary contrasts and 97.5% intervals
(Bonferroni over the two looks).

A variant may be **recommended for promotion** (the owner decides; nothing changes automatically) only if all hold:
1. Non-inferiority: the upper 97.5% bound of P1 and of P2 is ≤ +3 pp.
2. Superiority: at least one of its primary contrasts survives BH in the favourable direction (P1 or P2 < 0, or
   P3 > 0).
3. That contrast has the same sign in both chronological halves of the eligible sessions.
4. Not regime-only: its point estimate has the same sign in the non-bearish sessions alone.
5. It produces at least 1.0 signal per eligible session on average.
A claim of **tradability** additionally needs the net-of-20-bps tradable mean at that horizon to have a lower 97.5%
bound > 0; otherwise a promoted rule is a better descriptive signal, not a trading edge.

**Stop (harm) flag**, at any checkpoint from 50 sessions: the lower 97.5% bound of P1 or P2 is > 0 (the variant is
reliably worse than mv1) → recommend retiring it. Otherwise: continue monitoring.

Power note (stated in advance): with roughly 3–15 signals per session, 100 sessions give intervals of several
percentage points on share differences; only large differences can be detected, and "no detectable difference" is
the expected outcome for small effects. That will be reported as such, not as proof of equivalence.

## 9. What this will not do
- No threshold is tuned on shadow outcomes; no production rule changes; mv1 records are never touched.
- Shadow results are never mixed with the historical studies: (a) examined 2025-08 → 2026-11, (b) independent
  validation 2020-11 → 2025-08 (separate frozen plan), (c) this prospective shadow evaluation.
- No share is called a probability.
