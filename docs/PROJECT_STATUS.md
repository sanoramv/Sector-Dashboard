# Project status — single handoff document

> Read this first in every session, then verify it against Git and GitHub. **Evidence beats this file**: if they
> disagree, trust the evidence and correct this file. This file records approvals; it never grants new ones.
> Times are UTC. Last updated: **2026-11-24 06:09 UTC** (pre-restart checkpoint: 8 commits approved for publication, not yet pushed; downloader paused). Handover: `docs/RESUME.md`.

## A. Project identity
- Repository: https://github.com/sanoramv/Sector-Dashboard · Production: https://sanoramv.github.io/Sector-Dashboard/
  · Local path: `/Users/santhosh/Desktop/my-projects/trade/Sector-Dashboard`.
- Purpose: **personal NSE research platform** (Vite + React on GitHub Pages; data refreshed by GitHub Actions), used
  only by the owner. Primary objective (2026-11-24): prediction accuracy, signal quality and understanding stock
  behaviour, especially **Daily Movers & Continuation → Setup: Possible breakout setup** and **Continuation
  characteristics**. Priorities: ~45% accuracy, 25% historical research, 20% live evaluation, 8% reliability, 2%
  security/governance.
- Owner is not a developer: explain in plain English, recommend one next step. Routine technical work is delegated.

## B. Current phase
- **Track A (historical research):** experiments 1–4 done (exploratory, 2025-08 → 2026-11). Next: independent
  validation on the newly downloaded 2020-11 → 2025-08 period (pre-declare first).
- **Track B (live evaluation):** continuous monitoring of `mv1-8ecef864` implemented locally (outcome engine,
  catch-up, Evaluation tab). Publication APPROVED 2026-11-24; not yet pushed.
- **Shadow predictions** BO-wide / BO-raw / BO-cap10: APPROVED 2026-11-24; not yet implemented.
- **Track C (historical data):** 5-year download paused at 2023-06-01 (resumable); 10-year expansion approved.
- Production last verified healthy 2026-11-24 04:26 UTC (EPIPE hotfix `1596276`: governance, guard, deploy green).

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

## D. (HISTORICAL) Phase B2a execution (2026-11-23 06:39–07:00 UTC)
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
- **Local commits (07:01 UTC):** `922b956` (code + tests), `a4777f2` (docs); `main` ahead of `origin/main` by 2; NOT pushed.

## D2. (HISTORICAL) B2a final release audit (2026-11-23 07:35–07:43 UTC, read-only; nothing changed in code)
- **Commits:** `922b956` (9 files: 6 new modules, outcomes.mts, guard.mts, 1 test) and `a4777f2` (3 docs) contain only
  B2a; personal identity; branch `main`, 2 ahead / 0 behind `origin/main` (`c202517`); only this file uncommitted.
- **Validation:** ledger 383/383, app 302/302, research 30/30, both typechecks, guard 0 violations (eligible 19 + 20
  Nov, excluded 18 Nov) — all exit 0; rule `mv1-8ecef864`; baseline `568512f8…5795` byte-identical; `od1.json` /
  `holdout.json` hashes unchanged; no change under `public/`, `src/`, `.github/`; 0 outcome receipts tracked.
- **Bypass tests** (scratchpad script, fabricated 2030 inputs, nothing written to the repo). BLOCKED: `planOutcomes`
  and `runOutcomePipeline` for pre-2031 dates even with a spoofed env; the pipeline under `GITHUB_ACTIONS=true` +
  public repo; store roots inside the repo (symlink, `..`, relative); sink traversal; `requireUnblinded`. NOT
  BLOCKED (findings): F1 `buildDueRecord` with a forged due item, `buildOutcomeRecord` (B1), `FsPrivateStore.putRecord`
  and `FsPublicReceiptSink.put` accept pre-2031 dates — the lock sits only at the entry points; F2 the execution-
  context check trusts the injected env (passes with the flag set and `GITHUB_ACTIONS` unset/false) — a tripwire,
  not a boundary; F3 the leak scan covers `public/` only, while anything committed anywhere in a public repo is public.
  No workflow, CLI, credential or activation exists, so none is reachable by automation.
