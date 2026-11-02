# Momentum Prediction Ledger — Design (Revision 4, A1-ready candidate)

**Status:** B1–B6 are resolved in this revision (§1.3). The A1 readiness checklist ([§19](#19-final-a1-readiness-checklist)) has **no blocked item**. Two things still stand between this document and a running A1: (i) your acceptance of the six resolutions and of the choices listed in [§20.2](#202-choices-i-made-within-your-delegated-scope), and (ii) one repository setting only you can change ([§20.3](#203-repository-settings-you-must-change-manually)). No application code, scoring or classification logic, tests, workflows, market data or ledger records were changed. This file is the only file this task modified.

## Post-audit errata (corrective round after the independent A1 audit)

These clarifications supersede the text they reference. They change no approved threshold or semantics.

1. **R6 compares canonical prediction digests, not whole-file bytes (§9.3, §10.1).** The phrase "different bytes" was ambiguous: every execution produces a different `generatedAt`, `runtime` and GitHub run metadata, so a literal byte comparison would flag every duplicate run. R6 compares `header.predictionsSha256` (the canonical digest of the predictions array). Behaviour: no existing file -> R6 passes and is part of the new record's own readiness report; existing valid file with an identical digest -> *existing*, nothing written; existing valid file with a different digest -> **anomaly**; existing file unreadable, truncated or invalid -> **anomaly**; an existing valid file for which a fresh candidate cannot be built now (for example a source archive is no longer ok) is left untouched and reported as *existing-uncompared*. A duplicate attempt always evaluates the candidate; it never short-circuits on file existence. The result of an existing-file check is recorded in the **mutable** `ledger-state.json` (`dates.<date>.r6`), never in the immutable daily record. **Constituent-list refresh (final corrective round):** the candidate is built from the *current* constituent lists, so after a reconstitution an old session's fresh digest legitimately differs. The record stores the identity (size, content hash, fetch time) of each list it used. If the lists' **content** changed since the record was made and the digests differ, the result is `existing-uncompared` with reason `constituent-lists-refreshed` (old and new identities recorded), never an anomaly, and it is **never counted as a successful comparison**; it stays `existing-uncompared` on every later run until the lists again match the record. A change of fetch time alone (identical contents) does not excuse a mismatch. R6 evidence is append-only: `dates.<date>.r6` is the latest result, `dates.<date>.r6Events` keeps each change of result (the first anomaly is never dropped), and while an earlier anomaly is unresolved `r6` keeps the anomaly and later results are recorded as `latestObservation`. A persistent `inputs-not-ready` inability to compare is counted (`uncomparedRuns`) and becomes a warning after 12 consecutive runs. A date in `anomaly` status makes the run status and the final gate fail until a decision is recorded; how an R6 anomaly is closed is **not defined in A1** and is an open design decision.
2. **R2 wording (§10.1).** The 20 tracked index series *include* NIFTY 500 (NIFTY 500, NIFTY 50, 15 sectoral indices, Midcap 150, Smallcap 250, Microcap 250 = 20). The check requires a bar for each of those 20 series, not for NIFTY 500 plus 20 others.
3. **Activation date (§5.4, §20).** A1 permits enabling a rule version only from the next eligible, not-yet-captured session after the latest published market date; there is no override. `ledger:enable` also refuses (a) if any existing version record is invalid, (b) if the local checkout is behind `origin/main` (it runs `git fetch`), (c) if sessions that were due by the clock are absent from the local data, and (d) if the latest market date cannot be established. Independently of the CLI, a version record must have the strict schema `kind, schemaVersion, ruleVersion, enabledFrom, latestMarketDateAtEnable, reason`, a file name `<ruleVersion>.json`, `enabledFrom` later than `latestMarketDateAtEnable`, and `enabledFrom` later than the `latestMarketDate` in `manifest.json` **in the commit that introduced the record**; the guard enforces this, capture ignores invalid records, and pre-commit rejects any new prediction while an invalid or backdated record exists. Historical enabling would be back-capture.
4. **Pre-commit validation (§11.1) is fail-safe.** `ledger:precommit` validates only the *pending* changes under `public/data/ledger` (allowed: new daily files, new receipts, changes to `ledger-state.json`; the ledger root must be `public/data/ledger` or inside it, so `.` can never be cleaned). On a rejection it restores only that directory to HEAD, records `runStatus = anomaly`, announces `restored=true` and exits 1. If it **crashes or cannot finish** it exits 2 without announcing; the workflow then runs `scripts/ledger-failsafe-restore.sh`, and the data commit stages through `scripts/ledger-stage-data.sh`, which keeps ledger changes out of the commit (unstage + `git stash`) unless the ledger was validated or rolled back. If even that fails the commit step fails and nothing is pushed. Market-data files outside the ledger directory are never reset or deleted. The final gate also reads the real outcomes of the capture, receipt and pre-commit steps, so a crashed step cannot hide behind a stale successful `ledger-state.json`.
5. **Acknowledgements replace "exemptions" (§12.2, §16).** There are two distinct types, and neither can authorise changing or hiding an immutable record. **(A) Historical immutability acknowledgement** `exemptions/<40-hex commit>.json`: names the commit, each exact path, the violation (`M`, `D`, `R`, `T`) and the before/after blob hashes; it is create-only. The guard marks a history violation *acknowledged* only if the hashes match the real history **and** the file as it is now; otherwise it stays red. An acknowledged violation is reported explicitly (a warning, not silently green), and **its session stays excluded from the live holdout** whatever the acknowledgement says. Acknowledgements cover predictions, receipts, corrections, protocol records and other acknowledgements; `holdout.json` changes can never be acknowledged. **(B) Source-revision acceptance** `exemptions/source-revision-<date>-<ruleVersion>.json`: used only for the R10 governance case (a `source-revised` date may be considered again); it is bound to the prediction record by `predictionsSha256` and is invalid if the record differs or if the session has a violation of its immutable records. Type B has no consumer in A1 (it is validated and listed only). An unacknowledged violation is red; no violation is a normal pass.
6. **Receipts and state are validated by the guard (§12.2).** A receipt must be complete, consistent (times, class against the cut-off), reference an existing daily file and match its SHA-256 and generation time. `ledger-state.json` must contain only the permitted keys and values and may not contain prediction payloads.
7. **Watchdog (§13)** deviations, all intentional: (a) it checks out two files with a sparse checkout and `persist-credentials: false` instead of using no checkout, so the decision logic is testable; (b) its actions are pinned to full commit SHAs (checkout v4.2.2, setup-node v4.4.0, verified through the GitHub API); (c) it runs daily at 03:15 and 19:30 UTC as specified, and an existing issue is only commented on when its content hash changed; (d) permissions remain `contents: read` and `issues: write` only.
8. **Test discovery (§12.1).** `vite.config.ts` is no longer modified. `npm test` is `vitest run --exclude "tests/ledger/**"` (still the original 302 tests); `npm run test:ledger` runs the governance tests; plain `npx vitest` and IDEs discover both.
9. **Rule path untouched.** The optional `manifest.supplements.ledger` summary is declared by module augmentation in `src/lib/ledger/manifestSupplement.ts`, not in `src/types/dataset.ts` (one of the 22 hashed rule files).
10. **Storage (§17.2)** is re-estimated from ten measured sessions; see the updated section.
11. **Watchdog closing rule.** An R11 `review-required` issue stays open for 7 days after the session, then closes itself; the flag stays in the daily record and the state permanently. Anomaly, source-revised and unverified issues are never closed automatically.
12. **Governance path filters** contain the exact 22 rule files, protocol, holdout and acknowledgement paths, ledger scripts and tests, `package.json` (it defines the ledger and test scripts) and the ledger workflows; `vite.config.ts` is no longer listed because it is no longer touched.
13. **Constituent fingerprint scope (final rounds).** The identity stored in a record covers **every list present in the dataset's constituents file** (in sorted key order): the stock universe (nifty500, microcap250), the size segments (midcap150, smallcap250) and every sector-index and context-index list, because the dashboard's universe code uses all of them (a stock's sector index, stock-versus-sector strength, sector breadth). For each list it stores a hash of every prediction-relevant field of every entry (symbol, company name, industry; entries sorted by symbol) and a separate hash of the symbol set, so key order and entry order never matter, an added/removed/renamed list is detected, and a labels-only change is told apart from a membership change. A change in any list with a different prediction digest is `existing-uncompared` (`constituent-lists-refreshed`), never an anomaly; a mismatch with every list unchanged remains an anomaly. (Real data: 19 lists; a daily record grows by about 3 KB.)
14. **R6 review decision (anomaly closure).** An R6 anomaly is never cleared by anything. A create-only record `exemptions/r6-review-<date>-<ruleVersion>-<12 hex of the candidate digest>.json` (kind `momentum-ledger.r6-review`, both digests, a meaningful reason) records that the owner looked at **one specific** anomaly; it must match the prediction record on disk. With review decisions covering every anomaly digest of a date, the final gate reports that date **amber** instead of red; the anomaly, its evidence and its exclusion from live results are unchanged. A new or different anomaly needs its own review. An anomaly without digests (for example an invalid stored record) cannot be reviewed.
15. **Receipt/state consistency.** The receipt is the authority for publication class. The guard and pre-commit reject a state that says `live`/`live-late` without a receipt of exactly that class. When verification reads a receipt that disagrees with the state, the more conservative class is used and the date is flagged `anomaly`; results that do not come from a receipt can never replace a receipt-backed class.
16. **Enable records and the parent commit.** A version record is validated against the manifest in the commit that introduced it **and** in that commit's parent; the later of the two market dates must be earlier than `enabledFrom`.
17. **Live-holdout eligibility is enforced, not just reported.** `computeLiveHoldout` (guard.mts) is the single rule: a session is eligible only with a valid prediction record, a valid receipt of class `live`, no modification/deletion/rename of any of its immutable files (acknowledged or not), no R6 anomaly (reviewed or not) and, if its source changed, a valid source-revision acceptance. The guard prints the eligible and excluded sessions with reasons and refuses an unblinded `holdout.json` that claims more completed live sessions than are eligible.
18. **Fail-safe restore** (`ledger-failsafe-restore.sh`) no longer uses `git ls-tree | grep -q` under `pipefail`, which silently skipped the restore when the ledger listing was large.

---

Every item marked *verified* was checked in this task against source code, committed data, Git history or the live GitHub APIs. Anything I could not check says so.

## Contents

1. [Decisions, history and blocker resolutions](#1-decisions-history-and-blocker-resolutions)
2. [Scope of Phase A1](#2-scope-of-phase-a1)
3. [Audit summary](#3-audit-summary)
4. [Effective configuration (D3)](#4-effective-configuration-d3)
5. [Rule-version hash (D4)](#5-rule-version-hash-d4)
6. [Daily file format, naming and schema (D6)](#6-daily-file-format-naming-and-schema-d6)
7. [Candidate pool, lists and duplicates](#7-candidate-pool-lists-and-duplicates)
8. [Publication timestamps and live classification (D5)](#8-publication-timestamps-and-live-classification-d5)
9. [Capture schedule (D10, B5)](#9-capture-schedule-d10-b5)
10. [Readiness checks R1–R11 (D9, B1, B2, B3, B6)](#10-readiness-checks-r1r11-d9-b1-b2-b3-b6)
11. [Capture workflow, failure and retry behaviour](#11-capture-workflow-failure-and-retry-behaviour)
12. [Governance tests and read-only guard (D15, D16)](#12-governance-tests-and-read-only-guard-d15-d16)
13. [Watchdog (D7)](#13-watchdog-d7)
14. [Replay storage and raw-data preservation (D8)](#14-replay-storage-and-raw-data-preservation-d8)
15. [Outcome definitions OD1 and headline denominators (D1, D2, B4)](#15-outcome-definitions-od1-and-headline-denominators-d1-d2-b4)
16. [Live holdout protection (D11)](#16-live-holdout-protection-d11)
17. [Storage and growth (D14)](#17-storage-and-growth-d14)
18. [Deferred items, testing plan and known limitations](#18-deferred-items-testing-plan-and-known-limitations)
19. [Final A1 Readiness Checklist](#19-final-a1-readiness-checklist)
20. [Open items and manual repository settings](#20-open-items-and-manual-repository-settings)

---

## 1. Decisions, history and blocker resolutions

### 1.1 Decision table (D1–D16)

| Decision | Status | Where | Summary |
|---|---|---|---|
| **D1** OD1 rules; headline = Confirmed share + Adverse share (Failed + Reversal) | **Approved** (the B4 denominator resolution awaits your acceptance) | §15 | Exact formulas retained; denominators defined. |
| **D2** retain E and N; keep the name `Partial` | **Approved** | §15.5 | "Directional excursion" is not used (too narrow for the rule). |
| **D3** per-day header with actual effective settings | **Approved** | §4, §6 | 11 of 15 settings leaves are read by the path; all 15 recorded. |
| **D4** token-stream rule-version hash | **Approved** | §5 | 22 files; prototype verified. |
| **D5** conservative publication-based live classification; cut-off 09:00 IST of the **next NSE trading session** | **Approved** | §8 | Authoritative timestamp = GitHub repository-activity push event; otherwise `unverified`. |
| **D6** one create-only `.json` per trading day | **Approved** | §6 | |
| **D7** watchdog `contents: read` + `issues: write` | **Approved** | §13 | May ship with or shortly after A1. |
| **D8** replay on a separate orphan branch | **Approved (design only)** | §14 | No replay generated. |
| **D9** readiness thresholds, R9, R10 | **Approved** (the R5, R9, R10 resolutions await your acceptance) | §10 | B1, B2, B3 resolved; B6 adds R11. |
| **D10** capture at 14:30, 16:00, 17:30, 19:00 UTC | **Approved (provisional)** | §9 | Validated; no technical failure found. |
| **D11** ≥ 250 completed live sessions; you authorise unblinding | **Approved** | §16 | |
| **D12** completeness panel | **Deferred** (after A1) | §18.1 | |
| **D13** filing metadata | **Deferred** (after A1); not in the A1 schema | §18.2 | |
| **D14** live on `main`, replay on orphan branch, no external DB | **Approved** | §17 | Measured costs and monitoring triggers. |
| **D15** governance tests in a separate workflow | **Approved** | §12.1 | |
| **D16** independent read-only guard | **Approved** | §12.2 | Manual settings in §20.3. |

No decision is **blocked**.

### 1.2 Decision history (what changed between revisions)

| Decision | Revisions 1–2 | Revision 3 | Revision 4 (this) |
|---|---|---|---|
| D1 headline | Not specified | Confirmed share + Adverse share; **denominators open (B4)** | Denominators defined: completed outcomes only (§15.6) |
| D2 naming | `Partial` | Rename to "Directional excursion" tested and **not applied** | Confirmed: `Partial` retained |
| D4 hash | Emitted JS | Token stream, 22 files | Unchanged |
| D5 cut-off | 09:15 IST, runner `createdAt` | 09:00 IST **next calendar day**, run `updated_at` as an upper bound | **09:00 IST of the next NSE trading session** (holidays honoured); the authoritative timestamp is the GitHub push-activity event; run times and committer dates are cross-checks only |
| D6 format | Monthly `.jsonl` | Per-day `.json` | Unchanged |
| D7 watchdog | `actions: write` | `contents: read`, `issues: write` | Unchanged |
| D8 replay | Non-deployed folder (self-contradictory) | Orphan branch + deployed summary | Unchanged |
| D9 | R1–R8; R9, R10 undefined | R5/R9/R10 **blocked** | All resolved; new R11 (review flag) |
| D10 schedule | 03:15/19:30 watchdog; 17:30 and 21:00 capture | Found unreliable; correction proposed | **14:30, 16:00, 17:30, 19:00 UTC** approved; 02:30 UTC Tue–Sat run retained |
| D12 / D13 | In scope | Deferred | Unchanged; filing fields removed from the A1 schema |
| D14 storage | 68 MB/yr (wrong) | 125 MB/yr measured | ≈ 129 MB/yr including R10 digests (§17) |

### 1.3 Blocker resolutions at a glance

| Blocker | Resolution | Where |
|---|---|---|
| **B1** R9 margin | R9 fails when the number of stocks present on the previous session but absent on *t* exceeds **the 20-session trailing median + 1**; any non-zero count is always recorded | §10.2 |
| **B2** R10 definition | Per-symbol 365-day window digests stored at capture and recomputed for the last 10 captured sessions; a mismatch marks the **past** session `source-revised` and never blocks new captures | §10.3 |
| **B3** R5 first snapshot | R5a (every snapshot): four list sizes within ±5% of their **nominal index sizes** (500, 250, 150, 250). R5b (from the second live-capture snapshot): symbol count within ±5% of the previous live-capture snapshot, skipped when the lists were refreshed | §10.4 |
| **B4** denominators | Completed (`status = complete`) outcomes of the same horizon, per unique stock-day, per direction cohort; unavailable, pending and coverage reported separately | §15.6 |
| **B5** schedule | The four approved times validated; the 02:30 UTC run is kept for recovery | §9 |
| **B6** price-break bursts | New **R11**: a review flag, not a block; every excluded stock is recorded with full evidence | §10.5 |

### 1.4 Relationship to `MOMENTUM_LEDGER_DECISION_REVIEW.md`

The decision review is a **historical record** of the Revision 3 review and was deliberately not edited in this task. Where it differs from this document, this document governs:

| Topic in the review | Superseded by |
|---|---|
| D5 cut-off 09:15 IST, judged on "the publishing commit" | 09:00 IST of the next NSE trading session; the authoritative timestamp is the GitHub push-activity event (§8) |
| D10 watchdog 03:15/19:30 UTC with capture slots 17:30 and 21:00 UTC | Capture at 14:30, 16:00, 17:30, 19:00 UTC (§9); watchdog unchanged |
| D2 "consider renaming Partial" | `Partial` retained (§15.5) |
| R5 first-snapshot behaviour, R9 "set margin", R10 "optional correction", "abnormal source data" gap | Resolved in §10.2–§10.5 |
| Headline shares without denominators | §15.6 |
| Storage figures (68 MB/year predictions, 10 MB/year history) | §17.2 (≈ 129 MB/year, ≈ 21 MB/year) |
| Holiday rule "index missing with stocks earlier-session" | The full `reconcileDate` rule (§8.3) |

---

## 2. Scope of Phase A1

**A1 includes only:**
1. Capturing the live daily prediction snapshot (Setup, Evidence, Score, components, For/against, ranks and list membership) for each trading date.
2. Recording the required metadata and the **actual effective settings and rule constants** in a per-day header.
3. Preserving every list membership and rank.
4. Creating one immutable, create-only JSON file per trading day, and a create-only publication **receipt** per day.
5. Integrating capture into the existing data workflow without blocking market-data refresh or deployment.
6. Recording capture status and failures (`ledger-state.json`, a manifest supplement, a red job, watchdog alerts).
7. The required tests (in a separate workflow) and the independent read-only immutability guard.
8. `protocol/od1.json` and a sealed `holdout.json`, committed before any live outcome exists.

**A1 must NOT include:** outcome calculations; replay generation; historical backfill; performance dashboards or any Tracker UI; model tuning; scoring changes; new prediction labels; changes to existing sector or stock ranking logic; filing capture (D13); the completeness panel (D12).

**Existing files A1 may touch (and nothing else):** `.github/workflows/update-data.yml` (steps, four capture schedule lines, `actions: read`), `package.json` (scripts), `.gitignore` (staging-file rule). *(Post-audit: `vite.config.ts` is no longer modified; the exclusion is in the `npm test` script — see the errata.)* No file under `src/lib/momentum`, `src/lib/calculations`, `src/config` or `src/types` changes. Any such change later is a rule change and pauses capture until a new version is deliberately enabled (§5.4).

---

## 3. Audit summary

| Question | Answer (verified against source) |
|---|---|
| Momentum continuation candidate (Setup, gainers only) | First match: insufficient gates → *Extended* (≥15% from 20-day SMA or ≥20% in 5 sessions) → *Weak momentum* (close-in-range < 0.5 or rel. vol < 1.0) → *Possible breakout* (close ≥ 0.7, rel. vol ≥ 1.5, close above prior 60-session high) → ***Momentum continuation*** (close ≥ 0.7, rel. vol ≥ 1.5, above 50-day SMA, 1-month return beats NIFTY 500) → *Mixed*. |
| Continuation characteristics (Evidence) | Net score ≥ +3 with price-structure ≥ +1 and volume = +1, after the exhaustion test fails. Setup and Evidence are independent. |
| Score | Five unweighted components: price structure (−2..+2), volume (−1..+1), relative strength & sector (−2..+2), market (−2..+2), extension (−3..0). |
| Thresholds | Fixed constants (§4.2); not fitted. Pattern and regime inputs read 11 settings leaves (§4.1). |
| Point-in-time | Features use bars ≤ t (tested). Exceptions: current membership, industry and size segment apply to all past dates. |
| Price breaks | `validateBars`/`splitAtPriceBreaks` (`validation.ts`): *corporate-action-break* (open **and** close ≤ 0.6× or ≥ 1/0.6× the previous close), *unverified-discontinuity* (a fall with open **and** close ≤ 0.85×), *missing-sessions* (a NIFTY 500 session absent between two bars). A bar that starts a break is **not ranked** by `moversOn` (`discovery.ts`) and is listed in `excluded`. |
| Available history | Index from 2025-08-18; stock bars in the working copy from 2025-08-06 (Git history back to 2025-07-17); volume from 2025-09-03; filings from ~2026-10-27. |

---

## 4. Effective configuration (D3)

### 4.1 Settings — verified

`discover(...)` and `marketContextAt(...)` take `settings` as a parameter. The ledger writer passes `structuredClone(DEFAULT_SETTINGS)`, never the browser's Settings. Running both with a recording `Proxy`:

- **Read: 11 leaves** — `regime.breadthThresholdPct`, `regime.minBreadthMeasuresRequired`, and all nine `screening.*` leaves (`consolidationBaselineSessions`, `consolidationContractionRatio`, `consolidationLookbackSessions`, `resistanceLookbackSessions`, `resistanceProximityPct`, `triangleFlatSlopePctPerSession`, `triangleLookbackSessions`, `triangleMinPivots`, `trianglePivotSpacing`).
- **Not read: 4** — `scoring.*` (3) and `industry.minConstituentsForAggregate`.
- The header records the **whole** `AppSettings` object (15 leaves) **and** `settingsReadByMomentum` (the 11 paths). A governance test re-runs the audit and fails if the code starts reading an unrecorded leaf, or if changing any of the 11 leaves does not change the recorded configuration.

### 4.2 Rule constants — verified values

| Block | Values |
|---|---|
| `MOMENTUM_RULES` | strongCloseLocation 0.7 · weakCloseLocation 0.3 · fadeCloseLocation 0.5 · reversalCloseLocation 0.6 · volumeConfirmRvol 1.5 · lightVolumeRvol 1 · extendedFromSma20Pct 15 · extended5dPct 20 · abnormalMoveZ 3 · sectorWideMinPeerMovePct 1 · gapPct 2 · minBarsForEvidence 50 |
| `ASSESSMENT_RULES` | adverseWickShare 0.4 · multiSessionRunPct 15 · fadingParticipation 0.8 · continuationMinTotal 3 |
| `FEATURE_RULES` | activityBaselineSessions 20 · minActivityBaselineRows 18 · thinTurnoverCr 1 · retestLookbackSessions 10 · retestTolerancePct 2 |
| Exported calculation constants | PRICE_BREAK_RATIO 0.6 · UNVERIFIED_DISCONTINUITY_RATIO 0.85 · STALE_AFTER_CALENDAR_DAYS 7 · SESSION_LOOKBACK {d1 1, w1 5, m1 21, m3 63, m6 126} · TRIANGLE_MIN_CONFIRMING_PIVOTS 3 · TRIANGLE_MAX_PIVOT_DEVIATION_PCT 2 |
| Non-exported literals (kept in the ledger module with a parity test) | MIN_PEERS 3 · TRADING_DAYS_PER_YEAR 252 · MIN_CALENDAR_DAYS_FOR_52W 350 · sparse-window factor 0.7 · pool sizes 50/50/50 · DEFAULT_TOP_N 20 |

Inline literals (for example "21 sessions before today") are covered by the token hash (§5).

### 4.3 Source-data and manifest metadata (verified fields)

`manifest.json` keys: `schemaVersion` (2), `generatedAt`, `latestMarketDate`, `refresh{evaluatedAt, lastCompleteRefreshAt, latestDueDate, outcome, reasons, tradingDaysBehind}`, `supplements`, `warnings`, `sectors`, `benchmark`, `source`. `refresh-state.json` entries: `status`, `checkedAt`, `attempts`, `detail`, `symbolSetHash`. `constituents.json`: `constituents`, `fetchedAt`, `slug` per list. Plus SHA-256 and size of `stocks.json`, `index-series.json`, `stock-activity.json`, `constituents.json`. The exact header is in §6.3.

---

## 5. Rule-version hash (D4)

### 5.1 Included files (verified import graph)

Transitive imports from the seven entry points (`discovery`, `market`, `universe`, `features`, `assess`, `classify`, `activity`), value imports separated from `import type`.

**Runtime files (17):** `src/config/{marketIndices, sectorUniverse}.ts` · `src/lib/activity.ts` · `src/lib/calculations/{breadth, distanceFromHigh, patterns, regime, relativeStrength, returns, validation}.ts` · `src/lib/momentum/{assess, classify, discovery, features, market, universe}.ts` · `src/types/metrics.ts` (runtime helpers `ok`, `unavailable`).
**Contract (type-only) files (5):** `src/types/{activity, config, dataset, market, momentum}.ts` (`config.ts` also holds `DEFAULT_SETTINGS`).
**Total 22.** Excluded: `src/config/marketCapSegments.ts` (not imported), `src/lib/momentum/{outcomes, evaluation, explain, filters, freshness, news}.ts`, all `src/components/*`, `src/lib/{export, storage, providers, backtest}`, `scripts/*`, tests. A governance test recomputes the graph and fails if the list differs.

### 5.2 Procedure

1. Parse each file with the repository's pinned TypeScript (`~5.7.2`, installed 5.7.3): `createSourceFile(..., ESNext, setParentNodes false, TS)`.
2. Walk the tree and collect the **text of every leaf token** in source order, excluding comments and JSDoc. Literal text is verbatim.
3. `tokenHash(file) = sha256(tokens joined with U+0001)`.
4. `ruleVersion = "mv" + N + "-" + first 8 hex of sha256(canonical JSON of [{path, tokenHash}] sorted by path + canonical §4.2 constants + canonical DEFAULT_SETTINGS)`. `N` is a manually bumped integer (currently 1).
5. The header records every `{path, tokenHash}`, the TypeScript version and the procedure id `token-v1`.

### 5.3 Verified behaviour (prototype on `classify.ts`, 2,011 tokens)

Unchanged by: repeat, blank lines and indentation, added comments/JSDoc, operator spacing. Changed by: `0.7 → 0.71`, `>= → >`, identifier rename, label text edit.

### 5.4 Limitations

- Depends on the TypeScript parser's tokenisation; a compiler upgrade could change tokenisation of an existing construct (the golden test fails; the remedy is an explicit re-baseline). A second TypeScript version was not tested.
- Conservative: renames and type-only edits change the version even when behaviour is identical.
- Does not see files outside the 22 (an added import is caught by the import-graph test); data-dependent behaviour is outside the hash and captured by the header's list hashes.
- **Fail-closed rule (R8):** if the computed `ruleVersion` differs from the enabled version (the latest create-only `protocol/versions/<ruleVersion>.json`, stating `enabledFrom` and a reason), capture does not write and raises a high-severity alert. Sessions missed meanwhile are lost for the holdout.

---

## 6. Daily file format, naming and schema (D6)

### 6.1 Format and naming

- **One create-only file per trading date:** `public/data/ledger/live/predictions/<ruleVersion>/<YYYY-MM-DD>.json` (session date), e.g. `…/mv1-3f9a12bc/2026-11-02.json`.
- **A single JSON object**, UTF-8, compact, fixed key order, trailing newline. JSONL and line-delimited JSON are the same format and are not used.
- **Create-only:** never edited, appended to, renamed or deleted. Writing a date that exists is a no-op if the bytes are identical, an `anomaly` otherwise.
- **Corrections never replace a file:** `live/corrections/<ruleVersion>/<YYYY-MM-DD>.v<N>.json` with `{supersedes: {path, sha256}, reason, detectedAt, …}`. Default analysis uses the original.
- **Related files:** `live/receipts/<YYYY-MM-DD>.json` (§8), `protocol/od1.json`, `protocol/versions/<ruleVersion>.json`, `protocol/calendar/<YYYY-MM-DD>.json` (optional special-session overrides, §8.4), `exemptions/<sha>.json` (§12.2) — all create-only. Mutable: `ledger-state.json`; `holdout.json` (only the sealed → unblinded transition, §16).
- **Staging:** writes go to `<file>.partial` in the destination directory, `fsync`, atomic rename. `*.partial` is git-ignored and deleted at the start of every capture, so an interrupted run cannot be committed by `git add public/data`.

### 6.2 Deployment path and compression

- Vite copies `public/` to `dist/`; the site base is `/Sector-Dashboard/`, so the file is served at `https://sanoramv.github.io/Sector-Dashboard/data/ledger/live/predictions/<ruleVersion>/<date>.json`. Browser code builds URLs from `import.meta.env.BASE_URL`, as `StaticSnapshotProvider` does (verified: `DATA_BASE = BASE_URL + "data"`). The ledger directory is not git-ignored (verified) and does not exist yet (verified).
- **Compression verified for `.json`:** `manifest.json`, `index-series.json`, `constituents.json`, `refresh-state.json`, `stocks.json`, `stock-activity.json` are all served `content-type: application/json; charset=utf-8` with `content-encoding: gzip`. The ledger files have not been deployed, so their own headers are **unverified until the A1 acceptance check**: `curl -sI -H "Accept-Encoding: gzip" <url>` after the first deploy must show the same two headers.
- **Deployment-path test (governance workflow):** `vite build` with `VITE_BASE_PATH=/Sector-Dashboard/`; assert every file under `public/data/ledger/live/` is present byte-identical under `dist/data/ledger/live/` and parses as JSON.

### 6.3 Exact daily header

```
{
  "kind": "momentum-ledger.daily",  "schemaVersion": 1,
  "header": {
    "sessionDate": "YYYY-MM-DD",
    "source": "live-capture",                       // never "replay"
    "generatedAt": ISO-UTC,                         // runner clock; recorded, never sufficient alone (§8)
    "github": { "repository", "workflow", "runId", "runAttempt", "runNumber", "sha", "ref" },
    "runtime": { "node", "typescript" },
    "model": { "ruleVersion", "tokenizer": "token-v1", "ruleFiles": [ { "path", "tokenHash" } x22 ] },
    "config": {
      "settings": <structuredClone(DEFAULT_SETTINGS), 15 leaves>,
      "settingsReadByMomentum": [ 11 paths ],
      "rules": { "MOMENTUM_RULES", "ASSESSMENT_RULES", "FEATURE_RULES" },
      "calcConstants": { §4.2 exported }, "literalConstants": { §4.2 literals },
      "pool": { "gainers": 50, "losers": 50, "volume": 50 },
      "readiness": { "R4": {"fraction": 0.9, "baselineSessions": 20},
                     "R5": {"tolerancePct": 5, "nominal": {"nifty500": 500, "microcap250": 250, "midcap150": 150, "smallcap250": 250}},
                     "R9": {"margin": 1, "baselineSessions": 20},
                     "R11": {"warnCount": 3, "sameRatioCount": 3, "ratioDecimals": 2} }
    },
    "sourceData": {
      "manifest": { "schemaVersion", "generatedAt", "latestMarketDate", "refresh", "supplements", "warningsCount", "warningsSha256" },
      "refreshState": { "index": {status, checkedAt, attempts, detail, symbolSetHash}, "stocks": { same } },
      "files": [ { "name", "bytes", "sha256" } x4 ],
      "universe": { "lists": [ { "slug", "count", "sha256", "fetchedAt" } ], "symbolCount", "symbols": [ sorted symbols ] },
      "calendar": { "firstDate", "lastDate", "sessions" }
    },
    "inputDigest": {                                // R10
      "windowCalendarDays": 365, "procedure": "digest-v1",
      "perSymbol": [ 12-hex digest aligned with universe.symbols ],
      "indexSeries": { "<slug>": 12-hex digest x20 }
    },
    "market": {
      "regime", "benchmarkChangePct", "nifty50ChangePct", "breadth50": { "pct", "eligible", "total" },
      "counts": { "universe", "eligible", "unchanged", "noSession" },
      "excluded": [ { "symbol", "reason", "prevDate", "prevClose", "open", "close", "closeRatio", "openRatio", "rawChangePct", "missingSessions" } ],   // R11: every unranked stock, with evidence
      "noBarToday": [ symbols ],                    // R9
      "volumeRowsMissing": [ symbols ]
    },
    "lists": { "gainer": [ symbols in rank order ], "loser": [ ... ], "volume": [ ... ] },
    "readiness": { "passed": true, "warnings": [ ... ], "checks": [ { "id", "status", "observed", "threshold", "mode" } ] },
    "predictionCount": n, "predictionsSha256": hex,
    "filings": null                                 // not captured in A1 (D13)
  },
  "predictions": [ ...records sorted by symbol... ]
}
```

`predictionsSha256` = SHA-256 of the canonical JSON (keys sorted, no whitespace) of the `predictions` array. The cut-off and classification are **not** in the file: they depend on information that exists only after publication and are recorded in the receipt (§8.5).

### 6.4 Exact prediction record

Generated by a prototype of this mapping over 31,746 real records with the application's own code; names and types come from that run. `Maybe<T>` is stored as the value or `null`, with the reason kept in `unavailable`.

| Group | Fields |
|---|---|
| Identity | `predictionId` (`date\|symbol\|ruleVersion`), `date`, `symbol`, `companyName`, `industry`, `sectorIndex` (slug or null), `sizeSegment` (`large\|mid\|small\|micro`, **proxy from current membership**), `group` (`gainer\|loser`) |
| Lists | `lists[]`: `{ list: "gainer"\|"loser"\|"volume", rank, setup, evidence, netScore }` — one entry per list, rank **within that list**, classification as shown in it |
| Classification | `classification.setup`, `.evidence`, `.netScore`, `.components[{dimension, score, min, max, reasons[]}]`, `.missingEvidence[]`, `.rationale`, `.forFactors[{id,text}]`, `.againstFactors[{id,text}]`, `.lowConfidenceReasons[]`, `.quality{status, barsUsed, usableFrom, notes[]}` |
| Bar | `bar.open`, `.high`, `.low`, `.close`, `.prevClose` |
| Price | `price.changePct`, `gapPct`, `openToClosePct`, `closeLocation`, `rangePct`, `bodyShare`, `upperWickShare`, `lowerWickShare`, `r3`, `r5`, `r10`, `r20`, `volatility20`, `moveZ`, `distSma20Pct`, `distSma50Pct`, `distSma200Pct`, `distanceFrom52wHigh`, `distFromSwingHigh20Pct` |
| Patterns | `patterns.resistance{level, levelDate, distancePct, isApproaching}`, `breakoutToday`, `breakdownToday`, `failedBreakoutToday`, `retest{breakoutDate, level}`, `consolidationBefore{recentRangePct, baselineRangePct, contractionRatio, isConsolidating}`, `triangleBefore{type, highSlopePctPerSession, lowSlopePctPerSession, swingHighCount, swingLowCount, maxPivotDeviationPct, confidence, detected, tentativeReason}` |
| Volume | `activity.available`, `unavailableReason`, `volume`, `relativeVolume`, `turnoverCr`, `medianTurnover20Cr`, `deliveryPct`, `avgDeliveryPct20`, `series`, `tradeForTrade`, `zeroVolume`, `priorParticipation`, `liquidityWarnings[]` |
| Context | `context.peerCount`, `peerMedianChangePct`, `stockVsPeersPp`, `moveScope`, `relativeStrength1m`, `industryRelativeStrength1m`, `benchmarkChangePct`, `nifty50{changePct, relativeStrength1m, above50dma}`, `sectorIndex{slug, displayName, changePct, relativeStrength1m, above50dma, breadth50Pct, breadth50Eligible}`, `stockVsSectorIndexPp`, `marketRegime` |
| Unavailable | `unavailable{ "<field path>": "<reason text>" }` |
| Integrity | `recordHash` (SHA-256 of the record's canonical JSON excluding itself) |

**Not in A1:** `filings`, any outcome field, any field derived from data after the session date.

---

## 7. Candidate pool, lists and duplicates

- **Pool per date:** top 50 gainers, top 50 losers (ranked by day change, ties by symbol) and the 50 highest relative-volume stocks with a non-zero change and an available volume baseline — exactly `discover(..., 50)`. Measured: **122.1 distinct stocks/day** on average over 260 sessions.
- **One record per (date, symbol, ruleVersion).** A stock in several lists keeps **every** membership, its **rank in each list**, and its **classification as shown in each list** (`lists[]`). Nothing is dropped for appearing twice.
- **Top-20 reconstruction:** published top-20 gainers = records with `{list:"gainer", rank ≤ 20}`; likewise losers. `header.lists.*` repeats the ordered symbols and `header.market.counts` stores the eligible/unchanged/no-session counts, so a missing record is detectable.
- The unusual-volume list needs the volume baseline; if volume data is incomplete the day is blocked (R3), never recorded with a truncated list.

---

## 8. Publication timestamps and live classification (D5)

### 8.1 The four times — kept distinct

| Time | Meaning | Source | Trust |
|---|---|---|---|
| **T_gen** | Prediction generation | `header.generatedAt`, runner clock | self-report; recorded, never sufficient |
| **T_commit** | Commit creation | committer date of the commit that first adds the file | client-supplied; recorded, never sufficient |
| **T_pub** | Commit publication (push) | **GitHub repository-activity push event** for `refs/heads/main`: its `timestamp` | server-side; the only value that qualifies a record |
| **T_cut** | Cut-off | **09:00:00 IST on the day of the next NSE trading session** after the session date | derived from the exchange calendar (§8.3) |

### 8.2 What I verified about the publication timestamp

Fetched live from the GitHub API for this repository:
- `GET /repos/sanoramv/Sector-Dashboard/activity?ref=refs/heads/main&activity_type=push` returns, per push, `id`, `node_id`, `timestamp`, `activity_type`, `ref`, `before`, `after` and `actor`. It worked **unauthenticated** from this environment. Whether the Actions `GITHUB_TOKEN` can call it was **not verified**; if it cannot, every record is `unverified` (never `live`), which the A1 acceptance test would reveal.
- For **30 real pushes** to `main`: push timestamp minus the commit's committer date was **1–27 s (median 3 s)**; push timestamp minus the workflow run's `updated_at` ranged **−119 s to +388 s** (20 matched pairs). The three clocks agree for the bot's immediate pushes, but only the activity event is a server-side record of the ref update. A committer date is whatever the committing client wrote and can precede the push arbitrarily (a commit made offline and pushed later); a run's `created_at`/`updated_at` describe the run, not the push.
- A run object exposes `id`, `run_attempt`, `created_at`, `run_started_at`, `updated_at`, `head_sha`; none is used to qualify a record.
- I could not verify GitHub's documentation of the activity endpoint's retention. The verifier therefore copies the evidence it uses into the create-only receipt, so retention does not matter after verification.

### 8.3 The cut-off and the exchange calendar

`T_cut(d) = 09:00 IST on the next NSE trading session after session date d`, where the next trading session is the first following date whose archives show `trading` under the repository's own `reconcileDate` (`scripts/lib/refresh-state.mts`): both archives `ok` ⇒ `trading`; index `missing` with stocks `earlier-session` ⇒ `non-trading`; both `missing` on an older date ⇒ `non-trading`; both `missing` on the latest due date ⇒ `pending-publication`; anything else ⇒ `unresolved`. Examples (illustrative dates):
- Thursday session, pushed Friday 00:50 IST: the earliest possible next session is Friday 09:00 IST ⇒ **live immediately**, whether or not Friday turns out to be a holiday (the true cut-off is never earlier than that).
- Friday session, pushed Saturday 03:00 IST: the earliest next session is Monday 09:00 IST ⇒ **live**.
- Thursday session, pushed Friday 10:00 IST: live **only if** Friday is later resolved as `non-trading` (the cut-off moves to Monday 09:00 IST) and the push preceded it; if Friday is `trading` ⇒ `live-late`. Until Friday's archives resolve (after 19:00 IST) the date has **no receipt** and counts as not live.

### 8.4 Calendar limitation (documented, not hidden)

The pipeline assumes Monday–Friday sessions: `targetDates` skips weekends and the cron is `1-5`. A **weekend special session** (for example a Saturday session, or Muhurat trading on a holiday) is invisible to the repository. Mitigation: an optional create-only `protocol/calendar/<date>.json` declaring a special session, which the verifier honours. Without such a file, a record pushed after an unrecorded special session's 09:00 IST could be mislabelled `live`. This is a known limitation of "next actual NSE trading session" given the data source; the alternative (next calendar day) was rejected by your decision.

### 8.5 Implementation method (exact, for A1)

1. Capture writes the daily file; the existing commit/rebase/push loop publishes it. The commit that **first adds the file** is found with `git log --diff-filter=A --format=%H -- <file>` and must be reachable from `main`.
2. The next capture run (and each later one, until decided) runs a **verifier** for every undecided captured date, using a full-history checkout for ancestry checks:
   a. Page through the activity API for `refs/heads/main` pushes. Select the **earliest** push `A` such that the commit `C` is an ancestor of `A.after` and not an ancestor of `A.before` (`git merge-base --is-ancestor`). `T_pub = A.timestamp`.
   b. Record as cross-checks (not as qualifiers): `T_gen`, `T_commit`, the run's `run_started_at`/`updated_at`, `A.id`, `A.node_id`, `A.before`, `A.after`, `A.actor.login`.
   c. **Consistency:** require `T_gen ≤ T_pub` and `T_commit ≤ T_pub`. A violation means contradictory evidence.
   d. Compute `T_cut` from the calendar (§8.3). If the next-session status is not yet resolved and `T_pub` is later than the earliest possible cut-off, wait.
3. Classify:
   - **`live`** — `T_pub` obtained, consistency holds, and `T_pub ≤ T_cut`.
   - **`live-late`** — `T_pub` obtained, consistency holds, and `T_pub > T_cut`.
   - **`unverified`** — everything else: no activity record found (API unavailable, rate-limited, retention, token lacks access), no matching ancestor push, contradictory evidence, a commit not on `main`, or an incomplete calendar. Never `live`.
4. A receipt `live/receipts/<date>.json` (create-only) is written **only** when the class is `live` or `live-late`, containing the full evidence and the calendar statuses used. `unverified` dates are retried on every later run for 14 days and shown as `unverified` in `ledger-state.json`. **Absence of a receipt means "not live".** The holdout reads only receipts with class `live`.
5. **A delayed workflow cannot create a live prediction by being late:** lateness is judged on the push timestamp, not on when the file was generated; a record that publishes after `T_cut` is `live-late` permanently and is never relabelled. A recovery capture that publishes before `T_cut` with valid provenance (R1–R10 passed and recorded in its header) is legitimately `live`.

### 8.6 Trust model

A server-side push event plus the repository's own calendar: adequate to detect accidental lateness (retried pushes, delayed runs) and to avoid trusting client clocks; **not** adversarial proof — a user with write access can alter history, which branch protection and the guard reduce but cannot eliminate.

---

## 9. Capture schedule (D10, B5)

### 9.1 Approved schedule

| UTC | IST | Purpose |
|---|---|---|
| 14:30 (existing) | 20:00 | Main capture, after NSE's EOD files are normally published |
| **16:00** | 21:30 | Redundant attempt |
| 17:30 | 23:00 | Redundant attempt |
| 19:00 | 00:30 (next day) | Last redundant attempt inside the typical window |

All Monday–Friday (`1-5` UTC). The existing **02:30 UTC Tuesday–Saturday** run is kept unchanged: it starts about 13:34–14:18 IST in practice, so it cannot produce a `live` record for a Monday–Thursday session, but it is live-eligible for Friday sessions (next session Monday) and pre-holiday sessions, and recovers late captures as `live-late`.

### 9.2 Validation

- **IST conversion:** arithmetic above. `T_cut` for a Monday–Thursday session is 03:30 UTC the next day; for a Friday session it is Monday 03:30 UTC (later after holidays).
- **EOD availability (verified in code):** a date becomes due after `PUBLISH_CUTOFF_IST_MINUTES = 19 × 60` (19:00 IST = 13:30 UTC); NSE normally publishes by ~18:00 IST. The first slot (14:30 UTC) follows that.
- **Weekends and holidays:** a run on a holiday finds no new trading date and writes nothing; Saturday and Sunday have no capture except the Saturday 02:30 UTC run; special sessions are a documented limitation (§8.4).
- **GitHub Actions scheduling delay (observed in this repository's Actions history):**

| Slot (nominal) | Samples | Observed creation | Delay |
|---|---|---|---|
| 14:30 UTC | 15 | 18:13–22:10 UTC | **3 h 43 min – 7 h 40 min, median 5 h** |
| 02:30 UTC Tue–Sat | 4 | 08:04–08:48 UTC | **5 h 34 min – 6 h 18 min** |

The other three slots have not run yet, so their delays are unobserved. Assuming the observed 3.7–7.7 h range: 16:00 → lands about 19:42–23:42 UTC; 17:30 → about 21:12–01:12 UTC; 19:00 → about 22:42–02:40 UTC. Against a midweek `T_cut` of 03:30 UTC all four finish before the cut-off, with **about 50 minutes of margin** at the worst observed delay; against a Friday `T_cut` the margin is more than two days. Recent routine runs take 0.3–1.4 minutes, so extra slots cost little.
- **Demonstrated technical failure:** none. The four times are kept. *Monitoring:* `ledger-state.metrics` records each run's actual start time and slot; if a slot's observed delay approaches `T_cut − nominal`, the schedule is reviewed.

### 9.3 Duplicate prevention

`concurrency: update-data` (existing, `cancel-in-progress: false`) serialises every run. Capture is idempotent: the daily file is create-only (identical bytes → skip; differing prediction digest (`predictionsSha256`) → `anomaly`); the receipt and later outputs are create-only; fetches skip dates already downloaded `ok`. Multiple runs for the same date therefore produce one file.

### 9.4 Capture uses actual time and the calendar

Capture never infers lateness from the schedule. It records the actual `generatedAt`, the run id/attempt and the readiness results; classification is made afterwards from the push event and the exchange calendar (§8). A run that starts late produces a file whose class is decided only by when it was **published**.

---

## 10. Readiness checks R1–R11 (D9, B1, B2, B3, B6)

A date is captured only if **every blocking check (R1–R9) passes**; otherwise the status is `waiting` (inputs not ready) or `blocked`, reasons are recorded in `ledger-state.json`, **nothing is written for that date** and the watchdog reports it. R10 never blocks a new capture (it flags a past session) and R11 never blocks (it flags). No partial daily file exists.

### 10.1 Summary

| # | Check | Reason | On failure |
|---|---|---|---|
| R1 | `refresh-state` has `status = ok` for the index and stocks archives of date *t* | Existing record that the day's files were retrieved and validated | `waiting` → `missed` at the cut-off |
| R2 | All 20 tracked index series (this set **includes** NIFTY 500) have a bar for *t* (verified: 20 series, all present on the latest date; shortest history 240 bars) | Missing index context silently changes market and sector components | same as R1 |
| R3 | Volume file has a row for ≥ **99%** of universe stocks that have a bar on *t* (measured coverage 1.000 on every session since volume collection began; only the 11 sessions before 2025-09-03 fall short) | Distorts relative volume and the unusual-volume list | `blocked` |
| R4 | Eligible-stock count (`eligibleCount`) ≥ **90%** of the median of the same quantity over the 20 preceding sessions, computed from the dataset (measured over 260 sessions: min 701, median 741, max 751; 90% of the median ≈ 667 never triggered) | Truncated bhavcopy | `blocked` |
| R5 | Universe lists sane — **R5a / R5b**, §10.4 | Corrupt or half-written constituent list | `blocked` |
| R6 | No existing file for (date, ruleVersion) whose **canonical prediction digest** (`predictionsSha256`) differs from a fresh evaluation, and no existing file that is unreadable, truncated or invalid (volatile metadata such as `generatedAt` is not compared; see the post-audit errata) | Immutability | `anomaly` |
| R7 | `manifest.latestMarketDate` ≥ *t* and `refresh.outcome` ≠ `failed`; if `partial`, only when date *t* is `ok` and `tradingDaysBehind = 0` (reasons written to the header) | Stale or failed refresh | `blocked` |
| R8 | Computed `ruleVersion` equals the enabled version (§5.4) | Silent rule drift | `blocked`, high severity |
| R9 | Missing-today check — §10.2 | A stock present yesterday and absent today vanishes silently from the ranking | `blocked` |
| R10 | Source-revision check — §10.3 | Source data for a captured session changing afterwards | `source-revised` flag on the **past** session; never blocks a new capture |
| R11 | Price-break burst — §10.5 | Unexplained bursts of excluded stocks that R4 is too coarse to see | **review flag only** |

### 10.2 R9 — resolved (B1)

**What it checks.** `noBarToday(t)` = universe stocks (the header's `universe.symbols`) that have a bar on the previous session of the NIFTY 500 calendar and none on *t*. **Why a margin:** such stocks are legitimately absent now and then (a suspension, a delisting, an index change), so zero is not required; but each one is silently missing from the ranking, and R4 only reacts when ≥ 10% of the universe is missing.

**Rule.** `R9 fails iff |noBarToday(t)| > median( |noBarToday| over the 20 preceding sessions ) + 1`, with the median computed from the dataset (so it works on the first snapshot). If fewer than 20 preceding sessions exist the available ones are used and `baselineSessions` is recorded; with none the check is `blocked`. **Every** non-zero list is recorded in the header (`noBarToday`) and added to `readiness.warnings` even when the check passes.

**Evidence on committed data (276 evaluable sessions with 20 preceding sessions):** counts were 0 on 269 sessions and 1 on 7 sessions, never 2 or more. The seven non-zero days were legitimate: EMBDL (five 1–4-session gaps in April–May), CCAVENUE (a gap in October) and ICICIPRULI (last bar 2026-10-22, an index replacement).

| Option | Sessions failing | Sessions passing | False positives | False negatives |
|---|---|---|---|---|
| Median + 0 (fail on any excess) | 7 | 269 | **all 7 are legitimate gaps** (2.5% of sessions; each loses a holdout session irrecoverably) | none by construction |
| **Median + 1 (recommended)** | 0 | 276 | none observed | one missing stock passes (but is recorded and flagged) |
| Median + 2 | 0 | 276 | none | up to two pass |
| Median + 3 | 0 | 276 | none | up to three pass |
| Median + 5 | 0 | 276 | none | up to five pass |
| 0.5% of eligible (≈ 3) | 0 | 276 | none | up to three pass |

**Detection power if k stocks were silently dropped by an error** (a candidate pool of ≈ 122 of ≈ 741 eligible stocks): the chance that at least one dropped stock belongs to that day's pool is 16% (k=1), 30% (2), 42% (3), 59% (5), 84% (10). A larger margin lets more of these through.

**Recommendation: median + 1.** It is the smallest margin with **zero historical false positives**, so it is chosen as a data-quality safeguard, not for prediction performance. **Limitation:** only seven non-zero observations exist and no known corruption case, so the data cannot distinguish margins 1–5; the choice rests on the principle "smallest margin without observed false positives". A single missing stock is not blocked (a 16% chance it matters) but is always recorded.

### 10.3 R10 — resolved (B2)

**Failure mode.** The raw data for an **already captured** session changes afterwards: NSE republishes an archive, the pipeline re-extracts with a different symbol or series set, or a bug rewrites rows. A prediction would then describe data that no longer exists, and later outcomes would be measured against a different `C(t)`.

**Why it is needed — evidence from Git history.** I recomputed a 365-day window digest of `stocks.json` rows for fixed sessions across every data commit. Across the 16 commits that contain 2026-09-15 there were **four distinct digests** (120,816 → 178,699 → 179,277 → 180,343 rows) while extraction was being widened (microcap symbols, BE/BZ series); the same pattern holds for 2026-10-01 and 2026-10-08. The row growth mixes new symbols with additional rows for existing symbols; I did not separate the two. From commit `1537c8b` (2026-10-26) on, **five consecutive commits give one digest** for every session tested (2026-09-15, 10-01, 10-08, 10-14, 10-20). So the failure mode has occurred in this repository, and the stable period shows R10 does not fire during normal operation.

**Exact definition.**
- *Inputs at capture:* the current `stocks.json`, `stock-activity.json`, `index-series.json`, and the capture-time symbol list.
- *Per-symbol digest* `digest-v1`: for each symbol in `universe.symbols` (sorted), SHA-256 over the lines, in date order, `symbol|date|open|high|low|close|volume|turnoverLakhs|deliveryPct|series` for every bar whose date is in `(s − 365 calendar days, s]`, using JavaScript `String()` of each number and an empty field where the activity row or value is absent; keep the first 12 hex characters. The 365-day window equals the longest lookback the path uses (the 52-week window). Index digests use `slug|date|open|high|low|close` over the same window for each of the 20 series.
- *Stored:* `inputDigest.perSymbol` (aligned with `universe.symbols`) and `inputDigest.indexSeries`.
- *Check, each run:* for each of the **last 10 captured sessions** *s*, recompute the digests from the current data. **Pass** — every symbol still present in the data has an equal digest and every index digest is equal; symbols no longer present are listed as `removedFromSource` (informational, not drift). **Fail** — any difference.
- *Effect of failure:* the **past** session *s* is marked `source-revised` in `ledger-state.json` with the differing symbols, an Issue is opened, and *s* cannot count as a completed live session unless a type B source-revision acceptance is recorded (errata 5). A failure **does not block** capturing new dates, because each new capture records its own digests and therefore its own provenance. With no previously captured session the check passes vacuously (`checked: 0`).
- *Interaction:* R10 inspects past dates after R1–R9 have judged the new date; it never changes the new date's verdict.
- *Legitimate movements:* the digest compares the same data to itself over time, so gaps, breakouts, corporate actions or volatility cannot trigger it; only a change in recorded values or rows for an already-captured window can. A removed symbol is informational.
- *Size:* ≈ +15 KB per daily file (755 symbols and 755 × 12-hex digests).

**Tests.** Normal: five commits spanning 10-26 → 10-29 give one digest for each of five sessions (done on real history). Abnormal: earlier commits give four digests for 2026-09-15 (done). Synthetic: change one close ⇒ fail; remove a symbol ⇒ informational only; add a symbol not in the capture list ⇒ ignored; reorder rows ⇒ unchanged (the digest sorts); no prior capture ⇒ vacuous pass. **Limitation:** drift outside the 365-day window of a session is not seen (the path does not use it); pruning of bars older than the retention horizon does not affect windows of the last 10 sessions.

### 10.4 R5 — resolved (B3)

**What it measures.** That the constituent lists that define the discovery universe and the size segments are present and plausibly complete. A corrupt or half-written list would silently shrink the universe. **Why a baseline.** "Plausible" needs a reference; the first live snapshot has no earlier snapshot, and a replay record must not be used as one.

**Rule (two parts).**
- **R5a — every snapshot (bootstrap and ongoing).** The lists `nifty500`, `microcap250`, `midcap150`, `smallcap250` are present, parse and have counts within **±5%** of their **nominal index sizes** held in configuration: 500, 250, 150, 250 ⇒ allowed 475–525, 238–262, 143–157, 238–262. Verified now: 501, 254, 150, 251 — all pass. Configuration and the current file are the only inputs.
- **R5b — from the second live-capture snapshot.** The universe symbol count (`|nifty500 ∪ microcap250|`, 755 now) is within **±5%** of the previous live-capture snapshot's recorded `symbolCount` for the same `ruleVersion`, **unless** the lists were refreshed (`fetchedAt` differs from the previous snapshot's), in which case R5b is skipped and recorded as `mode: "list-refreshed"`.
- **Baseline source.** Only a previous `live-capture` daily file (whatever its receipt class — the baseline is a data-quality reference, not holdout membership). Never a `replay` file. If that file is unreadable or invalid, R5b is skipped with `mode: "nominal-only"` and a warning.
- **Missing inputs.** A missing or empty list, missing nominal configuration, or unparseable `constituents.json` ⇒ `blocked`.
- **Recorded:** `readiness.checks[R5].mode ∈ {"bootstrap-nominal", "previous-live", "list-refreshed", "nominal-only"}`.

**Examples (illustrative).** *First snapshot:* lists 501/254/150/251 ⇒ R5a passes, mode `bootstrap-nominal`, `symbolCount` 755 stored. *Second snapshot, unchanged lists:* 755 vs 755 ⇒ R5b passes. *A list refreshed to 770 symbols:* `fetchedAt` changed ⇒ R5b skipped; R5a (microcap 258, in range) governs. *A truncated file with microcap 120:* R5a fails (238–262) ⇒ `blocked`. *Second snapshot with 640 symbols and unchanged `fetchedAt`:* −15% ⇒ R5b fails.

**Tests.** First-snapshot pass/fail on each list; second-snapshot pass; refresh skip; replay file present but ignored; invalid previous file ⇒ `nominal-only`; missing list ⇒ blocked.

### 10.5 R11 — resolved (B6): price-break bursts

**What a price break is in this project.** §3 (`validateBars`, `splitAtPriceBreaks`). A bar that starts a break is excluded from ranking and listed in `excluded` with its reason; ordinary large moves that do not shift both open and close by the break ratios stay ranked (233 moves of ≥ 15% remained ranked in the history).

**Which small-burst failure mode R1–R10 miss.** A source error that makes the open **and** close of several stocks jump together (an adjusted or wrong-day price block, a unit error, or a prior-day gap that surfaces as `missing-sessions` the next day) would put those stocks into `excluded`, removing them from the ranking. R4 only reacts when ≥ 10% of the universe is lost (≈ 75 stocks); R9 only looks at stocks that vanish, not at stocks that jump; R10 looks at later revisions, not at the first publication. A burst of roughly 3–74 stocks therefore passes every other check unnoticed.

**Evidence on committed data (296 sessions).** Break-starting exclusions (reasons `corporate-action-break`, `unverified-discontinuity`, `missing-sessions`; `first-bar-in-history` is a new listing and not counted): 51 events in total, **per session 0 on 249, 1 on 43, 2 on 4, never 3 or more**. The four two-event sessions were unrelated real corporate actions with different ratios (2025-09-22 ADANIPOWER −76.0% and SANDUMA −66.5%; 2025-09-23 PIDILITIND −51.0% and TIMETECHNO −52.5%; 2025-10-14 TATAINVEST −89.6% and GOKULAGRO −54.6%; 2025-12-05 CAMS −80.4% and HCC −23.3%). No session had three stocks sharing one rounded ratio. By reason: 40 corporate-action, 5 unverified, 6 missing-sessions.

**Rule.** Let `B(t)` be the set of stocks excluded on *t* with reason in {corporate-action-break, unverified-discontinuity, missing-sessions}.
- **R11 raises a review flag iff** `|B(t)| ≥ 3` **or** at least 3 stocks in `B(t)` share the same `closeRatio` rounded to 2 decimals.
- It uses only capture-time data; it is deterministic; `first-bar-in-history` (comparison data missing) is excluded from the count but still recorded.
- **Behaviour (least disruptive safe):** the daily capture is **not failed** and no stock is marked unavailable beyond what the application already does. The date is recorded with `readiness.warnings` and `ledger-state` status `review-required`, an Issue labelled `ledger-review` is opened by the watchdog, and **every excluded stock keeps its evidence** in `header.market.excluded[]` (reason, previous date/close, open, close, close and open ratios, raw change, missing sessions) — nothing is silently discarded. The ≥ 10% systemic case remains a block through R4 (excluded stocks reduce the eligible count).
- **Distinguishing a corporate action from corruption where possible:** a corporate action shifts the whole day's price level, so open and close ratios agree and the event is isolated and idiosyncratic; a source error tends to be a *cluster* with a common ratio. The flag captures the cluster signature (count or shared ratio) and the recorded evidence lets a reviewer apply the open/close consistency test; no automatic reclassification is attempted.
- **Why a flag and not a block:** the historical maximum is 2, so thresholds of 3–10 would all have fired zero times; there is no observed corruption case, so no threshold can be justified as a rejection criterion. A flag costs nothing if it never fires and surfaces the pattern if it does.

**Tests.** All 296 historical sessions ⇒ no flag; the four two-event days ⇒ no flag and both stocks recorded; a legitimate ±15–25% mover that is not a break ⇒ not in `B(t)`; synthetic: 3 breaks ⇒ flag; 3 breaks with the same ratio ⇒ flag; 75 breaks ⇒ R4 block; a stock with no previous bar ⇒ recorded under `first-bar-in-history`, not counted.

### 10.6 Failure cases cannot produce a valid prediction

| Condition | Mechanism | Result |
|---|---|---|
| Missing stock prices (many) | R1, R4 | `blocked`, no file |
| Stocks vanishing | R9 (2 or more over a zero median blocks; any count recorded) | blocked, or recorded transparently |
| Missing volume (many) / (a few) | R3 blocks above 1%; a few are recorded in `volumeRowsMissing` and are "Insufficient evidence" | `blocked` / transparent |
| Incomplete index data | R2 | `waiting` → `missed` |
| Stale data | R7 | `blocked` |
| Abnormal source data, large | R4 | `blocked` |
| Abnormal source data, small burst | R11 flag; every excluded stock recorded | recorded with review flag |
| Source revised afterwards | R10 | past session flagged `source-revised` |
| Wrong rules | R8 | `blocked` |

---

## 11. Capture workflow, failure and retry behaviour

### 11.1 Integration in `update-data.yml` (as implemented in the working tree; never yet executed in Actions)

```
checkout → setup-node → npm ci
fetch index → fetch stocks → fetch announcements (continue-on-error) → build manifest
→ NEW  ledger: clean *.partial; run R1–R11; capture; verify earlier dates (R10); write receipts   (continue-on-error: true)
→ NEW  ledger: pre-commit validation (continue-on-error); on rejection restore public/data/ledger from HEAD and set status=anomaly
→ NEW  ledger: fail-safe restore, only if the validation neither passed nor completed its rollback (crash)
→ existing: npm run test            (unchanged; contains no new ledger tests, §12.1)
→ existing: commit and push data    (market data; ledger files ONLY if validated or rolled back - staged through ledger-stage-data.sh)
→ existing: check-refresh gate
→ NEW  final ledger gate: exit 1 if status is blocked/missed/anomaly      (AFTER the commit)
```

- **Permissions:** existing `contents: write` plus new `actions: read`. Everything else stays `none`.
- **Non-blocking:** capture is `continue-on-error`; the final gate runs after the commit, and `deploy.yml` already deploys after `success` or `failure`, so a ledger fault never blocks market data or deployment but turns the run red.
- **Receipts need a full-history checkout** for ancestry checks; the checkout step is widened for the verifier only (`fetch-depth: 0` costs a few MB; the repository is ~7 MB).
- **Concurrency:** the existing `update-data` group serialises all writers.
- **Idempotency and catch-up:** each run processes all undecided dates within the last 10 sessions in order; re-running yields identical bytes.

### 11.2 Failure and retry behaviour

| Event | Behaviour |
|---|---|
| Inputs not ready | `waiting`; retried by the next scheduled run (§9) |
| Blocking check fails | `blocked` with reasons; nothing written; retried until the cut-off, then `missed` (permanent for the holdout) |
| Crash mid-write | `*.partial` is ignored/deleted next run; a file exists complete or not at all |
| Verification mismatch | ledger changes discarded; `anomaly`; job red; Issue by the watchdog |
| Push failure | existing 3-attempt rebase loop; if all fail the run is red and the next run recreates identical files |
| Late publication | recorded `live-late`, never relabelled |
| Publication evidence unavailable | `unverified`; retried for 14 days; never promoted without evidence |
| Ledger fault | never blocks the market-data commit or deployment |

### 11.3 Status mechanism and metrics

`ledger-state.json` (mutable): per date `waiting | blocked | recorded | review-required | recorded-late | unverified | source-revised | missed | anomaly`, reasons, counters, `updatedAt`, the date classification `trading | non-trading | pending-publication | unresolved` from `reconcileDate`, each capture run's actual start time and slot, and `metrics`: `dailyFileBytes`, `ledgerBytes`, `publicDataBytes`, `captureSeconds`. `manifest.json → supplements.ledger` receives an additive summary (never altering `refresh`).

---

## 12. Governance tests and read-only guard (D15, D16)

### 12.1 Governance tests (D15)

- **Rule:** every new ledger test — golden-hash, immutability, schema, deployment-path and behavioural tests — lives in `tests/ledger/**` and runs **only** in `ledger-governance.yml`. the `npm test` script passes `--exclude "tests/ledger/**"` (post-audit; `vite.config.ts` is unchanged, so plain `npx vitest` and IDEs still discover the ledger tests), so `npm test` (run by `deploy.yml` and `update-data.yml`) remains exactly the existing 302 tests. **Verified:** both workflows run `npm run test` before building/committing, and `include` is `tests/**/*.test.ts(x)`.
- **Triggers:** `push`/`pull_request` filtered to the 22 rule files, `src/lib/ledger/**`, `scripts/ledger*`, `public/data/ledger/protocol/**`, `tests/ledger/**`, the workflow files and `vite.config.ts`; plus `workflow_dispatch`. Data commits made with `GITHUB_TOKEN` do not fire `push` events, so routine refreshes never trigger it.
- **Failure behaviour:** a red check and a notification. It does **not** stop `deploy.yml` or the data refresh. The protective effect on capture is R8.

### 12.2 Read-only guard (D16) — `ledger-guard.yml`

- **Independent of the capture job.** Permissions `contents: read`. Triggers: `push` to `main` touching `public/data/ledger/**`; `workflow_run` completed for "Update NSE sector data" (bot commits do not fire `push`); `pull_request`; `workflow_dispatch`.
- **Checks (full checkout):**
  1. `git log --diff-filter=MDRT --name-only -- public/data/ledger/live public/data/ledger/protocol public/data/ledger/exemptions` must be empty: only additions of live daily files, receipts, corrections, protocol records and exemptions are ever allowed; a modification, deletion, rename or type change of an existing file fails. A violation with a valid hash-bound type A acknowledgement is reported as acknowledged instead of failing the run (errata 5).
  2. Every added file is valid: JSON, `kind` and `schemaVersion`, filename date equals `header.sessionDate`, directory equals `header.model.ruleVersion`, `predictionCount` equals the array length, `predictionsSha256` matches, no duplicate symbol, ranks consistent, no `*.partial`.
  3. `holdout.json` may change only by the sealed → unblinded transition with an unchanged protocol hash.
- **Acknowledging a past violation (see errata 5).** A history violation is reported *acknowledged* only by a create-only type A record that names the commit, the exact path, the violation and the real before/after blob hashes, and only while the file is unchanged since. It never makes the change acceptable, never repairs or hides it, and the affected session stays excluded from the live holdout. Unacknowledged violations are red. `holdout.json` is never acknowledgeable. `holdout.json` records the count of acknowledgements and of sessions excluded at unblinding.
- **Failure behaviour:** a red run naming the commit and path; it cannot repair (read-only). The capture job runs the same checks before committing and fails closed.
- **Manual repository settings** required alongside it: §20.3.

---

## 13. Watchdog (D7)

An **alerts-only, stateless, read-only** workflow `ledger-watchdog.yml`.

| Aspect | Specification |
|---|---|
| Schedule | 03:15 UTC and 19:30 UTC daily plus `workflow_dispatch`. Because scheduled runs start hours late (§9.2) it is a post-hoc detector, not a pre-cut-off remediator. `concurrency: ledger-watchdog`. |
| **Permissions** | Workflow `permissions: {}`; job **`contents: read`** and **`issues: write`** only. No `contents: write`, `actions: write`, `pages`, `id-token`, secrets. |
| What it can change | Only GitHub Issues. It cannot push, rewrite a prediction or alter application code. |
| Inputs | `gh api` reads of `ledger-state.json`, `refresh-state.json`, `manifest.json` from `main`; no checkout, no repository scripts; third-party actions pinned by SHA; issue text contains only dates and status words. Public, unauthenticated API reads are used where the token lacks a scope. |
| Missed-session detection | Date *d* is captured if `ledger-state` shows `recorded` with a `live` receipt. **Missed** when `T_cut(d)` (§8.3) has passed and it is not captured; **at risk** from 08:45 IST on the next weekday. |
| Holidays vs missed | Uses the date classification the capture job wrote from `reconcileDate` (the pipeline's own logic): `trading` / `non-trading` / `pending-publication` / `unresolved`. `unresolved` raises a lower-severity "source data unresolved" notice, never a ledger alert. (Verified in data: 17 `missing` index dates, 15 `earlier-session` and 2 `missing` stock dates.) |
| Retries | **None.** Recovery is the idempotent catch-up on the capture schedule (§9). |
| Duplicate prevention | Creates no records. Issue title `Ledger snapshot missing: YYYY-MM-DD` is searched first; comment instead of creating. |
| Incomplete source data | Reports the `blocked` reasons recorded in `ledger-state` (for example "R3 volume coverage 62%"); it does not evaluate source data. |
| Review and capacity alerts | Opens `ledger-review` Issues for `review-required` (R11), `source-revised` (R10) and `unverified` dates, and `ledger-capacity` Issues when a §17.3 trigger is met. |
| Closing | Auto-closes when the date becomes `recorded` (live) or the loss is final (`missed`, labelled `ledger-lost-session`). `anomaly` and `source-revised` issues are never auto-closed. |
| If it fails | Red run and notification; capture is unaffected. Residual risk: if capture and watchdog both stop, the existing "Latest market data" and Status badge go stale. The Tracker's status strip shows `ledger-state.updatedAt`, which measures **capture** freshness, not watchdog health. |

`actions: write` is not required: it could dispatch or cancel any workflow, and retries come from the capture schedule instead.

---

## 14. Replay storage and raw-data preservation (D8)

**Design only — no replay is generated.**

- **Orphan branch `ledger-replay`.** Never deployed, not checked out by default, not built by any workflow; directory `replay/predictions/<ruleVersion>/<date>.json` (same daily-file format).
- **Physical separation:** different branch and root; live records exist only under `main:public/data/ledger/live/`.
- **Tagging:** `header.source = "replay"`, `replayGeneratedAt`, `sourceCoverage`, `limitations[]` on every replay file.
- **Never in the holdout or the live dataset:** (1) separate branch; (2) a distinct record type, with holdout functions accepting only the live type; (3) runtime assertion of `source === "live-capture"` and a receipt with `class = "live"`; (4) a **date fence** — the replay writer refuses any date on or after `holdout.startDate`; (5) tests for each. Replay is also never used as the R5 baseline.
- **Deployed summary only:** if the Tracker needs replay context it reads a small generated `public/data/ledger/replay-summary.json` (aggregates, no records) that is deployed; the site never attempts to load files that are not deployed.
- **Limitations recorded on every replay file:** membership = the lists as fetched on `<constituentsFetchedAt>` applied to all dates (survivorship); industry and size segment are current, not historical; settings are the defaults of the recorded `ruleVersion` (those in force on past dates were never recorded); features are recomputed with today's code; prices unadjusted and detected discontinuities excluded; data retention (bars older than the retention window exist only in Git history); volume from 2025-09-03; no historical filings.
- **Raw data that retention would prune (verified):** the working-copy `stocks.json` now starts 2025-08-06, but Git history still holds versions with bars from **2025-07-17** (for example commit `53d7a86`). The data survives as long as `main`'s history is intact. A safe preservation step, to be done separately: copy the five raw files from `53d7a86` and a recent commit onto the orphan branch under `raw-archive/<commit>/` with a SHA-256 manifest, and optionally tag the earliest commit. Neither the application nor the live ledger is touched; it is not required before A1 and has not been done.

---

## 15. Outcome definitions OD1 and headline denominators (D1, D2, B4)

OD1 is **specified here, frozen in `protocol/od1.json` with A1, and not computed in A1.** Outcome definitions are separate from, and cannot affect, prediction scoring. Changing any rule creates `od2`, computed in parallel from stored raw measurements; stored outcomes are never rewritten. The formulas are not tuned with model-conditional outcomes.

### 15.1 Quantities (horizon *h* sessions after prediction date *t*, NIFTY 500 trading-calendar index)

- **σ** = **population** standard deviation of the stock's 20 daily simple percentage changes `(close_i / close_{i−1} − 1) × 100` over the 20 sessions ending at *t−1* (day *t* excluded), comparable bars only; requires ≥ 22 comparable bars. This is `volatility20` (`features.ts`), frozen in the prediction record. No outcome-window volatility is used for classification.
- **ε_h = max( 0.5 · σ · √h , 0.20 )** percent. The floor is a constant of OD1, independent of the selectable cost assumption.
- **R_h** = `(C(t+h) / C(t) − 1) × 100`. **X_h** = `R_h − (NIFTY 500 close(t+h) / NIFTY 500 close(t) − 1) × 100`.
- **H\*, L\*** = highest high and lowest low over sessions *t+1 … t+h*. **H_t, L_t** = the prediction day's high and low.

### 15.2 Gainers

Conditions: **P** `R_h ≥ +ε_h` · **E** `X_h > 0` · **N** `H* > H_t` · **D** `R_h ≤ −ε_h` · **B** `L* < L_t`. First match wins:

| # | ID | Name | Rule |
|---|---|---|---|
| 1 | `inconclusive` | Inconclusive | window invalid (§15.4) |
| 2 | `reversal` | Reversal | **D and B** |
| 3 | `failed` | Failed continuation | **D and not B** |
| 4 | `confirmed` | Confirmed continuation | **P and E and N** |
| 5 | `partial` | Partial continuation | not D, and at least one of P, E, N (not all three) |
| 6 | `sideways` | Sideways | none of the above |

### 15.3 Losers (exact mirror)

Conditions: **P′** `R_h ≤ −ε_h` · **E′** `X_h < 0` · **N′** `L* < L_t` · **D′** `R_h ≥ +ε_h` · **B′** `H* > H_t`.

| # | ID | Name | Rule |
|---|---|---|---|
| 1 | `inconclusive` | Inconclusive | as above |
| 2 | `reversal` | Rebound / reversal | **D′ and B′** |
| 3 | `failed` | Failed downside continuation | **D′ and not B′** |
| 4 | `confirmed` | Confirmed downside continuation | **P′ and E′ and N′** |
| 5 | `partial` | Partial downside continuation | not D′, and at least one of P′, E′, N′ (not all three) |
| 6 | `sideways` | Sideways | none of the above |

*Verified:* P and D cannot both hold (ε > 0); after D is excluded every valid observation is Confirmed, Partial or Sideways; D splits into Reversal or Failed. The six classes partition all observations. **Group** is the sign of the day-*t* change.

### 15.4 Cross-cutting rules

| Topic | Rule |
|---|---|
| Horizons | Stored: 1, 2, 5, 10. **Headline: 1 and 5.** 2 and 10 descriptive. |
| Price gaps | Overnight gaps are part of `R_h`. `gap = O(t+1)/C(t) − 1` is stored; `|gap| ≥ 3σ` is flagged `abnormalGap` (1.2% of mover observations in replay); classified normally; reported with and without. |
| Abnormal volatility | If `max |daily change|` in the σ window ≥ 3.5σ the outcome is flagged `volWindowOutlier` (6.7% of σ windows in replay); classified normally; reported with and without. |
| Missing data | σ unavailable ⇒ Inconclusive (`insufficient-history`); a bar missing in *t+1…t+h* ⇒ Inconclusive (`no-bar`); *pending* until the calendar has passed *t+h* and the archives are `ok`. |
| Corporate actions | If any of bars *t+1…t+h* belongs to a different comparable price segment than bar *t* (`segOf[j] !== segOf[i]` in `outcomes.ts`) ⇒ Inconclusive (`discontinuity`); the raw unadjusted return is stored. |
| Profitability | Reported separately: `C(t+h)/O(t+1) − 1` minus cost; MFE/MAE. Never part of classification. |

### 15.5 D2 — conditions retained, `Partial` retained

E and N are retained and their contribution is part of the methodology. Label-agnostic measurement (top-50 gainers and losers by price change only, replay to 2026-10-29, k = 0.5, among valid observations):

| Cell | P | E | N | P∧E | P∧N | Confirmed | Confirmed ÷ P |
|---|---|---|---|---|---|---|---|
| h=1 gainers | 29.0% | 45.3% | 60.0% | 28.3% | 27.0% | 26.4% | 91% |
| h=1 losers | 30.5% | 52.6% | 66.0% | 29.7% | 29.5% | 28.7% | 94% |
| h=5 gainers | 29.1% | 46.1% | 77.2% | 28.5% | 28.9% | 28.3% | 97% |
| h=5 losers | 30.6% | 52.7% | 84.1% | 29.6% | 30.4% | 29.5% | 96% |

Composition of `partial` (share of Partial outcomes):

| Cell | N only | E only | E+N | P-containing |
|---|---|---|---|---|
| h=1 gainers | 38% | 15% | 38% | 8% |
| h=1 losers | 32% | 16% | 47% | 5% |
| h=5 gainers | 46% | 5% | 46% | 3% |
| h=5 losers | 41% | 4% | 52% | 2% |

**Why `Partial` is descriptive and must not be read as successful continuation:** 78–95% of Partial outcomes contain the intraday breach N and 4–16% are E-only (outperformed NIFTY 500 with no breach, possibly a slightly negative absolute return). It means "something in the direction happened, but there was no material close in that direction". **The name `Partial` is retained** by your decision; "Directional excursion" would not describe the E-only and P-without-N cases. Machine IDs are frozen in the protocol; display names live in a separate `labels` block outside the protocol hash.

### 15.6 Headline measures and denominators (B4)

**Definitions** (separately for each horizon *h* ∈ {1, 5} and each **cohort** *C*):

| Term | Definition |
|---|---|
| **Prediction record count** `N_rec(C)` | Number of prediction records in *C* from live-capture daily files whose receipt class is `live`, for one `ruleVersion` |
| **Unique stock-day count** `N_sd(C)` | Number of distinct (date, symbol) pairs in *C*. A stock on several lists on one date is **one** stock-day; its list memberships and ranks stay in the underlying record. Within one `ruleVersion`, `N_sd = N_rec`; they differ only when several rule versions or corrections coexist, which are never pooled |
| **Completed outcomes** `N_c(h)` | Stock-days in *C* whose OD1 outcome for horizon *h* has status `complete` (class ∈ confirmed, partial, failed, reversal, sideways) |
| **Unavailable outcomes** `N_u(h)` | Stock-days with a resolved status `unavailable` (Inconclusive, with reason: insufficient-history, no-bar, discontinuity) |
| **Pending outcomes** `N_p(h)` | Stock-days with no outcome record yet (window not elapsed or archives unresolved) |
| Identity | `N_sd = N_c + N_u + N_p` |
| **Outcome coverage** `Cov(h)` | `N_c / (N_c + N_u)` — the share of resolved stock-days that produced a usable outcome; reported with `N_p` |

**Headline shares** (each horizon on its own; never combined across horizons):

```
ConfirmedShare(h, C) = N_confirmed(h) / N_c(h)
AdverseShare(h, C)   = ( N_failed(h) + N_reversal(h) ) / N_c(h)
```
Partial and Sideways shares use the same denominator, so the five shares sum to 100% of `N_c(h)`. Missing outcomes are never counted as failures or successes; `N_u` and `N_p` are reported beside every percentage. Every printed percentage carries its numerator, `N_c`, `Cov`, `N_u` and `N_p`, e.g. `26.3% (980 of 3,720; coverage 95.1%; unavailable 190; pending 90)`.

**Cohorts.** Direction cohorts are **gainers** and **losers**, always reported side by side; there is no pooled headline. The primary cohort is the union of all lists for a direction (each stock-day counted once). Further cohorts are the list cohorts (top-20 gainers = `{gainer, rank ≤ 20}`, gainer pool = `{gainer, rank ≤ 50}`, losers likewise, and the unusual-volume list split by direction), each counting a stock-day once; cohorts may overlap, but a stock-day appears at most once within any cohort. Model-conditional cohorts (Setup, Evidence, score bands) exist only after unblinding. A pooled gainers-plus-losers row, if shown at all, is secondary, labelled descriptive and printed only next to both directional rows.

**Worked example (all numbers illustrative).** Cohort: gainers, union of lists, a period with 4,000 unique stock-days. A stock that was gainer-rank 12 and volume-rank 3 on one date is one of the 4,000.

| 1-session | Value |
|---|---|
| `N_sd` | 4,000 |
| `N_c` / `N_u` / `N_p` | 3,720 / 190 / 90 (3,720 + 190 + 90 = 4,000) |
| `Cov` | 3,720 / (3,720 + 190) = 95.1% |
| confirmed / partial / failed / reversal / sideways | 980 / 1,300 / 700 / 300 / 440 (sum 3,720) |
| **Confirmed share** | 980 / 3,720 = **26.3%** (n = 3,720) |
| **Adverse share** | (700 + 300) / 3,720 = **26.9%** (n = 3,720) |

The 5-session table is separate, with its own `N_c`, `N_u`, `N_p`, coverage and shares (for example `N_c = 3,540`, `N_u = 250`, `N_p = 210`). The two tables are never merged.

**Freeze.** These definitions are written into `protocol/od1.json`; they cannot change after the first live outcome is examined. Confirmed is not a probability, a predictive confidence or a profitable trading signal.

### 15.7 Statement of meaning and sensitivity

OD1 is a deterministic, versioned description of what a stock's price did over the 1 or 5 sessions after a classification date, measured against a volatility-scaled materiality band fixed from information available at the classification date. It says nothing about why a stock moved. Shares are meaningful only against the same-definition base rate of all top movers, and for the holdout only after authorised unblinding.

Sensitivity (label-agnostic, share of all observations including ≈ 7% Inconclusive; `ε = k·σ·√h`):

| Cell | k | Confirmed | Partial | Failed | Reversal | Sideways |
|---|---|---|---|---|---|---|
| h=1 gainers | 0.25 | 29.5% | 18.7% | 30.6% | 10.1% | 4.0% |
| | **0.50** | **24.6%** | 28.2% | 22.5% | 9.4% | 8.4% |
| | 0.75 | 19.9% | 35.8% | 15.8% | 8.5% | 12.9% |
| | 1.00 | 15.9% | 42.2% | 10.4% | 7.2% | 17.2% |
| h=1 losers | 0.25 | 34.0% | 20.8% | 21.5% | 13.1% | 3.2% |
| | **0.50** | **26.6%** | 32.7% | 14.4% | 11.8% | 7.1% |
| | 0.75 | 19.9% | 42.2% | 9.1% | 10.5% | 10.9% |
| | 1.00 | 14.6% | 49.3% | 5.6% | 8.9% | 14.1% |
| h=5 gainers | 0.25 | 31.9% | 18.0% | 11.3% | 29.7% | 1.8% |
| | **0.50** | **26.2%** | 30.2% | 6.6% | 25.5% | 4.1% |
| | 0.75 | 20.4% | 41.4% | 3.5% | 20.2% | 7.3% |
| | 1.00 | 15.5% | 50.3% | 2.0% | 14.8% | 10.1% |
| h=5 losers | 0.25 | 35.9% | 21.5% | 5.5% | 28.1% | 1.3% |
| | **0.50** | **27.2%** | 36.7% | 2.5% | 23.0% | 2.9% |
| | 0.75 | 20.0% | 48.3% | 1.1% | 18.1% | 4.9% |
| | 1.00 | 14.1% | 57.4% | 0.5% | 13.7% | 6.6% |

Typical band at k = 0.5: σ median 2.30%, ε₁ median 1.15% (p10 0.69%, p90 1.91%); the floor never binds. The response to k is smooth. Fixed 0.5%, 1% and 2% thresholds treat quiet and volatile stocks alike (at h=5 a fixed 0.5–1% leaves at most 1.3% Sideways and about 30% Reversal). σ is measured before the event: the mean next-day move of top movers is 0.94σ against 0.80σ for i.i.d. normal moves, so the band understates post-event noise and absolute class shares are somewhat inflated (comparisons with the same-definition base rate are unaffected). OD1 is symmetric in form for gainers and losers but not in outcome distribution (drift, skew, price bands).

---

## 16. Live holdout protection (D11)

- **Holdout start:** the first date with a `live` receipt.
- **Live session:** a session date whose daily file is valid and whose receipt has `class = "live"`. `live-late`, `unverified`, `replay`, blocked, missed, `source-revised` and anomalous dates are not live sessions (a `source-revised` date can be considered again only through a type B source-revision acceptance; a session whose immutable records were modified can never be restored, acknowledged or not).
- **Completed live session:** a live session for which **every prediction in its file** has OD1 outcome records for **both h = 1 and h = 5**, each with status `complete` or `unavailable` (with a recorded reason), none `pending`, and no anomaly flag on the file, receipt or outcome files. A missing or incomplete capture therefore cannot count. (Outcomes exist from Phase B onward; A1 cannot produce a completed session.)
- **Gate:** ≥ **250 completed live sessions**. 250 is a **minimum review gate**, not a guarantee of statistical significance: at roughly 6 *Momentum continuation* labels and 13 continuation-category candidates per session, detecting a 5-point difference needs on the order of 1,600+ independent observations per group.
- **Unblinding requires your explicit authorisation.** The system never unblinds on its own. The unblinding commit sets `holdout.json.status = "unblinded"`, records the verified count of completed live sessions, the number of acknowledgements and the sessions excluded because of them, and the frozen protocol hash must be unchanged.
- **Allowed before authorisation:** operational completeness monitoring (captured / missed / blocked / review-required / unverified / source-revised counts, latency, readiness results, pending/complete/unavailable counts with reasons, verification status).
- **Not available before authorisation:** model-conditional performance, hit rates, outcome summaries, returns, MFE/MAE, base-rate comparisons, confidence intervals, and any prediction-versus-actual view for live records. Analysis functions that read live outcomes throw while sealed (tested), and no model rule may be tuned from them.
- **Limits:** the repository and prices are public, so the seal prevents the system from computing or displaying performance but cannot make it unknowable; pre-registration and hashes make later claims auditable. Rule changes during the holdout run only as a new shadow `ruleVersion`.

---

## 17. Storage and growth (D14)

### 17.1 Decision

Live predictions (and later outcomes) on `main` under `public/data/ledger/live/`; replay on the orphan branch `ledger-replay`; no external database in the initial release; the growth below is accepted, subject to the triggers in §17.3. Ledger paths and the base URL come from one configuration constant so a later move to a data branch stays cheap.

### 17.2 Costs

**Original estimate (kept for the record).** Prototype on the final schema (31,746 real records over 260 sessions): 122.1 records/day, 3.94 KB/record, daily file **495 KB** raw / **81 KB** gzip; 260 daily commits repack to **20.3 MB**. The R10 digests and symbol list were estimated at +15 KB, giving ≈ 510 KB raw / ≈ 87 KB gzip, ≈ 129 MB/year.

**Measured on the A1 implementation (post-audit errata).** Ten consecutive real sessions (2026-10-15 to 2026-10-29) were captured into a scratch ledger from the committed data; nothing was written to the repository.

| Measure | Value |
|---|---|
| Records per file | 119–131 (average 123.3) |
| Raw daily file | 517,593 – 593,589 bytes, **average ≈ 550,217 bytes** |
| gzip -9 daily file | 97,551 – 106,834 bytes, **average ≈ 100,986 bytes** |
| Raw per year (252 sessions) | **≈ 138.7 MB** |
| gzip per year | **≈ 25.4 MB** |
| Git history per year | **≈ 25–26 MB — a rough estimate (gzip size x 252), not a measured pack size** |

*Representativeness.* The sample covers **October 2026 only** (a single month, largely one market regime); it is not a long-term or multi-regime sample, so the yearly figures carry at least the ±7% spread seen between these ten days and an unquantified regime effect.

*Why it exceeds the original 129 MB/year.* About 518 KB of the average file is predictions: ≈ 4.2 KB per record against the prototype's 3.94 KB (+6–7%); the final implemented record is larger than the prototype, and I have not isolated which fields account for the difference. The non-prediction header measured ≈ 32 KB (input digests 11.9 KB, symbol list 7.6 KB, settings/rules 2.3 KB, readiness 3.0 KB, rule-file hashes 2.6 KB, other ≈ 5 KB), against the +15 KB allowed for digests and symbols (they measure 19.5 KB). Receipts (≈ 2 KB each), `ledger-state.json` (≈ 20 KB at ten dates, growing roughly 0.8 KB per date) and the protocol files add under 1 MB/year raw and are **not** in the sample. The original per-year figure used 510 KB per file; the measured average is 550 KB.

*Raw deployed data, transfer size and Git history are separate.* Raw bytes are what GitHub Pages stores and serves; gzip is the transfer size; Git history stores compressed deltas of every daily commit.

*Existing repository baseline — discrepancy, not resolved.* This document assumed "today ≈ 46 MB in `public/data`". Measured on the working tree at the time of the audit: the six market-data JSON files total **23.5 MB** (22.9 MB by `du`) and the Git pack is 6.8 MiB. I could not reproduce 46 MB and do not know its measurement basis, so neither value replaces the other; both are shown.

| | Original | Re-estimate, baseline 46 MB | Re-estimate, baseline 23.5 MB |
|---|---|---|---|
| A1 predictions, 1 year, raw (working tree / Pages) | ≈ 129 MB | ≈ 139 MB | ≈ 139 MB |
| A1 predictions, 3 years, raw | ≈ 386 MB | ≈ 416 MB | ≈ 416 MB |
| A1 predictions, 1 year, gzip | ≈ 22 MB | ≈ 25 MB | ≈ 25 MB |
| A1 predictions, Git history, 1 year (rough) | ≈ 21 MB | ≈ 25–26 MB | ≈ 25–26 MB |
| Deployed site, 1 year | ≈ 175 MB | ≈ 185 MB | ≈ 162 MB |
| Deployed site, 3 years | ≈ 432 MB | ≈ 462 MB | ≈ 440 MB |
| Year the 500 MB trigger is reached, without outcomes | ≈ 3.5 | ≈ 3.3 | ≈ 3.4 |
| Year the 500 MB trigger is reached, with outcomes | ≈ 2.6 | ≈ 2.5 | ≈ 2.6 |

The outcome figure (**+≈ 43 MB raw and ≈ 6 MB history per year**) is a Phase B estimate, still **unverified**. With outcomes the trigger year solves 46 + (138.7 + 43) y = 500 (baseline 46 MB) or 23.5 + (138.7 + 43) y = 500 (baseline 23.5 MB). The 500 MB review trigger itself is **unchanged**. GitHub Pages' published-site limit is 1 GB; the deployed site stays below it for the three-year horizon on every row above. The largest single file is ≈ 0.6 MB (GitHub warns at 50 MB).

---

### 17.3 Review triggers (measurable) and how they are monitored

| Trigger | Threshold | Baseline today | Measured by |
|---|---|---|---|
| Deployed site (`dist`, uncompressed) | > 500 MB | ≈ 46 MB | `ledger-state.metrics.publicDataBytes` (and the build output size in the deployment-path test) |
| `main` full clone | > 250 MB | ≈ 7 MB | repository `size` field from the public repository API |
| `main` working tree | > 600 MB | ≈ 60 MB | `metrics.ledgerBytes` + `publicDataBytes` |
| Single `deploy.yml` run | > 10 min | 0.7–1.2 min | public Actions API run durations |
| Routine `update-data.yml` run (no backfill) | > 10 min | 0.3–1.4 min | public Actions API run durations |
| Capture step duration | > 5 min | not yet measured | `metrics.captureSeconds` |
| Any single ledger file | > 5 MB | max ≈ 0.6 MB | `metrics.dailyFileBytes` |

The watchdog evaluates these values and opens a `ledger-capacity` Issue when one is met. **Response ladder:** (1) prune old days from the Pages artifact at build time (they stay in Git); (2) move live data to a data branch (cost: a second checkout and push loop and a deploy that assembles two branches, about a day plus tests; blobs already on `main` stay in its history); (3) only then consider an external store (needs credentials; conflicts with the current constraint).

---

## 18. Deferred items, testing plan and known limitations

### 18.1 Deferred — completeness panel (D12)

Not implemented. Future scope (Phase D): a read-only status strip showing per date `recorded / review-required / missed / blocked / unverified / source-revised / anomaly`, capture latency and slot, readiness results, live sessions elapsed versus captured, and later pending/complete/unavailable outcome counts with reasons. It shows no returns, rates or distributions while the holdout is sealed.

### 18.2 Deferred — filing metadata (D13)

Not captured in A1; the A1 schema contains no filing identifier or field. Intended future rules: compact fields only (`id`, `symbol`, `category`, `publishedAt`, `retrievedAt`, `source`, `availableAtPrediction`); neutral naming (**"filings published in the window"**, never "catalyst", "driver" or "reason"); two clocks (NSE `publishedAt`, our `retrievedAt`); filings after capture appear only in outcome-side context; a coverage percentage so "no filing recorded" differs from "not covered"; never used in scoring; no causal claims. The existing Daily Movers wording ("Exchange filings and catalysts", "Why it can matter") should be reviewed in Phase D; it was not changed.

### 18.3 Test plan (all in `tests/ledger/**`, run only in `ledger-governance.yml`)

| Area | Test |
|---|---|
| Record schema | Fixture day → header and records with every §6 field; golden file; no outcome or filing field |
| Parity with the app | Record values equal the `MomentumCandidate` values |
| Settings representation | Proxy audit equals `settingsReadByMomentum`; changing each of the 11 leaves changes the recorded configuration |
| Explicit defaults | A deliberately altered "user" settings object never reaches the ledger |
| Rule-version hash | Stable; formatting/comment edits unchanged; threshold/operator edits change it; import-graph list equals the recomputed graph; golden pinned |
| Literal-constant parity | Ledger copies equal source values |
| Create-only and duplicates | Second run identical bytes; differing bytes ⇒ `anomaly`; same (date, symbol, version) once; new version coexists; corrections are new files |
| List membership | A stock on two lists keeps both ranks and classifications; top-20 reconstructs exactly |
| Truncation invariance | Identical bytes whether or not later bars exist |
| Readiness | Each of R1–R9 failing ⇒ no file, correct status and reasons; R5 first/second snapshot, refresh, invalid baseline, replay ignored; R9 counts 0/1/2 around the margin; R10 normal/abnormal/vacuous/removed-symbol; R11 historical, synthetic and legitimate-mover cases |
| Publication classification | Fake activity-API responses and a fake calendar: `live`, `live-late`, `unverified` (no record, API error, contradictory times, wrong ancestry, commit not on `main`, unresolved calendar); committer date and run times alone never yield `live`; holiday moves the cut-off; override file honoured; `unverified` never becomes `live` without evidence |
| Atomicity and recovery | Crash after `.partial`, after rename, before state update; re-run converges |
| Guard | Temp Git repo: modification, deletion, rename of any protected file fails; additions pass; invalid file fails; exemption listed; `holdout.json` transitions |
| Watchdog logic | Missed / at-risk, holiday classification mirroring `reconcileDate`, issue dedupe and close, capacity triggers |
| Deployment path | `vite build` with the production base; files present, identical and parseable under `dist` |
| Replay isolation (A2) | Written only to the replay layout; refused on/after `holdout.startDate`; never an R5 baseline |
| Outcomes and denominators (Phase B+) | Boundary tests at ±ε_h; partition completeness; mirror symmetry; `N_sd = N_c + N_u + N_p`; one stock-day on two lists counted once per cohort; no pooling across horizons or directions; sealed analysis throws |
| Regression | The existing 302 tests unchanged and passing; scoring outputs on the real-data fixture pinned |

### 18.4 Known limitations

1. **Survivorship and membership:** current lists applied to the past; size segment is a proxy.
2. **Unadjusted prices:** undetected small bonuses, rights issues and dividends contaminate returns; ≥ 15% gap-downs are ambiguous.
3. **Price bands / circuit limits** are not modelled.
4. **Short history, one regime:** about 14 months, largely bearish-to-sideways.
5. **Sample size:** about 1–1.5 years of live data before a 5-point difference is detectable for the label alone.
6. **Clustering and overlap:** same-day candidates are correlated and windows overlap; intervals are clustered and effective sample size is dates.
7. **Multiple comparisons:** only the pre-registered list is corrected; everything else is exploratory.
8. **Outcome definitions are judgement calls** (k, √h, N, E); σ is measured before the event and 20 observations is noisy.
9. **Settings drift:** the page uses each user's Settings; the ledger only defaults.
10. **Timestamps:** the activity-API token path and retention are unverified; the trust model is not adversarial proof. NSE hours are taken from NSE's published schedule, not verified here.
11. **Weekend special sessions** are invisible to the pipeline (§8.4).
12. **Scheduling lag** (3.7–7.7 h observed for one slot; the other three unobserved) limits the live window (§9).
13. **Rule-hash fragility:** parser-version dependence and conservative renames (§5.4).
14. **R9/R11 thresholds rest on a history with no corruption case;** they are conservative defaults, not calibrated detectors.
15. **R10 sees drift only inside the 365-day window of the last 10 captured sessions.**
16. **Git immutability is conventional;** the public repository means the holdout seal is procedural.
17. **GitHub semantics not verified here:** repository-settings wording and the activity endpoint's documented retention.

---

## 19. Final A1 Readiness Checklist

Status key: **V** = Defined and verified (I checked the relevant source, test, data or workflow) · **D** = Defined but not implemented · **B** = Blocked by unresolved decision.

| # | Item | Status | What was checked / what remains |
|---|---|---|---|
| 1 | Exact daily record schema | **V** | §6.4 generated from 31,746 real records by the application's own code; types from the run. |
| 2 | Exact daily header schema | **D** | §6.3. Source fields verified (manifest, refresh-state, constituents; R10 digests computed on Git history). `GITHUB_*` environment fields cannot be exercised locally. |
| 3 | Exact effective settings captured | **V** | §4: Proxy audit (11 of 15 leaves read); all constants printed from the modules. |
| 4 | Exact source-data and manifest metadata | **V** | §4.3, §6.3: key sets checked against the committed files. |
| 5 | Exact rule-version hash procedure | **V** | §5: import graph computed (22 files); prototype invariance/sensitivity. Limitation: one TypeScript version tested. |
| 6 | Exact live vs live-late timestamp procedure | **D** | §8: activity-API push timestamps verified on 30 real pushes and compared with committer dates and run times. Not verified: `GITHUB_TOKEN` access to the endpoint, retention; the A1 acceptance test must show at least one `live` receipt. |
| 7 | Exact readiness thresholds | **V** | R3 (coverage 1.000), R4 (min 701 / median 741), R5a (501/254/150/251 within ±5% of 500/250/150/250), R9 (276 sessions, margin 1) checked on committed data. |
| 8 | Exact R9 and R10 checks | **V** | R9 evaluated on 276 sessions with options compared; R10 digests computed across real commits (one digest 10-26 → 10-29; four distinct earlier). Implementation pending. |
| 9 | Exact daily file naming convention | **V** | §6.1: path unused, not git-ignored, Vite copies `public/`, base path and URL construction verified, `.json` gzip verified on six live files; ledger headers verified only after the first deploy. |
| 10 | Exact create-only and immutability rules | **D** | §6.1, §12.2. Verified: `main` currently has **no** branch protection or rulesets (§20.3), so that setting is a prerequisite. |
| 11 | Exact governance test workflow | **D** | §12.1. Verified: both workflows run `npm run test`; Vitest `include` would pick up a new directory; `GITHUB_TOKEN` pushes do not trigger `push` workflows. |
| 12 | Exact capture workflow integration | **D** | §11.1. Verified: step order, `permissions: contents: write`, `concurrency: update-data`, `continue-on-error` precedent, deploy-after-failure. Needs `actions: read`. |
| 13 | Exact failure and retry behaviour | **D** | §11.2 with the approved schedule (§9). Verified: observed scheduling delays and arithmetic; the other three slots' delays are unobserved until they run. |
| 14 | Exact handling of missing or incomplete source data | **V** | §10.6 maps every condition to a check; R1–R11 evaluated against 296 sessions with no false positives. |
| 15 | A1 does not calculate outcomes or run replay | **V** | §2; the A1 schema contains no outcome field; no A1 component depends on outcome or replay code. |

**Tally: Defined and verified = 9 (items 1, 3, 4, 5, 7, 8, 9, 14, 15); Defined but not implemented = 6 (items 2, 6, 10, 11, 12, 13); Blocked = 0. 9 + 6 + 0 = 15.**

---

## 20. Open items and manual repository settings

### 20.1 Blockers

**None.** B1–B6 are resolved (§1.3). The remaining risks are accepted limitations (§18.4) and implementation-time verifications (checklist items 6 and 9).

### 20.2 Choices I made within your delegated scope

1. R9 margin **median + 1** (§10.2) — the smallest with zero historical false positives; the data cannot distinguish margins 1–5.
2. R5 **nominal index sizes** as the bootstrap baseline and the previous live-capture snapshot thereafter (§10.4).
3. R10 per-symbol 365-day digests, non-blocking for new captures, the past session flagged `source-revised` (§10.3).
4. R11 review flag at **3** break-starts or 3 sharing a ratio; never blocking (§10.5).
5. Headline denominator **completed outcomes only**, per unique stock-day, directions kept separate (§15.6).
6. Publication evidence = GitHub repository-activity push event; anything else ⇒ `unverified` (§8).
7. The existing 02:30 UTC Tuesday–Saturday run is retained (§9.1).
8. All new ledger tests run only in the governance workflow (§12.1).
9. The token-stream hash covers 22 files including five type-only files (§5.1).

### 20.3 Repository settings you must change manually

Verified current state: `main` is **not protected** (`protected: false`, no rulesets); the repository is public; Issues are enabled.

1. **Ruleset or branch protection on `main`:** enable **"Block force pushes"** and **"Restrict deletions"**. **Do not** enable "Require a pull request", "Require status checks" or "Restrict who can push" — they would block the scheduled bot commits, which push directly to `main` with `GITHUB_TOKEN`. *Prerequisite for A1 going live.*
2. **Actions → General → Workflow permissions:** default token read-only; leave pull-request approval by Actions off (workflows declare their own permissions). *Current value could not be read without admin access.*
3. **Notifications:** enable email for failed workflow runs.
4. **Labels** `ledger`, `ledger-review`, `ledger-lost-session`, `ledger-capacity` (the watchdog may create them; it has `issues: write`).
5. **When A2 starts:** apply the same force-push and deletion protection to the `ledger-replay` branch.
6. **Optional:** a tag ruleset protecting `ledger-*` and `raw-archive-*` tags.

I could not verify the wording of GitHub's settings screens from here; the effect to achieve is what is stated.

### 20.4 Readiness verdict

The design has no blocked item. It is ready for the A1 implementation prompt **once you accept §20.2 and enable §20.3 item 1**. The A1 acceptance test must also prove, on the first real run, that (a) a `live` receipt is produced (publication evidence reachable from the Actions token), (b) the ledger JSON is served as `application/json` with gzip, and (c) the first deployed daily file matches the schema in §6.
