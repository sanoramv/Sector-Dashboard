# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-23 05:01 UTC** (Phase B1 checkpoint; committed locally, NOT pushed).

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
- Purpose: static NSE sector/industry dashboard (Vite + React on GitHub Pages; data refreshed by GitHub Actions).
- Owner objective: make **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout setup**
  measurably more reliable, using evidence (Momentum Ledger live holdout), never trial-and-error tuning.
- Owner is not a developer: explain in plain English, recommend one next step, get approval before any mutation.

## B. Current phase
- Active phase: **Phase B1 — OD1 engine foundation** (local only). Status: **B1 COMMITTED LOCALLY; NOT PUSHED.**
  No live outcome computed, stored or published; no workflow, storage backend or CLI added.
- Production last verified healthy 2026-11-23 04:14 UTC (section C).

## C. Last verified checkpoint
- **Production verified (2026-11-23 04:14 UTC):** 6 scheduled data runs after the release (20 Nov 10:13 → 21 Nov
  09:58 UTC) all success incl. Ledger gate (amber: reviewed); 18 Nov `existing/retention-window-only` observations,
  anomaly retained; 20 Nov: 126 predictions, `3b1ffae` push 21:54:13Z, receipt `fd80e1f` `live`, R6 identical, R10 pass;
  guard 0 violations, eligible 19 + 20 Nov, excluded 18 Nov. #98 = Monday stale false alarm. Holdout sealed.
- **Release 2026-11-20 06:37 UTC:** `5292cf2`, `a730339`, `fec3be4` pushed (guard 44689101363, deploy 44689101365,
  governance 44689101403 success).
- **Push 2026-11-20 05:10 UTC:** `0e86cce..fcb35a6` (normal fast-forward); governance 44679121033, guard 44679121090,
  deploy 44679121031 all success; Pages HTTP 200. **05:45 review (read-only):** red runs fail only at the final
  `Ledger gate` step (unreviewed 18 Nov anomaly); a state reset could restore 18 Nov (fixed by `5292cf2`).
- **Timestamp corrections (verified from Git commit times):** committed status files were stamped later than they
  were written: `9c11ba8` says 07:40, committed 2026-11-18 07:34:56Z; `fcb35a6` says 05:15, committed 2026-11-20
  05:08:57Z; `fec3be4` says 06:20 (validation "~06:15"), committed 06:01:53Z (validation ran ~05:55). Review record
  `recordedAt` 06:00:00Z: file created 05:50:34Z, committed 06:01:53Z. Stamps are now taken from `date -u`.
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
- **Sync (04:45 UTC):** fast-forward to `origin/main` `1a788b0` (6 bot data commits; data files + ledger-state only).
- **Frozen OD1 contract (verified, unchanged):** k 0.5, floor 0.20%, eps = max(k*sigma*sqrt h, floor); sigma = population
  SD of the 20 % changes ending t-1, >= 22 comparable bars, source = frozen `volatility20`; first match wins
  reversal (D&B) > failed (D) > confirmed (P&E&N) > partial > sideways; P `R>=eps`, D `R<=-eps`, E `X>0`, N `H*>H_t`,
  B `L*<L_t` (losers mirrored); flags abnormalGap >= 3 sigma, volWindowOutlier >= 3.5 sigma (descriptive);
  unavailable = insufficient-history / no-bar / discontinuity; pending until t+h passed and archives ok; horizons
  stored 1,2,5,10, headline 1,5; completed live session = h1 + h5 outcomes for every prediction, none pending, no
  anomaly; >= 250 sessions; analysis forbidden while sealed. h=1/h=5-first does not conflict (engine supports all
  stored horizons; B1 writes nothing; deferring 2/10 is a B2 decision).
- **B1 implementation:** `scripts/ledger/od1.mts` (shared pure engine: constants from `OD1_DEFINITIONS`,
  `od1Classify`, `od1Measure` with SUPPLIED sigma, `od1Outcome`, `od1Maturity`); `scripts/ledger/outcomes.mts`
  (private record builder + validator with re-derivation from stored inputs, salted public receipt + strict
  whitelist validator, append-only correction chain, create-only decision, private-storage and seal guards, engine
  version `od1e-<8 hex>`); research script now imports the shared engine; `tests/ledger/od1-engine.test.ts` (28);
  design erratum 21.
- **Validation (~04:50–05:01 UTC):** ledger 353/353, app 302/302, research 30/30, app + scripts typecheck, guard 0
  violations (eligible 19 + 20 Nov, excluded 18 Nov, 1 review) — all exit 0; rule `mv1-8ecef864`; baseline digest
  `568512f8…5795` and full JSON identical before/after; no change under `public/`, `src/`, `.github/`.

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
| R6 review decision for 18 Nov | PUBLISHED (`a730339`); amber gate PENDING first scheduled run |
| Durable exclusion guard + pre-commit rule | PUBLISHED (`5292cf2`); CI guard green |
| 18 Nov holdout eligibility | EXCLUDED permanently (owner decision 2026-11-20; no restoration mechanism) |
| 19 Nov holdout eligibility | ELIGIBLE so far; stays eligible if the fix is live before tonight's first run |
| Phase B: governed OD1 outcome engine (immutable outcome records) | NOT STARTED — not approved |
| Phase B owner decisions | DECIDED 2026-11-23 (private storage, h1/h5 first, hash-only receipts, append-only corrections, counting unchanged). OPEN for B2: storage backend + access control; when h2/h10 are produced; where public receipts live; correction analysis policy |
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
Owner reviews B1 (local commits) and decides B2 prerequisites: the access-controlled storage backend outside the
public repo (and who can read it), the public receipt location, and h2/h10 timing. B1 may be pushed only with
separate approval. Routine: check the 23 Nov evening capture after ~01:30 UTC 24 Nov (#98 should auto-close).

## J. References
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