- **Recommended hardening before push (needs approval; one small local commit):** move the synthetic lock into
  `outcomes.mts` and call it in `buildOutcomeRecord`, `buildDueRecord`, `putRecord`, `appendCorrection`, sink `put`;
  for non-synthetic dates also refuse when the REAL `process.env.GITHUB_REPOSITORY` is the public repo; extend the
  leak scan to every JSON file in the repository (skip `.git`, `node_modules`, `dist`); add bypass tests.
- **GitHub App (least privilege):** permissions cannot be path-scoped: Contents write can change any file/branch of
  the installed repo. Recommend: install only on the public repo; Contents RW + Metadata R; public `main` ruleset
  (block force-push, restrict deletions, App NOT a bypass actor); add a restrict-file-paths push rule only if GitHub
  offers it for this repo type (docs unclear; verify in settings); key only in the private repo; guard as detection.
- **Contents API (docs, not exercised):** PUT without `sha` creates; `sha` is required to update, so a missing `sha`
  on an existing file fails (treat as exists -> GET, byte-compare: identical = existing, different = hard conflict);
  parallel writes conflict (409) -> serialise, retry with backoff, then re-GET; rulesets apply to the App unless it is
  a bypass actor; commits by an App token trigger push workflows (guard/governance/deploy per receipt) — batch later.
- **Private repo:** needs GitHub Pro (personal account) for rulesets AND for environments/environment secrets in a
  private repo; owner can still edit rulesets or delete the repo (restorable for a limited period). Git history alone
  is not sufficient: keep an owner-held offline backup (`git bundle`) and consider HMAC-derived salts (secret master
  key, backed up offline) so a lost record can be recomputed from the pinned public data and still match its receipt.
- **Production (read-only 07:43 UTC):** no data run since the B1 push (weekend; next 23 Nov 14:30 UTC, PENDING);
  push runs green; watchdog 00:23 success; latest capture 20 Nov (receipt `live`); R6: 18 Nov anomaly retained
  (retention-window-only), 19/20 Nov `existing`, no new anomaly.
- **Readiness:** B2a cannot generate live outcomes through any automated path; publishing is low-risk. Recommended
  order: approve hardening -> re-validate -> push 3 commits.

## D3. (HISTORICAL) B2a security hardening (2026-11-23 09:58–10:09 UTC; owner-approved)
- **F1 fixed:** the `SYNTHETIC_ONLY` lock moved into the engine file `outcomes.mts` and is now enforced in every
  builder, store and publisher: `buildOutcomeRecord` (sessionDate + window), `buildOutcomeReceipt` /
  `receiptForStoredRecord`, `buildDueRecord`, `evidenceFor`, `planOutcomes`, `FsPrivateStore.putRecord` /
  `appendCorrection`, `correctionReceiptOf`, `FsPublicReceiptSink.put` (path must be a receipt path; content must be
  for the same session). Invalid dates are refused too. The pure OD1 maths in `od1.mts` is deliberately NOT locked
  (it is the research engine and a function of public data); docs no longer claim arbitrary computation is impossible.
- **F2 fixed:** context check is documented as a tripwire. It now refuses the public repository whenever it is named
  (any case/whitespace, any `GITHUB_ACTIONS` value), and once `SYNTHETIC_ONLY` is off an injected env is ignored in
  favour of `process.env` (`effectiveEnv`). Structural restrictions are tested: no workflow/npm script/entry script
  calls the pipeline, no App token or publisher secret referenced, no activation record or `outcomesFrom`.
- **F3 fixed:** `scanRepositoryForOutcomeLeaks` (used by the guard for the real ledger) scans every staged blob in the
  Git index plus every tracked or new non-ignored file, by content (gzip, JSON, JSONL, text), never by extension; it
  never prints matched values. Real repository: 0 findings (~0.3 s). Limitation: detection in the guard, not a
  pre-commit block; `.gitignore`d files are not scanned. Deliberately NOT added to `npm test` (that gates data updates).
