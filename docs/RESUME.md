# RESUME — self-contained handover (read this first)

> Written 2026-11-24 ~06:20 UTC before a Mac restart. A new Claude Code session must be able to continue from this file
> alone, without the previous conversation. **Evidence beats this file:** verify Git and the filesystem first (§3),
> and update this file and `docs/PROJECT_STATUS.md` after every meaningful milestone. Do not repeat completed research,
> audits or downloads (§19).

## 1. Project objective
Personal NSE research platform (owner-only website). Primary objective: **prediction accuracy and understanding stock
behaviour**, especially *Daily Movers & Continuation → Setup: Possible breakout setup* and *Continuation
characteristics*. Priorities: ~45% prediction accuracy, 25% historical research, 20% live outcome evaluation, 8%
reliability, 2% security/governance. Discover what works; do not defend the current logic.

## 2. Repository
- Local: `/Users/santhosh/Desktop/my-projects/trade/Sector-Dashboard` · Remote: `sanoramv/Sector-Dashboard` (`main`)
- Website: https://sanoramv.github.io/Sector-Dashboard/ (GitHub Pages; data refreshed by `update-data.yml`)
- Git identity: `Santhosh Ram V <santhoshramv@yahoo.com>` only. Never force-push, rebase or amend.

## 3. Git state at handover (verify with `git status`, `git log --oneline origin/main..HEAD`, `git fetch`)
- Branch `main`. `origin/main` = `1596276` (EPIPE hotfix, pushed and green 2026-11-24 04:24 UTC).
- Local commits NOT yet pushed (publication APPROVED, see §8), oldest first:
  `7d7abab`, `51a9404`, `7b1fe81`, `e5ba9a6`, `b695f6f`, `9c34a16`, `f1b0bb9`, `a1b58f5`, plus the pre-restart commit
  "docs: pre-restart handover…" (CLAUDE.md, PROJECT_STATUS.md, RESUME.md, downloader resume fix).
- Expected working tree after that commit: clean. Git-ignored and expected: `research-data/` (raw archives),
  `node_modules/`, `dist/`, `.claude/`, `*.tsbuildinfo`.
- Automated data commits by `github-actions[bot]` ("chore: scheduled NSE sector data update") will appear on
  `origin/main`; they touch only `public/data/**` and, after the push, `data/outcomes/**` and `public/data/evaluation/**`.

## 4. Local commits awaiting publication
| SHA | What |
|---|---|
| `7d7abab` | research: pre-declared plan for the breakout characteristics study |
| `51a9404` | research: study results (experiments 1–4), `scripts/research/breakout-characteristics.mts` |
| `7b1fe81` | evaluation policy (continuous monitoring), erratum 23. **Also contains the B2a module deletions (scoping slip): does not build alone. Accepted; do not rewrite history.** |
| `e5ba9a6` | live OD1 outcome processing (`npm run ledger:outcomes`), update-data.yml step, guard checks |
| `b695f6f` | catch-up outcomes: 2026-11-19 h1+h2, 2026-11-20 h1 |
| `9c34a16` | research: historical reference export for the dashboard |
| `f1b0bb9` | website: Evaluation tab |
| `a1b58f5` | research: historical NSE downloader + `docs/research/HISTORICAL_DATA.md` |

## 5. Working-tree changes
None expected after the pre-restart commit. If `docs/PROJECT_STATUS.md` or this file show as modified, a later session
updated them: keep the newer version.

## 6. Completed milestones (do not redo)
- Momentum Ledger live since 2026-11-18 with rule `mv1-8ecef864`; daily prediction records + receipts.
- Phase 1B breakout baseline (`docs/research/BREAKOUT_BASELINE.md`), digest `568512f8…5795`.
- OD1 shared engine (`scripts/ledger/od1.mts`), sealed protocol `public/data/ledger/protocol/od1.json`.
- B2a private pipeline and its security hardening/audits: done and then **retired** (do not revisit).
- Strategic reset (2026-11-24): Option B continuous monitoring, B2b cancelled.
- Experiments 1–4 (Track A) on 2025-08-26 → 2026-11-17: `docs/research/BREAKOUT_CHARACTERISTICS.md`.
- Live outcome engine, catch-up, Evaluation tab (Track B), checked in a browser (no console errors).
- Historical downloader and source survey (Track C); 5-year download about half done (§10).

