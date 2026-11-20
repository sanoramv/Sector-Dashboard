# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-20 05:15 UTC** (written for the checkpoint commit of the controlled push).

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
- Purpose: static NSE sector/industry dashboard (Vite + React on GitHub Pages; data refreshed by GitHub Actions).
- Owner objective: make **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout setup**
  measurably more reliable, using evidence (Momentum Ledger live holdout), never trial-and-error tuning.
- Owner is not a developer: explain in plain English, recommend one next step, get approval before any mutation.

## B. Current phase
- Active phase: **Phase 0/1 close-out — controlled release.** R6 correction audited and committed; synced with
  `origin/main`; full validation green. This checkpoint is committed and pushed together with `c901ac2`, `9c11ba8`,
  the R6 fix and the merge (owner approval 2026-11-20). Post-push verification: see section I.
- Last verified: 2026-11-20 05:10 UTC (local, after merging `origin/main` = `0e86cce`).

## C. Last verified checkpoint
- **Live capture (verified 2026-11-20):** 2026-11-18 prediction (126 rows) published by `9cde568` at 2026-11-18
  22:11:34 UTC (cutoff 2026-11-19 03:30) — on time; receipt `f9c6653` class `live`. 2026-11-19 (123 rows):
  `9e89a3d`, receipt `1b63cbd`, `live`. Rule `mv1-8ecef864`. Issue #97 (R6 anomaly 18 Nov) open, untouched.
- **R6 false positive** (root cause): rolling retention prunes bars > 450 days on every refresh; R6 re-evaluated on
  pruned data, so only `quality.barsUsed`/`usableFrom` (+`recordHash`) changed (102/126 rows). Investigated read-only.
- **R6 correction `e08e513`** (capture.mts `checkRetentionOnly`, state.mts reason codes, 25 tests in
  `tests/ledger/r6-retention.test.ts`, design erratum 19). Final audit: every `recordHash` checked against its
  contract on BOTH sides inside the check, both full digests verified inside the check, all other fields strictly
  compared; 50-event cap never drops the first anomaly (70-run simulation: 18 Nov and an anomalous 19 Nov stay
  excluded); R10 revision → anomaly; lookback loss → uncompared; constituent refresh unchanged.
- **Sync:** merge commit `6ffa92a` (ordinary merge of 10 bot data commits `38c5c0e`..`0e86cce`, no conflicts;
  `public/` identical to `origin/main`).
- **Validation on `6ffa92a` + this file:** ledger 306/306, app 302/302, research 30/30, app + scripts typecheck,
  `ledger:guard` 0 violations (1 eligible: 19 Nov; 1 excluded: 18 Nov) — all exit 0; rule version `mv1-8ecef864`;
  baseline digest `568512f8…5795` reproduced; dry-run capture on real data: 18 Nov `existing/retention-window-only`,
  19 Nov identical digest, R10 pass, nothing written.

## D. Current task execution
- Objective: publish `c901ac2` + `9c11ba8` + `e08e513` + merge `6ffa92a` + this checkpoint with a normal push.
- Remaining: verify on GitHub — commits on `origin/main`; Ledger governance tests, Ledger immutability guard, Build
  and deploy to GitHub Pages green (or PENDING); guard 0 violations; 18 Nov still excluded. Then, after tonight's
  first capture (~22:00 UTC 20 Nov): 19 Nov should record `existing/retention-window-only` (not an anomaly) and the
  20 Nov capture should succeed.

## E. Completed milestones
| What | Commit / evidence |
|---|---|
| Momentum Ledger Phase A1 (capture-only) deployed | `19c3c09`; token probe `aef4072` (run passed 2026-11-02) |
| Watchdog fix: no missing-capture alerts while disabled | `6d00270`, pushed 2026-11-03 |
| BL1 ledger test made data-growth-proof | `7319986` |
| Ledger enabled: `mv1-8ecef864` from 2026-11-18 | `5740ac6`; guard, deploy, governance green |
| First live captures 18 + 19 Nov, receipts `live` | `9cde568`/`f9c6653`; `9e89a3d`/`1b63cbd` |
| Phase 1B reproducible breakout baseline | `c901ac2`; `docs/research/BREAKOUT_BASELINE.md` |
| Project tracking files | `9c11ba8` |
| R6 retention-window correction | `e08e513`; merge `6ffa92a` |

