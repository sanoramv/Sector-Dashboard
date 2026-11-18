# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-18 07:40 UTC**.

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
- Purpose: static NSE sector/industry dashboard (Vite + React on GitHub Pages; data refreshed by GitHub Actions).
- Owner objective: make **Daily Movers & Continuation → Continuation characteristics → Setup: Possible breakout setup**
  measurably more reliable, using evidence (Momentum Ledger live holdout), never trial-and-error tuning.
- Owner is not a developer: explain in plain English, recommend one next step, get approval before any mutation.

## B. Current phase
- Active phase: **Phase 0/1 close-out** — first live capture verification, then publish Phase 1B research.
- Current task: verify the first live capture (session 2026-11-18); if valid, publish research commit `c901ac2`.
- Status: **PENDING EXTERNAL EVENT** (tonight's scheduled data runs). Verification is **not permitted before
  2026-11-19 04:00 UTC**. Do not poll GitHub or schedule background checks before then.
- Last verified: 2026-11-18 07:34 UTC (local Git); GitHub last checked 2026-11-18 07:24 UTC.

## C. Last verified checkpoint
- Last completed action: Phase 1B research committed locally as `c901ac2` (4 files) after full validation.
- Validation (2026-11-18 ~07:15 UTC, on `c901ac2`'s content): research tests 30/30, ledger 282/282, app 302/302,
  app + scripts typecheck exit 0, `ledger:guard` 0 violations, rule version `mv1-8ecef864`, baseline digest
  `568512f8…5795` identical over 3 runs.
- Git: branch `main`; local HEAD = tracking-docs commit on top of `c901ac2` (see section E); `origin/main` =
  `5740ac6` at the 07:24 UTC fetch; local ahead, 0 behind at that time; working tree clean after the tracking commit.
- Live ledger at 07:24 UTC: `enabledFrom` record present; no prediction file, no receipt; `ledger-state.json` still
  `not-enabled` (expected: only a capture run rewrites it). No GitHub issues touched since 2026-11-18 00:00.

## D. Current task execution
- Objective: confirm the 2026-11-18 live prediction is captured, published before **2026-11-19 03:30 UTC**, and has a
  receipt of class `live`; then publish the Phase 1B research.
- Approved scope: read-only verification; then sync with `origin/main` (ordinary merge, no force), re-run all
  validations, push research commit `c901ac2` normally. No other changes.
- Done: activation (`5740ac6`); research commit (`c901ac2`); tracking files (this commit).
- Current step: waiting for the external event (capture runs, ~20:30–01:30 UTC; receipt by a later run).
- Remaining steps (after 04:00 UTC 19 Nov):
  1. `git fetch`; find `public/data/ledger/live/**/2026-11-18*` prediction file and its receipt on `origin/main`;
     publication commit SHA + time vs cutoff; `ledger-state.json` `enabledFrom`/`dates."2026-11-18"`; rule version;
     receipt `class`; guard run on that commit; new watchdog issues.
  2. Report CAPTURE / PUBLICATION / RECEIPT (LIVE / LATE / UNVERIFIED / PENDING) / HOLDOUT ELIGIBILITY.
  3. Gate: proceed only if capture PASS, published before cutoff, receipt LIVE, guard green, no integrity failure.
     If the receipt is pending, recheck after ~10:30 UTC 19 Nov (morning retry run). If no prediction by the cutoff,
     it is a genuine failure: investigate read-only, do not repair or backfill.
  4. Sync: `git fetch`; inspect remote commits (expect only bot data commits); `git merge origin/main` (no rebase:
     do not rewrite `c901ac2`); stop on conflicts or unexpected changes.
  5. Validate: `npx vitest run --config vitest.research.config.ts`; `npm run test:ledger`; `npm test`;
     `npm run typecheck`; `npx tsc -p tsconfig.node.json --noEmit`; `npm run ledger:guard`; rule version check;
     `npx tsx scripts/research/breakout-baseline.mts` (digest must be `568512f8…5795`).
  6. Push normally; verify files on `origin/main`, deploy + checks green (or PENDING), ledger records untouched.
- **Open owner decision:** the tracking commit sits on top of `c901ac2`, so a normal push of `main` also publishes
  it. Pushing it is not yet approved. Either get approval to include it, or push only the research (merge
  `origin/main` into a temporary branch at `c901ac2` and push that branch to `main`).
- Resume instruction: check the UTC time; if before 2026-11-19 04:00 UTC stop; otherwise run steps 1–6.

## E. Completed milestones
| What | Commit / evidence |
|---|---|
| Momentum Ledger Phase A1 (capture-only) deployed | `19c3c09`; token probe `aef4072` (run passed 2026-11-02) |
| Watchdog fix: no missing-capture alerts while disabled | `6d00270`, pushed 2026-11-03; ~30 green watchdog runs, no new false issues |
| BL1 ledger test made data-growth-proof | `7319986` |
| Ledger enabled: `mv1-8ecef864` from 2026-11-18 | `5740ac6`; guard 44249333034, deploy 44249333031, governance 44249333002 all green |
| Phase 1B reproducible breakout baseline (local only) | `c901ac2`; `docs/research/BREAKOUT_BASELINE.md` |
| Project tracking files (local only) | this commit |

## F. Pending work
| Item | State |
|---|---|
| First live capture (2026-11-18) | PENDING EXTERNAL EVENT — verify after 2026-11-19 04:00 UTC |
| Publication receipt (class `live`) | PENDING — same check; else after ~10:30 UTC 19 Nov |
| Publish Phase 1B research `c901ac2` | APPROVED, gated on the two items above |
| Phase B: governed OD1 outcome engine (immutable outcome records) | NOT STARTED — not approved |
| Breakout accuracy improvement | NOT STARTED — hypotheses H1–H3 pre-registered; test only on the live holdout after ≥ 250 completed live sessions + explicit owner authorisation |

## G. Known issues (unresolved)
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
- Read-only first-live-capture verification (not before 2026-11-19 04:00 UTC).
- Publish research commit `c901ac2` after the capture gate passes and all validations succeed (merge sync, no force).
- Creating these tracking files (local commit only; pushing them is NOT yet approved — see section D).

Not approved (each needs fresh, explicit approval):
- Production prediction-rule or scoring changes; any change to the 22 rule-version hash files or `DEFAULT_SETTINGS`.
- OD1 protocol or holdout governance changes; unblinding the holdout.
- Manual workflow dispatch; scheduling background checks; closing or editing GitHub issues.
- Backfilling, repairing or rewriting live predictions or receipts; watchdog changes; Phase B implementation.
- Force-push, history rewrite, amending pushed commits.

Standing rules: personal identity only (`Santhosh Ram V <santhoshramv@yahoo.com>`); stop and report on any failed
validation; never claim success from a green workflow alone; never use data on/after 2026-11-18 for research.

## I. Next action
After **2026-11-19 04:00 UTC**: verify the 2026-11-18 prediction file, its publication commit and time (cutoff
03:30 UTC), `ledger-state.json`, the receipt class and the guard; if all valid, ask the owner whether to include the
tracking commit, then sync, re-validate and push per section D. Before that time: do nothing on this task.

## J. References
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