## 7. Current research findings (EXPLORATORY: in-sample, one ~15-month period already examined)
Source: `docs/research/BREAKOUT_CHARACTERISTICS.md` §2 (tables with intervals). OD1 adverse = Failed + Reversal.
1. **Top-50 restriction:** no measurable benefit or harm (top-50 minus outside, h1 adverse +2.8 pp [−3.1, +7.8]); it
   discards a third of breakouts. Harm concentrates in day change ≥ 10% (all top-50).
2. **Close-location and volume conditions** cut signal frequency ~2.5× without better outcomes. "Close above the prior
   60-session high" alone (15.6/session) did as well or better (h10 benchmark-relative +0.99% [0.16, 1.99]).
3. **Only the bearish-regime effect survives FDR** (+16.4 pp adverse at h1), and it is **market-wide**: every gainer
   group is worse in bearish sessions; breakouts are not worse than same-day, same-size gainers.
4. **Day change ≥ 10%** is worse (h1 adverse 54%): suggestive only (fails FDR).
5. **Evidence score** mostly reflects the session (market component) and the completed move; stock-specific value small.
6. Consolidation flag fires on 1 of 1,363 breakouts (inert). Leading sectors (RS ≥ 3 pp) did worse.
7. **Nothing is tradable at 20 bps on average** (entry next open, exit close at h) at any horizon.
Limitations: one period, few early breakouts, survivorship (current index lists), unadjusted prices, regimes cluster.

## 8. Owner approvals (2026-11-24; details in PROJECT_STATUS.md §H)
- Publish the 8 commits (+ pre-restart commit) after final validation, one normal push.
- Continuous live outcome evaluation and the Evaluation dashboard.
- Shadow capture of BO-wide, BO-raw, BO-cap10 (implement, test, commit locally; **release recommendation before
  publishing**).
- `mv1-8ecef864` stays the production benchmark. **Replacing mv1 logic is NOT approved.**
- Five-year historical acquisition + research; ten-year expansion from reliable free sources (no paid services).
- Routine technical decisions, implementation, testing and ordinary commits are delegated.
- Security only proportionate (credential safety, data integrity, reliability). No broad security audits.

## 9. Outstanding tasks (priority order) — Part B of the owner's plan
1. **B1 Resume and synchronise:** read CLAUDE.md, PROJECT_STATUS.md, this file; verify Git/filesystem; resume the
   download (§11) in the background; `git fetch`; integrate bot data commits with an ordinary merge
   (`git merge origin/main`); stop on unexpected changes or conflicts.
2. **B2 Publish:** full validation (§12) on the merged state, plus checks: prediction logic unchanged
   (`git diff 1596276 HEAD -- src/lib/momentum src/lib/calculations` empty), prediction records unchanged
   (`git diff 1596276 HEAD -- public/data/ledger/live/predictions public/data/ledger/live/receipts` shows only bot
   additions), 18 Nov excluded (policy + guard output), outcome step `continue-on-error` in `update-data.yml`, outcome
   failures visible (step outcome / guard), no `research-data/` tracked (`git ls-files research-data` empty). Then
   `git push origin main`. Verify governance, guard and Pages deploy (GitHub API `actions/runs?head_sha=`). The first
   scheduled outcome run happens with the next data update: record as PENDING, do not wait idly.
3. **B3 Shadow predictions** (§15): pre-declare definitions, version ids and promotion criteria in a committed doc
   BEFORE any capture; implement capture beside mv1 (separate files, separate versions, production labels untouched);
   evaluate h = 1, 2, 5, 10 vs mv1 on the same sessions; mark as experimental on the website; test; commit locally;
   release recommendation to the owner before publishing.
4. **B4 Complete and validate the 5-year data** (§10): file integrity, session coverage vs NIFTY 500 file, duplicate
   dates (33 stock files without an index file), the 2022-08-08 error, security identifiers/series, corporate actions
   from `PREV_CLOSE`, benchmark availability, a turnover-rank universe (do NOT call it historical NIFTY 500
   membership), delisted stocks, liquidity/eligibility rules.