## F. Pending work
| Item | State |
|---|---|
| Post-push verification (section D) | PENDING |
| 18 Nov holdout eligibility | EXCLUDED permanently (owner decision 2026-11-20; no restoration mechanism) |
| 19 Nov holdout eligibility | ELIGIBLE so far; stays eligible if the fix is live before tonight's first run |
| Phase B: governed OD1 outcome engine (immutable outcome records) | NOT STARTED — not approved |
| Breakout accuracy improvement | NOT STARTED — H1–H3 pre-registered; live holdout only, after ≥ 250 completed live sessions + explicit owner authorisation |

## G. Known issues (unresolved)
- **Holdout exclusions live in the MUTABLE `ledger-state.json`** (`computeLiveHoldout` reads `status`/`r6Events`).
  A reset or hand-edit of that file that passes `validateState` would drop the 18 Nov exclusion; within the 10-session
  R6 window the corrected R6 would then not re-flag it. Pre-existing design gap (also true without the fix once a
  date leaves the window). Proposed correction (needs approval): a create-only, guard-protected exclusion record
  (e.g. `exemptions/`-style `r6-anomaly-<date>.json`) written on the first anomaly, or a guard rule deriving
  exclusions from the Git history of `ledger-state.json`.
- Update-data runs since 19 Nov 22:20 conclude `failure` because of the 18 Nov anomaly (data still committed); the
  final gate stays red until an R6 review decision is recorded for 18 Nov (owner decision; does not restore it).
- 94 false "Ledger snapshot missing" issues (pre-activation dates) are open; they never auto-close. Closing needs approval.
- Watchdog raises a false "Ledger capture is stale" every Monday (36 h threshold vs weekend gap; #95, #96 auto-closed).
- `scripts/ledger/state.mts` validates `enabledFrom` by regex shape only (lower priority; separate decision).
- 19 historical commits (incl. `19c3c09`, `6d00270`) carry an employer-domain email; history cannot be rewritten
  (force-push is blocked). Decision pending (suggested: leave history, optional `.mailmap`).
- `npm test` gates the scheduled data + live-capture commit in `update-data.yml`: never add data-dependent or slow
  tests to it. Research tests are `*.spec.ts`, run only via `vitest.research.config.ts`.
- Raw data before 2025-08-25 exists only in Git history (rolling retention); archiving not done.

## H. Owner approvals and restrictions
Approved now (scope exactly as stated):
- Read-only verification at any time.
- 2026-11-20: final R6 audit, local commit of the correction, ordinary merge sync, and ONE controlled normal push of
  `c901ac2`, `9c11ba8`, the R6 correction, the merge and this checkpoint — only after all gates pass.

Not approved (each needs fresh, explicit approval):
- Production prediction-rule or scoring changes; any change to the 22 rule-version hash files or `DEFAULT_SETTINGS`.
- OD1 protocol or holdout governance changes; unblinding the holdout.
- Manual workflow dispatch; scheduling background checks; closing or editing GitHub issues.
- Backfilling, repairing or rewriting live predictions or receipts; watchdog changes; Phase B implementation.
- Force-push, history rewrite, amending pushed commits.

Standing rules: personal identity only (`Santhosh Ram V <santhoshramv@yahoo.com>`); stop and report on any failed
validation; never claim success from a green workflow alone; never use data on/after 2026-11-18 for research.

## I. Next action
Verify the push on GitHub (section D). Do not create another push just to record green workflows. Then propose the
next task for approval (recommended: Phase B design review — governed OD1 outcome engine, read-only first; and the
create-only exclusion record from section G). Do not close #97 or touch ledger data.

## J. References
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
