# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-23 07:00 UTC** (Phase B2a implemented and validated locally; local commits, NOT pushed).

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
- Purpose: static NSE sector/industry dashboard (Vite + React on GitHub Pages; data refreshed by GitHub Actions).
- Owner objective: make **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout setup**
  measurably more reliable, using evidence (Momentum Ledger live holdout), never trial-and-error tuning.
- Owner is not a developer: explain in plain English, recommend one next step, get approval before any mutation.

## B. Current phase
- Phase B1 (OD1 engine foundation): **PUBLISHED** 2026-11-23 06:21 UTC (`1a788b0..c202517`).
- Active phase: **Phase B2a — private outcome pipeline foundation** (LOCAL, synthetic-only; section D). Status:
  implemented + validated; committed locally, NOT pushed. Nothing provisioned: no private repository, GitHub App,
  token, secret, workflow, CLI or activation record. No live outcome computed, stored or published.
- Production last verified healthy 2026-11-23 06:23 UTC (section C).

## C. Last verified checkpoint
- **B1 publication (2026-11-23):** pre-push audit 06:15 UTC: `01a4e5c` = 4 audited files (od1.mts, outcomes.mts,
  research script, od1-engine test), `c202517` = 2 docs files; author/committer personal identity; no change under
  `public/`, `src/`, `.github/`; no outcome file anywhere; `od1.json` sha256 `916b6636…1fd8` and `holdout.json`
  `ea9ecc1d…6e58` unchanged; tree clean; `origin/main` had not moved (0 behind). Validation: ledger 353/353, app
  302/302, research 30/30, app + scripts typecheck, guard 0 violations (eligible 19 + 20 Nov, excluded 18 Nov, 1
  review) — all exit 0; rule `mv1-8ecef864` (computeVersion); baseline digest `568512f8…5795`, JSON byte-identical.
  Normal push 06:21:25 UTC `1a788b0..c202517`. Push runs: guard 45123546567 success, deploy 45123546516 success,
  governance 45123546481 success (06:23:14Z); Pages HTTP 200. All 8 workflows `active`. Scheduled data update:
  last runs 21 Nov success; next scheduled 23 Nov 14:30 UTC — PENDING (first run on the B1 code).
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

## D. Current task execution — Phase B2a (2026-11-23 06:39–07:00 UTC)
- **Architecture (owner decisions 2026-11-23, supersedes the earlier "push model" design):** a separate PRIVATE
  repository will compute outcomes, store records, validate, hold corrections and (later) evaluation; the PUBLIC
  repository keeps capture, prediction receipts, market data, public outcome receipts and the guard. The private
  workflow reads public data anonymously (pinned SHA), writes its records with its own `GITHUB_TOKEN`, keeps alerts
  as private-repo issues, and publishes receipts with a GitHub App installed ONLY on the public repo (`contents:
  write`) via the create-only Contents API. No credential that can read the private repo exists anywhere public.
  Full design + provisioning list + disabled example workflow: `docs/design/OD1_PRIVATE_PIPELINE.md`; erratum 22.
- **Code (all new unless noted):** `scripts/ledger/outcome-runner.mts` (pure planner/builder; h 1,2,5,10, headline 1,5;
  NIFTY 500 calendar maturity; frozen volatility20; rejects excluded / non-live / pre-activation; `SYNTHETIC_ONLY`
  refuses dates < 2031), `private-store.mts` (create-only, append-only corrections, recovery), `safe-path.mts`
  (traversal/symlink refusal), `outcome-receipts.mts` (receipt writer, leak check, tree validation, correction
  receipts, public leak scan), `outcome-pipeline.mts` (context guard, ordering, reconcile, alerts),
  `outcome-inputs.mts` (published-format loaders, refuse real data); changed: `outcomes.mts` (ENGINE_FILES + runner +
  validation.ts; `DailyLike` exported), `guard.mts` (violation kind `outcome`: receipt tree + leak scan of `public/`,
  receipts for non-eligible sessions). Engine version now `od1e-9f6e9c59`.