5. **B5 Independent historical validation:** BEFORE looking at any result from 2020-11 → 2025-08, commit a frozen plan
   (candidates, hypotheses = the 6 findings in §7, metrics, eligibility, block bootstrap, BH-FDR, comparison groups).
   Then run the existing experiments on that period. Keep three datasets distinct: (a) examined 2025-08 → 2026-11,
   (b) new validation 2020-11 → 2025-08, (c) prospective shadow/live. Never tune on (b) and call it validation. Report
   all four horizons and net tradable returns after costs; report negative results plainly.
6. **B6 Ten-year expansion:** parser for the older formats (`cmDDMONYYYYbhav.csv.zip` + `MTO_DDMMYYYY.DAT`), validate on
   samples before bulk download, then extend to 2016 (see `docs/research/HISTORICAL_DATA.md`).
7. **B7 Continue independently;** update PROJECT_STATUS.md and this file after each milestone.
Routine checks: 24 Nov evening capture after ~01:30 UTC 25 Nov; the first production outcome-step run after the push.

## 10. Historical downloader state (paused safely 2026-11-24 06:08 UTC)
- Script: `scripts/research/fetch-history.mts` (resume-safe: atomic writes, manifest skip, recovery of unrecorded files).
- Source: official NSE archives — stock `products/content/sec_bhavdata_full_DDMMYYYY.csv`, index
  `content/indices/ind_close_all_DDMMYYYY.csv` (https://nsearchives.nseindia.com, the same host production uses).
- Target range: 2020-11-02 → 2025-08-22 (joins the 2025-08-25 start of the production data).
- Storage: `research-data/nse/<kind>/<YYYY>/<YYYY-MM-DD>.csv.gz`, manifest `research-data/nse/manifest.jsonl`, log
  `research-data/fetch-2020-2025.log`. ~61 MB at pause. Git-ignored; never commit.
- Progress at pause: last date 2023-06-01; 1,311 files valid (672 stock, 639 index; gunzip + sha256 verified, 0
  partial, 0 mismatches); index "missing" 35, stock "missing" 1 (2022-08-09), stock "error" 1 (2022-08-08, retried on
  resume). Remaining: 2023-06-02 → 2025-08-22, ≈ 580 weekdays × 2 files, ≈ 30–40 minutes.
- The process was stopped (SIGTERM); nothing is running.

## 11. Resume the download (skips everything already done; safe to stop and re-run)
```bash
cd /Users/santhosh/Desktop/my-projects/trade/Sector-Dashboard
npx tsx scripts/research/fetch-history.mts --from 2020-11-02 --to 2025-08-22 >> research-data/fetch-2020-2025.log 2>&1
```
Run it in the background. Progress: `tail -1 research-data/nse/manifest.jsonl`.

## 12. Tests and validation
```bash
npm run -s test:ledger                                      # ledger suite (368 at handover)
npm test                                                    # app suite (306); gates the scheduled data commit
npx vitest run --config vitest.research.config.ts           # research suite (33)
npm run -s typecheck                                        # app + tests
npx tsc -p tsconfig.node.json --noEmit                      # scripts
npm run -s ledger:guard                                     # expect 0 violations; 18 Nov excluded
npx tsx scripts/research/breakout-baseline.mts | grep "result digest"
npx tsx --eval 'import("./scripts/ledger/capture.mts").then(async (m) => console.log((await m.computeVersion(process.cwd())).ruleVersion))'
npm run -s build                                            # production build
npx tsx scripts/research/breakout-characteristics.mts --out /tmp/bc.json   # study (~20 s); reproduces §7
npm run ledger:outcomes                                     # live outcome processing (idempotent)
```

## 13. Expected baseline digest
`568512f87ac1b2be62b404b88fe7ff0ddb1a2cf2e22adab11b2c3f0212a35795` (Phase 1B). `od1.json` sha256 `916b6636…1fd8`,
`holdout.json` sha256 `ea9ecc1d…6e58` (both must stay unchanged).

## 14. Production rule version
`mv1-8ecef864` (frozen benchmark, live since 2026-11-18). Engine version at handover `od1e-a3dcb82a`. Evaluation
policy: `public/data/ledger/protocol/evaluation-policy.json` (continuous monitoring since 2026-11-24; outcomes from
2026-11-19; 2026-11-18 excluded) and `docs/design/EVALUATION_POLICY.md`.

## 15. Experimental (shadow) prediction definitions — source: `docs/research/BREAKOUT_CHARACTERISTICS.md` §2.7
Exact committed text:
1. **BO-wide:** breakout conditions at any rank (drop the top-50 requirement).
2. **BO-raw:** close above the prior 60-session high with no close or volume condition, still excluding day change
   ≥ 10% and ≥ 7% above the old high.
3. **BO-cap10:** production breakout excluding day change ≥ 10%.
Interpretation that matches the study code (`scripts/research/breakout-characteristics.mts`): the population is every
eligible universe gainer (positive change, not starting a price discontinuity), any rank. "Breakout conditions" =
the mv1 `possible-breakout` label rules (`src/lib/momentum/classify.ts`). BO-raw's base is the study's `RAW_BO`
group (`patterns.breakoutToday === true`, resistance = highest high of the prior 60 sessions), then minus
`changePct ≥ 10` and minus `distance above resistance ≥ 7%`. **Open points not fixed by the committed text** (decide
and write down in the shadow pre-declaration doc BEFORE capture, without looking at new outcomes): whether BO-raw
keeps mv1's insufficient-evidence and extended gates (the study's RAW_BO had neither); the version-id scheme.
Do not infer other thresholds.