- **Tests:** 9 new (ledger 383 -> 392). A mutation run with the lock disabled fails them, as expected.
- **Engine version:** `od1e-9f6e9c59` -> `od1e-2e4de377` (engine files changed; no outcome exists, nothing affected).
- **Validation (10:09 UTC):** ledger 392/392, app 302/302, research 30/30, both typechecks, guard 0 violations (19 + 20
  Nov eligible, 18 Nov excluded) — all exit 0; baseline JSON byte-identical (`568512f8…5795`); rule `mv1-8ecef864`;
  `od1.json` `916b6636…1fd8` and `holdout.json` `ea9ecc1d…6e58` unchanged; `od1.mts`, `protocol.mts`, `public/`,
  `src/`, `.github/` unchanged; 0 outcome receipts tracked; no live outcome computed. `origin/main` had not moved.

- **Push (10:10:27 UTC):** `c202517..1ebad71` (`922b956`, `a4777f2`, `1ebad71`). Runs: guard 45153649220 success;
  deploy 45153649186 success (Pages HTTP 200); **governance 45153649081 FAILURE**: unhandled `write EPIPE` at
  `outcome-receipts.mts` `gitBytes` (stdin always piped and written even for git commands that never read it; on
  Linux a fast-exiting git closes the pipe first). Not a test assertion failure; not reproducible on macOS. Data
  updates are NOT affected (`update-data.yml` gates on `npm test`, not the ledger suite); Pages deployed; the guard's
  own run passed but could hit the same race after a data update (false guard failure, no data impact).