- **Validation (06:54–07:00 UTC):** ledger 383/383 (353 + 30 new in `tests/ledger/outcome-pipeline.test.ts`), app
  302/302, research 30/30, app + scripts typecheck (first app run caught 2 test-file type errors; fixed, re-run 0),
  guard 0 violations (eligible 19 + 20 Nov, excluded 18 Nov) — all exit 0; rule `mv1-8ecef864`; baseline digest
  `568512f8…5795`, JSON byte-identical; `od1.json` / `holdout.json` hashes unchanged; no change under `public/`,
  `src/`, `.github/`. Mutation check: disabling the stop-on-conflicting-evidence line fails test (3).
- **No live data:** tests use synthetic 2031 fixtures in temp dirs; loaders refuse real dates before reading and the
  repo's `public/data`; the only real files read are public ones by the guard/leak scan (text markers) and
  `holdout.json`. No outcome was computed for any real session.
- **Security assumptions:** OD1 outcomes are derivable from public data — the seal protects the process (nothing
  published/analysed before unblinding); salts are 256-bit from crypto randomness (B2b); the App can write any public
  path (mitigated by the add-only guard, receipt validation and main protection); private-repo branch protection needs
  GitHub Pro; the private repo's Actions and its owner account are trusted.
- **Storage estimate:** ~1 MB raw / ~190 KB compressed per session (4 horizons); ~50 MB in Git per 250 sessions.

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
| Phase B1 shared OD1 engine + outcome schema | `01a4e5c`, `c202517`; pushed 2026-11-23 06:21 UTC, all checks green |

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
| Phase B1: shared OD1 engine + outcome schema | PUBLISHED `c202517` (2026-11-23 06:21 UTC) |
| Phase B2a: private pipeline foundation (local, synthetic) | DONE, committed locally, NOT pushed |
| Phase B2b: provisioning + activation | NOT APPROVED (needs private repo, GitHub App, activation record, `SYNTHETIC_ONLY` off) |
| First scheduled data run on B1 code | PENDING — 23 Nov 14:30 UTC; check after ~15:30 UTC |
| Phase B owner decisions | DECIDED 2026-11-23: private repo owns calculation/records; GitHub App; h1,2,5,10 (headline 1,5); receipts under `live/outcome-receipts/`; excluded sessions not processed; 19 Nov+ catch-up only with later approval; corrections append-only, originals authoritative; issues without outcome info. OPEN for B2b: GitHub Pro; repo/App names; activation date; catch-up; correction analysis policy; public vs private alert issues |
| Breakout accuracy improvement | NOT STARTED — H1–H3 pre-registered; live holdout only, after ≥ 250 completed live sessions + explicit owner authorisation |

## G. Known issues (unresolved)
- (Resolved) durable exclusions published `5292cf2`; gate amber since the review decision `a730339`.
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
  `c901ac2`, `9c11ba8`, the R6 correction, the merge and this checkpoint — only after all gates pass. (Used.)
- 2026-11-23: push of B1 `01a4e5c` + `c202517` (USED 06:21 UTC); read-only B2 architecture/security design (done).
- 2026-11-23: Phase B2a LOCAL implementation + local commits after full validation (done). NOT approved: push,
  workflow dispatch, issue changes, private repo, App, credentials, secrets, infrastructure, live outcomes.

Not approved (each needs fresh, explicit approval):
- Production prediction-rule or scoring changes; any change to the 22 rule-version hash files or `DEFAULT_SETTINGS`.
- OD1 protocol or holdout governance changes; unblinding the holdout.
- Manual workflow dispatch; scheduling background checks; closing or editing GitHub issues.
- Backfilling, repairing or rewriting live predictions or receipts; watchdog changes; Phase B implementation.
- Force-push, history rewrite, amending pushed commits.

Standing rules: personal identity only (`Santhosh Ram V <santhoshramv@yahoo.com>`); stop and report on any failed
validation; never claim success from a green workflow alone; never use data on/after 2026-11-18 for research.

## I. Next action
Owner reviews B2a (local commits) and decides: (1) push B2a; (2) B2b provisioning (GitHub Pro, private repo + App per
`OD1_PRIVATE_PIPELINE.md` §5 — owner-performed); (3) activation date and any 19 Nov+ catch-up. Routine: verify the
23 Nov 14:30 UTC data run (first on B1 code) after ~15:30 UTC and the evening capture after ~01:30 UTC 24 Nov.

## J. References
- Private outcome pipeline: `docs/design/OD1_PRIVATE_PIPELINE.md`
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