## 16. Read before continuing
`CLAUDE.md` · this file · `docs/PROJECT_STATUS.md` · `docs/research/BREAKOUT_CHARACTERISTICS.md` ·
`docs/research/HISTORICAL_DATA.md` · `docs/design/EVALUATION_POLICY.md` · `docs/research/BREAKOUT_BASELINE.md` (§13
hypotheses H1–H3) · `scripts/research/breakout-characteristics.mts` · `scripts/ledger/outcome-process.mts` ·
`src/lib/momentum/classify.ts` and `assess.ts` (mv1 rules).

## 17. Known limitations and risks
- Research findings are exploratory (one examined period); only prospective shadow results and the new 2020–2025
  period can validate them.
- Historical index membership and industry history are not in the NSE archives: a turnover-rank universe is a
  substitute, not NIFTY 500 membership.
- Outcome records grow ~0.5 MB per session in `data/outcomes/`; the dashboard summary ~45 KB per session (split by
  month if it becomes slow).
- The outcome step is `continue-on-error`: a failure is visible as a failed step in the data-update run and as guard
  findings, but does not stop data updates. Check it after the push.
- `npm test` gates the scheduled data commit: never add slow or data-dependent tests to it.
- Pre-existing: 94 open false "Ledger snapshot missing" issues (closing needs approval); weekly false "capture is
  stale" watchdog issue on Mondays; 19 old commits with a non-personal email (history cannot be rewritten).

## 18. Exact next implementation action
Verify state (§3), resume the download in the background (§11), `git fetch` + ordinary merge of bot data commits,
run §12 validation and the B2 checks (§9 item 2), then `git push origin main` and verify the three workflows.

## 19. Do not repeat
Experiments 1–4 on 2025-08 → 2026-11, the strategic reset, B2a work/audits/hardening, the EPIPE fix, the source
survey, and already-downloaded archive dates are DONE. Re-run them only if code or data changed, and say why.

## 20. Checklist (update as work progresses: `[x]` + date/SHA)
- [x] Experiments 1–4 (`51a9404`)
- [x] Evaluation policy, outcome engine, catch-up, dashboard (`7b1fe81`…`f1b0bb9`)
- [x] Downloader + resume-safe fix; download paused at 2023-06-01
- [ ] B1 resume: state verified, download resumed, bot commits merged
- [ ] B2 validation passed and 8 (+1) commits pushed; governance / guard / deploy green
- [ ] B2 first production outcome-step run verified
- [ ] B3 shadow plan pre-declared (definitions, versions, promotion criteria) and committed
- [ ] B3 shadow capture implemented, tested, committed; release recommendation given
- [ ] B4 5-year download complete and validated (integrity, coverage, corporate actions, universe)
- [ ] B5 validation plan frozen and committed BEFORE results
- [ ] B5 independent validation run and reported (all four horizons, net returns)
- [ ] B6 older-format parser validated; 10-year data acquired
