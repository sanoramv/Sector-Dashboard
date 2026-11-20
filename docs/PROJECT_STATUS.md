# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-20 06:20 UTC** (durable-exclusion checkpoint; committed locally, NOT pushed).

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
- Purpose: static NSE sector/industry dashboard (Vite + React on GitHub Pages; data refreshed by GitHub Actions).
- Owner objective: make **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout setup**
  measurably more reliable, using evidence (Momentum Ledger live holdout), never trial-and-error tuning.
- Owner is not a developer: explain in plain English, recommend one next step, get approval before any mutation.

## B. Current phase
- Active phase: **governance hardening** after the R6 correction (live on `origin/main` since `fcb35a6`).
- Status: **LOCAL COMMITS READY, PUSH NOT APPROVED.** Durable holdout exclusions (guard + pre-commit, erratum 20) and
  the owner-approved R6 review decision for 18 Nov are committed locally (see section D); all validations pass.
- Production R6 not yet observed: no scheduled data run since the push (checked 05:45 UTC 20 Nov) → PENDING.

## C. Last verified checkpoint
- **Push 2026-11-20 05:10 UTC:** `0e86cce..fcb35a6` (normal fast-forward); governance 44679121033, guard 44679121090,
  deploy 44679121031 all success; Pages HTTP 200. **05:45 review (read-only):** red runs fail only at the final
  `Ledger gate` step (unreviewed 18 Nov anomaly); a state reset could restore 18 Nov (fixed locally, section D).
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
- **Durable exclusions (local commit):** `scripts/ledger/guard.mts` (`loadExclusionHistory`, `compareWithExclusionHistory`,
  `checkExclusionHistory`, `GuardGit.isShallow`, history-based reason in `computeLiveHoldout`, guard git calls with
  `GIT_NO_REPLACE_OBJECTS=1`), `scripts/ledger/precommit.mts` (same comparison for a pending state), new
  `tests/ledger/durable-exclusion.test.ts` (19 tests), stubs updated in `r6-retention.test.ts` / `recovery.test.ts`,
  design erratum 20. Reads all 68 committed state versions (all valid); real history: 2026-11-18 anomalous since
  `9e89a3d`. Fails closed on shallow/grafted/missing/invalid/truncated history (no session eligible).
- **R6 review decision (local commit):** `public/data/ledger/exemptions/r6-review-2026-11-18-mv1-8ecef864-601c4d671603.json`
  binding `ac454375…` (stored) / `601c4d67…` (recomputed); validated by the guard's loader; gate simulation exit 0
  (amber); 18 Nov still excluded (two reasons: R6 anomaly + permanent history exclusion).
- **Validation (2026-11-20 ~06:15 UTC):** ledger 325/325, app 302/302, research 30/30, app + scripts typecheck,
  `ledger:guard` 0 violations (1 eligible 19 Nov, 1 excluded 18 Nov, 1 R6 review) — all exit 0; rule version
  `mv1-8ecef864`; baseline digest `568512f8…5795`; no change under `live/`, `protocol/`, `holdout.json`,
  `ledger-state.json`, `src/`, `.github/`.

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
| Push + post-push verification | DONE (`fcb35a6`, all three workflows green) |
| First production run of corrected R6 | PENDING — morning retry run (~09:30–10:30 UTC 20 Nov); check after ~11:00 UTC |
| 20 Nov capture + receipt | PENDING — evening runs ~22:00 UTC 20 Nov; check after ~01:30 UTC 21 Nov (cutoff 2026-11-23 03:30 UTC) |
| R6 review decision for 18 Nov (turns gate amber) | CREATED + COMMITTED LOCALLY — push needs approval |
| Durable exclusion guard + pre-commit rule | IMPLEMENTED + COMMITTED LOCALLY — push needs approval |
| 18 Nov holdout eligibility | EXCLUDED permanently (owner decision 2026-11-20; no restoration mechanism) |
| 19 Nov holdout eligibility | ELIGIBLE so far; stays eligible if the fix is live before tonight's first run |
| Phase B: governed OD1 outcome engine (immutable outcome records) | NOT STARTED — not approved |
| Breakout accuracy improvement | NOT STARTED — H1–H3 pre-registered; live holdout only, after ≥ 250 completed live sessions + explicit owner authorisation |

## G. Known issues (unresolved)
- Holdout exclusions previously depended on the mutable `ledger-state.json` alone — FIXED locally (erratum 20), not
  yet pushed. Until pushed, a reset on `main` could still restore 18 Nov.
- Update-data runs since 19 Nov 22:20 conclude `failure` (only the final `Ledger gate` step; data still committed)
  because of the unreviewed 18 Nov anomaly. The local review decision makes it amber once pushed.
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
1. Owner approves (or not) a normal push of the local commits (durable exclusions, R6 review decision, this
   checkpoint): `git fetch` → ordinary `git merge origin/main` if needed → full re-validation → push → verify
   governance tests, guard, deploy, and that the next data run's gate is amber, not red.
2. Read-only checks still due: first production run of corrected R6 (morning run, check after ~11:00 UTC 20 Nov);
   20 Nov capture + receipt (check after ~01:30 UTC 21 Nov). Phase B: not started, not approved.

## J. References
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
