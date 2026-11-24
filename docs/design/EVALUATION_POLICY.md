# Evaluation policy addendum: continuous monitoring (2026-11-24)

**Decision (owner, 2026-11-24, Option B of the strategic reset):** strict blinding of the live holdout ends. The
Momentum Ledger's live `mv1-8ecef864` predictions become a **continuously monitored prospective benchmark**.

Machine-readable record: `public/data/ledger/protocol/evaluation-policy.json`. It is under `protocol/`, so the guard
makes it create-only and immutable.

## What changes
- OD1 outcomes of eligible live sessions are computed as each horizon matures (h = 1, 2, 5, 10). They are stored
  create-only in `data/outcomes/od1/<rule version>/<date>/h<h>.json` and summarised for the dashboard in
  `public/data/evaluation/<rule version>.json`.
- **Outcomes from:** 2026-11-19. **First computed:** 2026-11-24 (catch-up). A delayed calculation is acceptable
  because the predictions were recorded prospectively; every outcome shows its prediction date, its maturity (end)
  date and its processing date.
- **2026-11-18 is permanently excluded** from official statistics (retained R6 anomaly).
- 250 completed sessions is a long-term research milestone, not a gate. Checkpoints: 5, 20, 50, 100, 250 sessions.
- The B2b private infrastructure is cancelled: no private repository, GitHub Pro, GitHub App, cross-repository
  authentication, salts, commitments or hash-only receipts. The B2a private pipeline and its synthetic-only lock are
  retired (design erratum 23).

## What does not change
- The prediction rule `mv1-8ecef864` and every existing prediction record and receipt.
- The OD1 definitions, thresholds, precedence and horizons (`protocol/od1.json`, sha256 unchanged).
- `holdout.json` stays exactly as committed (`status: sealed`, never unblinded): it is the historical record of the
  original contract. This addendum, not an edit of that file, ends the blinding.
- Corrections stay append-only; an original outcome record is never overwritten. The analytical treatment of
  corrections remains an owner decision.

## How the live data may be used from now on
- It measures how `mv1-8ecef864` actually performs, at any checkpoint, with uncertainty that accounts for same-day
  dependence.
- Because the data is now visible, it is **not an untouched test** for rules developed after 2026-11-24. A new rule gets
  its own version identifier, runs in shadow mode, and is judged only on sessions after its shadow start, against mv1
  on the same sessions. Its promotion criteria are declared before that evaluation starts.
- The pre-registered hypotheses H1–H3 (docs/research/BREAKOUT_BASELINE.md §13) are reported at each checkpoint as
  monitoring. A confirmatory reading at 250 sessions must state that interim looks occurred.