- **Fix (10:19 UTC, LOCAL, UNCOMMITTED):** stdin is `ignore` unless there is input; EPIPE on the cat-file pipe is
  ignored (git's exit code decides). Ledger 392/392, app 302/302, both typechecks, guard 0 — all exit 0.
  Needs owner approval for a fix commit + push. (Superseded: see the hotfix entry below.)
- **EPIPE hotfix (owner-approved 2026-11-24; 04:15–04:27 UTC):**
  - Root cause confirmed: failing line was `p.stdin.end(input ?? "")` (`outcome-receipts.mts:325` at `1ebad71`) in
    `gitBytes`, called by `scanRepositoryForOutcomeLeaks` (guard -> `checkOutcomeConfidentiality`). stdin was always
    piped and written with no error handler; when git exits before consuming it, Node emits an unhandled `write EPIPE`.
    Errors came from `guard.test.ts` and the F3 test, which scan tiny temporary repos (git exits in microseconds).
    Reproduced locally: the pushed helper crashes (uncaught EPIPE) when git does not read its input; with empty input
    macOS does not raise it, Linux CI did. The scheduled guard (real repo) was exposed to the same race but passed all
    4 post-data-update runs (45307517252, 45314097203, 45319323853, 45324508711); data updates never depended on it.
  - Fix (`1596276`): stdin `ignore` unless there is input; a stdin error REJECTS (never ignored); cat-file output must
    match every staged entry (sha, size, no truncation), missing objects are violations, any cat-file failure is an
    "incomplete scan" violation. Detection rules, staged/new-file coverage and the synthetic lock unchanged.
  - Tests: +2 (ledger 392 -> 394): deterministic EPIPE reproduction now a handled rejection; 100 parallel fast git
    runs + 20 scans clean; genuine staged leak found; non-repo, corrupted object store and guard path are violations.
    Mutation (handler removed) fails the test.
  - Sync: fast-forward to `52b3b41` (4 bot data commits, `public/data/` only). Validation: ledger 394/394, app
    302/302, research 30/30, both typechecks, guard 0 (3 eligible: 19, 20, 23 Nov; 18 Nov excluded), baseline
    byte-identical, rule `mv1-8ecef864`, engine `od1e-2e4de377`, `od1.json`/`holdout.json` unchanged (sealed), 0
    outcome receipts.
  - Push 04:24:08 UTC `52b3b41..1596276`. Runs: guard 45326144033 success, deploy 45326143941 success (Pages 200),
    governance 45326144060 success.
  - Production: data runs 24 Nov 01:45, 02:39, 03:24, 04:09 UTC all success; 23 Nov captured, receipt `live`; R6:
    23 Nov `existing`; `runStatus` amber only for the known retained 18 Nov anomaly (unchanged since before B2a).
    The 23 Nov evening slots ran late (GitHub schedule delay, as on 18 Nov when the 14:30 slot ran at 22:11): the
    01:45–04:09 UTC runs on 24 Nov are those slots, and they captured 23 Nov. No run is missing.
- Post-push: `holdout.json` at `1ebad71` sha256 `ea9ecc1d…6e58` (sealed); all 8 workflows `active`; last data run
  21 Nov success; next 23 Nov 14:30 UTC PENDING.

## E. Completed milestones
| What | Commit / evidence |
|---|---|
| Momentum Ledger Phase A1 (capture-only) deployed | `19c3c09`; token probe `aef4072` (run passed 2026-11-02) |
| Ledger enabled: `mv1-8ecef864` from 2026-11-18 | `5740ac6`; guard, deploy, governance green |
| Phase 1B reproducible breakout baseline | `c901ac2`; `docs/research/BREAKOUT_BASELINE.md` |
| R6 retention-window correction | `e08e513`; merge `6ffa92a` |
| Phase B1 shared OD1 engine + outcome schema | `01a4e5c`, `c202517`; pushed 2026-11-23 06:21 UTC |
| B2a foundation + hardening (later retired) | `922b956`, `a4777f2`, `1ebad71`; pushed 2026-11-23 10:10 UTC |
| EPIPE hotfix | `1596276`; pushed 2026-11-24 04:24 UTC; governance 45326144060, guard 45326144033, deploy 45326143941 green |
| Breakout characteristics study (experiments 1–4) | `7d7abab` (plan), `51a9404` (results) — LOCAL |
| Evaluation policy: continuous monitoring | `7b1fe81` — LOCAL |
| Live outcome engine + workflow step + guard checks | `e5ba9a6` — LOCAL |
| Catch-up outcomes (19 Nov h1+h2, 20 Nov h1) | `b695f6f` — LOCAL |
| Historical reference export + Evaluation tab | `9c34a16`, `f1b0bb9` — LOCAL |
| Historical downloader + data notes | `a1b58f5` — LOCAL |

## F. Pending work (see docs/RESUME.md for the ordered checklist)
| Item | State |
|---|---|
| Publish the 8 local commits (+ pre-restart docs commit) | APPROVED 2026-11-24; do after restart with full validation |
| First scheduled outcome-processing run in production | PENDING (after the push) |
| Shadow capture BO-wide / BO-raw / BO-cap10 | APPROVED; not started |
| 5-year download 2020-11-02 → 2025-08-22 | PAUSED at 2023-06-01 (672 stock, 639 index files; resumable) |
| Data validation + independent replication on 2020-11 → 2025-08 | NOT STARTED (freeze plan first) |
| 10-year expansion (older NSE formats, 2016+) | APPROVED; not started |
| 24 Nov evening capture | PENDING — check after ~01:30 UTC 25 Nov |

## G. Known issues (unresolved)
- (Resolved) durable exclusions published `5292cf2`; gate amber since the review decision `a730339`.
- 94 false "Ledger snapshot missing" issues (pre-activation dates) are open; they never auto-close. Closing needs approval.
- Watchdog raises a false "Ledger capture is stale" every Monday (36 h threshold vs weekend gap; #95, #96 auto-closed).
- `scripts/ledger/state.mts` validates `enabledFrom` by regex shape only (lower priority; separate decision).
- 19 historical commits (incl. `19c3c09`, `6d00270`) carry an employer-domain email; history cannot be rewritten
  (force-push is blocked). Decision pending (suggested: leave history, optional `.mailmap`).
- `npm test` gates the scheduled data + live-capture commit in `update-data.yml`: never add data-dependent or slow
  tests to it. Research tests are `*.spec.ts`, run only via `vitest.research.config.ts`.
- Raw data before 2025-08-25 exists only in Git history (rolling retention); a local research copy of NSE archives
  from 2020-11 is being built in `research-data/` (not committed).
- Commit `7b1fe81` also contains the B2a module deletions (scoping slip); the tree does not build at that commit alone.
- Downloaded archives: 33 dates have a stock file but no index file (possible holiday duplicates); stock file
  2022-08-08 failed the CSV check (recorded as error, retried on resume). Investigate in the data-validation step.

## H. Owner approvals and restrictions
Approved 2026-11-24 (current):
- Option B: the live ledger is a continuously monitored prospective benchmark (policy `protocol/evaluation-policy.json`);
  `mv1-8ecef864` stays the frozen production benchmark; 250 sessions is a research milestone, not a gate; 18 Nov
  permanently excluded; outcome catch-up from 19 Nov; B2b private infrastructure cancelled.
- Publication of the 8 local commits `7d7abab 51a9404 7b1fe81 e5ba9a6 b695f6f 9c34a16 f1b0bb9 a1b58f5` (plus the
  pre-restart documentation commit) after final validation, one normal push (`7b1fe81` does not build alone: accepted).
- Continuous live outcome evaluation and the Evaluation dashboard.
- Experimental shadow capture of BO-wide, BO-raw and BO-cap10 (own versions; promotion criteria pre-declared).
- Five-year historical acquisition and research; ten-year expansion from reliable free sources.
- Routine technical decisions, implementation, testing and ordinary local commits are delegated.
- Evidence-based promotion with checkpoints at 20, 50, 100 and 250 sessions (no fixed 100-session wait).

Still needs explicit owner approval:
- Replacing or changing production Possible breakout setup / Continuation characteristics logic (mv1).
- Publishing the shadow-capture implementation (give a release recommendation first).
- Paid data services; manual workflow dispatch; closing or editing GitHub issues.
- Changing `od1.json`, `holdout.json` or the evaluation policy; backfilling or rewriting live predictions.
- Force-push, rebase, amend or any history rewrite (never).

Standing rules: personal identity only (`Santhosh Ram V <santhoshramv@yahoo.com>`); stop and report on any failed
validation; never claim success from a green workflow alone; historical development data must stay before
2026-11-18 (live data is the prospective test).

## I. Next action
**Pre-restart checkpoint (2026-11-24 06:09 UTC).** Follow `docs/RESUME.md` (section "Outstanding tasks", item 1 onwards).
Local HEAD before the pre-restart commit: `a1b58f5`; `origin/main` `1596276`; 0 behind at 06:08 UTC.

Latest validation (2026-11-24 05:35 UTC, final local state): ledger 368/368, app 306/306, research 33/33, both
typechecks, guard 0 violations, baseline byte-identical (`568512f8…5795`), rule `mv1-8ecef864`, engine
`od1e-a3dcb82a`, `od1.json` / `holdout.json` unchanged, production build OK.

Key findings (exploratory, in-sample; full detail in `docs/research/BREAKOUT_CHARACTERISTICS.md` §2): the top-50
restriction neither helps nor hurts; close/volume conditions cut signals 2.5x without better outcomes; only the
bearish-regime effect survives FDR and it is a market-wide effect; day change >= 10% is suggestive; the evidence score
mostly reflects the session; nothing is tradable at 20 bps on average.

## J. References
- **Handover: `docs/RESUME.md`** (self-contained; read first)
- Research: `docs/research/BREAKOUT_CHARACTERISTICS.md`, `docs/research/HISTORICAL_DATA.md`; policy: `docs/design/EVALUATION_POLICY.md`
- Private outcome pipeline: `docs/design/OD1_PRIVATE_PIPELINE.md`
- Ledger design: `docs/design/MOMENTUM_LEDGER_DESIGN.md`; decisions: `docs/design/MOMENTUM_LEDGER_DECISION_REVIEW.md`
- Sealed protocol: `public/data/ledger/protocol/od1.json`; holdout gate: `public/data/ledger/holdout.json`
- Activation record: `public/data/ledger/protocol/versions/mv1-8ecef864.json`
- Research baseline + hypotheses: `docs/research/BREAKOUT_BASELINE.md`; script `scripts/research/breakout-baseline.mts`
- Earlier evaluation: `NEXT_DAY_MOMENTUM.md`; user guide: `docs/USER_GUIDE.md`
- Workflows: `.github/workflows/update-data.yml` (capture), `ledger-guard.yml`, `ledger-watchdog.yml`, `ledger-governance.yml`
