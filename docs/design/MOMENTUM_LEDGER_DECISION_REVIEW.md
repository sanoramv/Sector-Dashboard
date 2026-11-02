# Momentum Ledger — Final Decision Review (before Phase A1)

**Status:** review only. **Nothing was implemented, committed or pushed.** No application code, scoring, tests, workflows or market data were changed and no ledger record was created. This file (and `MOMENTUM_LEDGER_DESIGN.md`) are the only additions, both uncommitted.

**How this review was done.** I re-read the whole of `MOMENTUM_LEDGER_DESIGN.md` (592 lines) and checked its claims against the code, workflows and tests. Every number below comes from (a) the design document, (b) a script I ran on the committed data, or (c) arithmetic on *illustrative* values (marked as such).

**Integrity statement for the OD1 analysis.** Every new calculation in this review (§3) is **label-agnostic**: the population is the day's top-50 gainers and top-50 losers ranked by price change alone. No Setup, Evidence, Score or factor was used, and **no model-conditional outcome was computed**. No live holdout exists yet, and nothing here was used to tune OD1 against model performance. I note once more that label-conditional *replay* results already existed in `NEXT_DAY_MOMENTUM.md` and that I re-ran that existing script in an earlier task to verify documentation; they are exploratory and did not influence OD1.

## Contents

0. [Corrections and new findings from this review](#0-corrections-and-new-findings-from-this-review)
1. [The 14 decisions, one by one](#1-the-14-decisions-one-by-one)
2. [Readiness thresholds: what "D9–D14" actually contains](#2-readiness-thresholds-what-d9d14-actually-contains)
3. [OD1 deep review](#3-od1-deep-review)
4. [Storage architecture review](#4-storage-architecture-review)
5. [Watchdog review](#5-watchdog-review)
6. [Readiness and late-capture cases](#6-readiness-and-late-capture-cases)
7. [Replay and filing metadata](#7-replay-and-filing-metadata)
8. [Final recommendation](#8-final-recommendation)

---

## 0. Corrections and new findings from this review

The review found **problems in my own Revision 2**. Several change a recommendation.

| # | Finding | Effect |
|---|---|---|
| **N1** | **D8's recommendation is self-contradictory.** It says to store replay in a *non-deployed* folder "loaded by the Tracker". A browser cannot load a file that is not deployed. | Replay needs an orphan branch plus a small *deployed* summary (§4, §7). D8 changes. |
| **N2** | **"JSONL vs line-delimited JSON" (D6) are the same format.** The only real difference in D6 is the file *extension* (`.jsonl` vs `.json`), which controls the `Content-Type` GitHub Pages sends and therefore compression. | D6 is mis-framed (§4.4). |
| **N3** | **Better layout than monthly append shards: one create-only `.json` file per trading day.** It is valid JSON, gzip is already proven for `.json`, "append-only" becomes "files are only ever *added*" (a trivial, robust guard), and writes are atomic by construction. Packed Git cost is about the same (~38 KB gzip per day). | I recommend changing §4/§8.4 and D6 (§4.4). |
| **N4** | **Test wiring would break the "must not block refresh/deploy" requirement.** `deploy.yml` runs `npm run test` before building; `update-data.yml` runs `npm run test` before committing data. A ledger test that pins a golden hash (e.g. `ruleVersion`) would fail after any legitimate scoring edit and block **both the data commit and the site deploy**. | Governance/golden tests must run in a separate workflow, not in the existing jobs (new decision D15). |
| **N5** | **The ruleVersion source-file list is wrong in two ways.** `src/config/marketCapSegments.ts` is *not* imported by the momentum path (a change there would bump the version spuriously), while `src/types/metrics.ts` (runtime `ok()`/`unavailable()`) and `src/types/dataset.ts` are. I verified the import graph. Also, hashing *emitted JavaScript* depends on the TypeScript version, so a compiler upgrade could change every hash with no behaviour change. | Hash the comment-stripped **token stream** of an import-graph-derived file list instead (D4). |
| **N6** | **The watchdog design over-privileges and mis-describes itself.** (a) `actions: write` lets it dispatch *any* workflow (no finer scope exists); alerts need only `issues: write`. (b) The design says the dashboard flags a silent watchdog via `ledger-state.updatedAt`, but a read-only watchdog never writes that file, so that check measures the *capture*, not the watchdog. (c) Holiday detection was left vague. | Alerts-only watchdog with `contents: read`, `issues: write`; retries come from extra scheduled capture runs (§5). D7/D10 change. |
| **N7** | **`createdAt` (runner clock) is not the public time.** A record written at 08:50 IST whose push lands at 09:20 IST would be labelled `live` yet become public after the open. | Define `live` using the commit that *publishes* the file, verified after the fact (D5, §6). |
| **N8** | **Immutability is only checked inside the capture job.** A human or other workflow pushing an edit to a shard would not be caught. | Add a read-only `ledger-guard` workflow on every push, plus branch protection (no force-push) (new decision D16). |
| **N9** | **The "Partial" class is not what its name suggests.** Label-agnostic analysis shows that **78–95% of Partial outcomes are cases where the intraday high/low of the prediction day was breached (condition N) with no material close** (§3.4). "Confirmed" is ≈ 91–97% identical to the single condition P (a material close in the original direction). | Keep the rules if you wish, but pre-register the **headline as Confirmed vs Adverse (Failed ∪ Reversal)**, treat Partial/Sideways as descriptive, and consider renaming Partial (D1/D2). |
| **N10** | **σ is measured before the event.** The next day's mean absolute move among top movers is **0.94σ** against 0.80σ for i.i.d. normal moves (median 0.68 vs 0.67): volatility is elevated after a big move, in the tails. A pre-event σ therefore *understates* typical next-day noise. | OD1 will classify somewhat more outcomes as "material" than a post-event σ would. It applies equally to both directions and all candidates, so it does not bias comparisons against the same-definition base rate, but absolute class shares are inflated. Disclose (§3.3). |
| **N11** | **Two operational gaps in the readiness checks:** a handful of missing stocks (e.g. a top gainer absent from the bhavcopy) passes R4 (which only catches ≥10% truncation), and nothing detects a *correction* to source data after capture. | Add R9 (record the list of stocks that had a bar yesterday but not today, with a threshold) and R10 (drift check) (§6). |
| **N12** | **Your brief refers to "readiness thresholds proposed in D9–D14".** In the document only **D9** holds thresholds. D10 is cadence/retry, D11 the completed-session definition, D12 a UI choice, D13 filing ids, D14 storage acceptance. | Mapping given in §2; nothing hidden. |
| **N13** | Of the 29,557 label-agnostic mover observations, **2,113 (7.2%) lacked σ**. I can now decompose it: **1,454 fall in the first 25 sessions of the data (warm-up)** and **659 (≈2.4% of the remaining ≈27,000) later**, median 13 comparable bars (recent listings or post-price-break stocks). Also **6.7%** of σ windows contain a single day ≥ 3.5σ (the `volWindowOutlier` flag). | Live Inconclusive-for-σ should be ≈ 2–3%, not 7%; the outlier flag will fire on about 1 in 15 outcomes. |

---

## 1. The 14 decisions, one by one

**Legend.** *Reversible after A1?* — **Yes** (cheap), **Via new version** (new schema/`od2`/`mv2` runs forward; written records never change), or **No** (written records or a pre-registered commitment cannot be revisited honestly). *Finalise before first live prediction?* — **Yes**, **Before first live outcome is examined**, or **No**. "A1" = the first release that captures live predictions (design §13.2).

---

### D1 — Sign off OD1

| | |
|---|---|
| **Document wording** | "**Sign off od1** exactly as in §9: k = 0.5, √h scaling, floor 0.20%, σ = population SD of 20 daily simple % changes before *t*, headline horizons h = 1 and 5, six-class rules, frozen in `protocol/od1.json` before A1 ships". Recommendation: "Approve (or name changes now — they cannot be made after the first live outcome is examined)". |
| **Question** | Freeze the exact outcome rules as the pre-registered classification for the live holdout? |
| **Options** | (a) Approve OD1 as drafted. (b) Approve OD1's rules but change the *pre-registered headline metrics* (see below). (c) Change a parameter (k, floor, horizons, σ window) now. (d) Simplify the rule structure (R-first partition, §3.4). |
| **Recommended** | **(b).** Keep the rules; add three clarifications to the protocol: (i) the 0.20% floor is a *constant of OD1*, independent of the selectable cost assumption; (ii) the **headline metrics are the shares of Confirmed and of Adverse (Failed ∪ Reversal)** plus mean `R_h` and `X_h`, with Partial and Sideways reported but descriptive; (iii) every headline table shows k = 0.25 / 0.5 / 1.0 side by side. |
| **Technical reason** | The rules partition every valid observation (verified by the worked examples and boundary tests planned). Finding N9 shows Partial/Sideways boundaries are dominated by the intraday-extreme condition N, so interpretation should rest on the classes that have clear meaning. |
| **Research consequences** | Fixes the primary hypotheses before data exists, avoiding a "choose the best class afterwards" degree of freedom. The k-grid exposes threshold dependence; a monotone response (§3.5) means conclusions should not hinge on k. |
| **Operational consequences** | `protocol/od1.json` plus its hash in `holdout.json` ship with A1. Outcome lines store raw OHLC measurements and booleans, so a different definition (`od2`) can be recomputed offline without touching the ledger. |
| **Risks if wrong** | A poorly chosen headline wastes ≥ 1 year of holdout; changing it after outcomes are seen is forbidden by your own rules. The pre-event σ bias (N10) inflates "material" outcomes but not comparisons to a same-definition base rate. |
| **Reversible after A1?** | **Via new version only.** `od2` can run in parallel, but OD1 remains the pre-registered headline. |
| **Before first live prediction?** | **Yes** (strictly: before the first live *outcome is examined*; since the protocol ships with A1, treat it as a pre-launch decision). |

### D2 — Keep the "N" (intraday new high/low) and market-relative "E" conditions in "Confirmed"

| | |
|---|---|
| **Document wording** | "Keep the 'N' condition (intraday new high/low) and the market-relative condition E in 'Confirmed', given they are weakly informative (§10.3), or simplify". Recommendation: "Keep; they match existing conventions and booleans are stored for later redefinition". |
| **Options** | (a) Keep both (OD1 as drafted). (b) Drop E (Confirmed = P ∧ N). (c) Drop N (Confirmed = P ∧ E). (d) Confirmed = P only, with E and N as stored flags. (e) Replace N by a close-based N′ (close beyond the prior extreme). |
| **Recommended** | **(a), with the headline restructure from D1.** |
| **Technical reason** | Measured, label-agnostic: of valid observations with condition P, Confirmed is 91% (h=1 gainers), 94% (h=1 losers), 97% (h=5 gainers), 96% (h=5 losers). E removes only 0.6–1.0 pp of P cases; N removes 0.2–2.0 pp (§3.4). Neither materially changes Confirmed, so keeping them costs nothing there. **N does, however, drive the Partial/Sideways split**: it appears in 78–95% of Partial outcomes. N′ would be a new, untested design choice. |
| **Research consequences** | "Confirmed" ≈ P (a material close in the original direction), so claims should be phrased that way. E gives a market-relative guard. Keeping N preserves continuity with the project's existing `higherHigh`/`lowerLow` outcomes. |
| **Operational consequences** | None: all booleans are stored. |
| **Risks if wrong** | Over-reading "Confirmed vs Partial" as a quality gradient. Mitigated by the headline restructure. |
| **Reversible after A1?** | **Via new version** (`od2`), but not as the headline. |
| **Before first live prediction?** | **Yes** (same freeze as D1). |

### D3 — Settings storage form

| | |
|---|---|
| **Document wording** | "**Settings storage form:** actual values in a per-day header (my proposal, ~3–4 KB/day) vs embedding the full settings in every record (~+1.5 KB × 122 records/day ≈ +45 MB/year)". Recommendation: "Per-day header". |
| **Options** | (a) Per-day header holding the actual settings, rules and constants. (b) Embed in every record. (c) Hash only (rejected by your requirement A). |
| **Recommended** | **(a).** |
| **Technical reason** | Settings are identical for all records of a day (a single deep copy of `DEFAULT_SETTINGS` is passed). Your requirement is satisfied (actual values stored, immutable, in the same file as the predictions). (b) adds ≈46 MB/year raw (1.5 KB × 122 × 252) for zero information. |
| **Research consequences** | None; each record joins to its header by `date`+`modelVersion`. With per-day files (D6 recommendation), the header and records live in the same file, so a record can never be separated from its configuration. |
| **Operational consequences** | ~3–4 KB/day. Verified by the "settings-read audit" test that the header covers every setting the momentum path actually reads (`settings.screening.*`, `settings.regime.*`). |
| **Risks if wrong** | Minimal. |
| **Reversible after A1?** | **Via new version** (`schemaVersion`); written records are immutable. |
| **Before first live prediction?** | **Yes** (schema of immutable records). |

### D4 — `ruleVersion` mechanism

| | |
|---|---|
| **Document wording** | "`ruleVersion` from emitted-JS hashes of the listed source files + constants (§3.3); requires a small, behaviour-neutral **new** module that reads existing files (no edit to existing source). OK?" Recommendation: "Approve". |
| **Options** | (a) Hash emitted JS of a listed set (as drafted). (b) Hash the **comment/whitespace-stripped token stream** of the import-graph-derived set. (c) Constants only. (d) Git commit SHA only. |
| **Recommended** | **(b)**, changing the draft (finding N5). |
| **Technical reason** | (c) misses inline literals (e.g. "21 sessions back"). (d) changes on every commit (spurious versions; splits statistics). (a) depends on the TypeScript version: an upgrade could re-emit different JS and bump every hash. (b) is stable to comments, formatting and compiler upgrades, and conservative (type-only edits bump the version, which is the safe direction). The file list must come from the *verified import graph*: `src/lib/momentum/{universe,discovery,features,market,classify,assess}.ts`, `src/lib/calculations/{returns,breadth,distanceFromHigh,relativeStrength,patterns,regime,validation}.ts`, `src/lib/activity.ts`, `src/config/{sectorUniverse,marketIndices}.ts`, `src/types/{config,metrics,dataset}.ts`. **`marketCapSegments.ts` is not on the path and should be removed.** A test recomputes the import graph and fails if the list drifts. |
| **Research consequences** | Statistics are never silently pooled across rule changes; the model-version split in the Tracker is trustworthy. |
| **Operational consequences** | A new module that *reads* existing files; no edit to existing source. It must not run in the data/deploy test jobs (D15). |
| **Risks if wrong** | Too sensitive → needless version splits; too lax → undetected rule drift contaminating the holdout. |
| **Reversible after A1?** | **Via new version scheme** only; stamped records cannot be re-stamped. |
| **Before first live prediction?** | **Yes.** |

### D5 — `live` / `live-late` rule

| | |
|---|---|
| **Document wording** | "`live` / `live-late` rule (cut-off = next session open 09:15 IST) and excluding `live-late` from the holdout". Recommendation: "Approve". |
| **Options** | (a) `createdAt` ≤ next-session open (as drafted). (b) Same cut-off, but judged on the **commit that published the file** (verified after push). (c) No cut-off (everything counts). |
| **Recommended** | **(b)** (finding N7). |
| **Technical reason** | The purpose of the rule is auditability: a third party must be able to see that the prediction was public before the outcome data existed. The runner's `createdAt` can precede the actual push by minutes or hours if pushes are retried. Features are pure functions of data ≤ t, so a late capture produces the same bytes, but it cannot *prove* it was captured in time. Procedure: the capture writes `createdAt`; the next run's verifier reads the Git commit that first added the file and the corresponding workflow-run timestamps, and records `publishedClass = live \| live-late` in `ledger-state.json` (an append-only history in Git). Holdout selection uses `publishedClass`. |
| **Research consequences** | (c) would let after-the-fact captures into the holdout, defeating its purpose. `live-late` records stay available for labelled sensitivity analysis. |
| **Operational consequences** | A missed 20:00 IST run plus a missed 08:00 IST retry loses that day for the holdout (it counts as missed). Extra capture runs (§5) reduce that risk. |
| **Risks if wrong** | Too tight → avoidable losses of holdout days; too loose → weak audit trail. Trust model: runner clock and GitHub run timestamps — adequate for self-audit, not for adversarial proof (the repo owner could in principle manipulate history; branch protection helps). |
| **Reversible after A1?** | **No for the holdout membership rule** once outcomes are seen; stored `createdAt` and commit data allow re-derivation, but changing the rule after the fact undermines pre-registration. |
| **Before first live prediction?** | **Yes.** |

### D6 — Hosting / file format

| | |
|---|---|
| **Document wording** | "Hosting format: verify `.jsonl` with a throwaway file on the live site (needs a push), or choose now between `.jsonl` (possibly uncompressed) and line-delimited content in `.json` files (compression known to work)". Recommendation: "Use `.json`-named line-delimited shards (no spike needed), or approve a spike". |
| **Options** | (a) Monthly `.jsonl` shards. (b) Monthly line-delimited content in `.json` files (what the draft recommended). (c) **One create-only valid-JSON file per trading day** (`…/predictions/2026-11-02.json`, outcomes per horizon per day). |
| **Recommended** | **(c)** (finding N3). |
| **Technical reason** | `.jsonl` and "line-delimited JSON" are the *same format*; (a) vs (b) differs only in extension and thus in the served `Content-Type`/compression. (b) makes `.json` files that are not valid JSON (`response.json()` fails; tools/linters may choke). (c) keeps ordinary JSON, uses the gzip path already proven on the live site, makes every write atomic (a file exists or it does not), and turns the immutability guard into "no file under `ledger/live` or `ledger/replay` may be modified or deleted, only added". Sizes: ≈272 KB/day raw, ≈38 KB gzip — small enough to fetch per date even if uncompressed. Packed Git growth is unchanged (~10 MB/year) because files are written once. |
| **Research consequences** | None. Analyses load a date range of files; a generated index (`ledger-state.json`) lists dates. |
| **Operational consequences** | ≈1,260 files/year (252 prediction + 4×252 outcome/baseline files). Trivial for Git and Pages. Derived monthly bundles may be generated later for speed, but are never authoritative. |
| **Risks if wrong** | (a)/(b): uncompressed 6.5 MB monthly downloads and append-corruption windows. (c): many small fetches for long-range analysis (mitigated by derived summaries). |
| **Reversible after A1?** | **Via new layout** (copy forward); published paths are permanent. |
| **Before first live prediction?** | **Yes.** |

### D7 — Alerting and the watchdog workflow

| | |
|---|---|
| **Document wording** | "Alerting: new workflow `ledger-watchdog.yml` with `issues: write` and `actions: write`; a header warning chip only on `missed`/`anomaly` (a small edit to `Header.tsx` in the UI phase)". Recommendation: "Approve the workflow now; decide the chip in phase D". |
| **Options** | (a) Watchdog with `issues: write` + `actions: write` (draft). (b) **Alerts-only watchdog**: `contents: read`, `issues: write`; retries via extra scheduled capture runs. (c) No watchdog (rely on red runs and email). |
| **Recommended** | **(b)** (finding N6). |
| **Technical reason** | `actions: write` cannot be scoped to one workflow; it could dispatch or cancel any workflow, including deploys. A missed capture is recovered just as well by additional scheduled runs of the idempotent capture, which need no extra permission on the watchdog. Detail in §5. |
| **Research consequences** | Fewer lost holdout sessions if retries exist before the open; no effect on data content. |
| **Operational consequences** | One new read-mostly workflow; GitHub Issues become the visible alert; maintains no state. Header chip (D7b) is a separate, later UI decision. |
| **Risks if wrong** | Over-permissioned workflow (a); silent loss of holdout days (c). Residual: if both capture and watchdog stop, the existing "Latest market data" and Status badge still go stale. |
| **Reversible after A1?** | **Yes**, anytime. |
| **Before first live prediction?** | **No** strictly, but I recommend shipping it in A1 because a missed day is a permanent loss. |

### D8 — Replay footprint and location

| | |
|---|---|
| **Document wording** | "**Replay footprint:** store a year of replay in `public/data/ledger/replay/` (~71 MB raw, ~10 MB packed, deployed to Pages) vs keeping it outside `public/` (not deployed) vs a compact replay format. Raw prices older than ~450 days are pruned, so un-stored replay for early sessions cannot be regenerated". Recommendation: "Store full-schema replay in a non-deployed folder (e.g. `data-archive/ledger-replay/`), loaded by the Tracker only if you want the exploratory view". |
| **Options** | (a) `public/data/ledger/replay/` on `main` (deployed). (b) Non-deployed folder on `main`. (c) **Orphan branch `ledger-replay`** (never deployed, never checked out by workflows), plus a small deployed `replay-summary.json`. (d) Compact replay format. (e) No replay. |
| **Recommended** | **(c)**, with full schema. The draft's recommendation was self-contradictory (N1). |
| **Technical reason** | Replay is a frozen, one-time ~71 MB raw / ~10 MB packed artefact. On an orphan branch it stays out of `main`'s working tree, clones (`--single-branch`), `actions/checkout`, and the Pages artifact, yet remains in the same repo (same backup, same history). The Tracker's exploratory view can read the small summary; analysis scripts clone the branch. (b) puts 71 MB in every checkout forever; (a) also bloats Pages. |
| **Research consequences** | Preserves replay that **cannot be regenerated later** (older bars are pruned; long-window features degrade for the earliest dates every day). Replay stays exploratory. Physical separation reinforces the holdout fence. |
| **Operational consequences** | A one-time manual run (local or manual-dispatch workflow with `contents: write` limited to that branch). |
| **Risks if wrong** | Delay = permanent loss of the earliest sessions' replay fidelity; wrong location = bloat. |
| **Reversible after A1?** | **Yes** for location (branch can be created or moved later); **time-sensitive** for the data itself. |
| **Before first live prediction?** | **No**, but sooner is better, and the date fence needs `holdout.startDate`, which exists only after A1's first capture. |

### D9 — Readiness thresholds

| | |
|---|---|
| **Document wording** | "Readiness thresholds (R3 ≥ 99% volume coverage; R4 ≥ 90% of trailing median; R5 ±5% universe)". Recommendation: "Approve". |
| **Options** | (a) As drafted. (b) Draft plus **R9** (missing-stock list and threshold) and **R10** (source-drift check) (§6). (c) Looser/stricter numbers. |
| **Recommended** | **(b).** |
| **Technical reason** | R3: volume coverage was **1.000 on every session since volume collection began** (the only sub-99% days are the 11 sessions before 2025-09-03), so 99% flags genuine problems with no history of false alarms. R4: eligible stocks ≈ 750, so 90% of the trailing median ≈ 675 catches a truncated file. R5: ±5% of ≈755 ≈ 717–793. None of these catches *a few* missing stocks (R9) or later source revisions (R10). |
| **Research consequences** | Thresholds define which days enter the holdout. Changing them mid-holdout creates a selection effect, so they belong in the protocol. |
| **Operational consequences** | Failing a check = `blocked`, nothing written, alert; strictness trades completeness for integrity. |
| **Risks if wrong** | Too strict → permanent day loss; too lax → a misleading snapshot (the failure you most want to avoid). |
| **Reversible after A1?** | **Via new version going forward**; changing them alters which days are captured, so treat as protocol. |
| **Before first live prediction?** | **Yes.** |

### D10 — Watchdog cadence and retry budget

| | |
|---|---|
| **Document wording** | "Watchdog cadence (03:15 UTC and 19:30 UTC) and retry budget (3 dispatches per missed date)". Recommendation: "Approve". |
| **Options** | (a) As drafted (dispatch-based retries). (b) **Alerts-only watchdog at 03:15 and 19:30 UTC; retries = two extra capture cron slots** (e.g. 17:30 UTC and 21:00 UTC on weekdays) in `update-data.yml`; no dispatch budget. (c) Dispatch retries counted statelessly via issue comments. |
| **Recommended** | **(b).** |
| **Technical reason** | A missed pre-open capture is recovered by *any* later run of the idempotent catch-up. More scheduled runs achieve that without `actions: write`. Unchanged data produces "No data changes to commit" (cheap). Before the 09:15 IST open (03:45 UTC) there are then four attempts (14:30, 17:30, 21:00, 02:30 UTC) instead of two. |
| **Research consequences** | Fewer missed holdout sessions. |
| **Operational consequences** | Two more cron lines in `update-data.yml` (a workflow change; allowed in A1, not now). Each extra run costs a few Actions minutes (free for public repos). |
| **Risks if wrong** | Cadence too sparse → lost sessions; too dense → wasted minutes. |
| **Reversible after A1?** | **Yes.** |
| **Before first live prediction?** | **No.** |

### D11 — Definition of a completed live session, and who signs off unblinding

| | |
|---|---|
| **Document wording** | "Definition of a **completed live session** for the 250-session gate (h = 1 *and* h = 5 resolved) and who performs/signs off the unblinding commit". Recommendation: "Approve; you sign off". |
| **Options** | (a) h=1 and h=5 resolved (draft). (b) h=1 only. (c) h=1, 5 and 10. |
| **Recommended** | **(a).** Sign-off by you, with a verification script (not a person's judgement) establishing the count. |
| **Technical reason** | The pre-registered headline horizons are 1 and 5, so a session is only "complete" for the question you will answer once both are resolved (an `unavailable-with-reason` outcome counts as resolved). 250 completed sessions therefore need ≈ 255 elapsed sessions, ≈ 12 months. |
| **Research consequences** | Defines when ≥ 250 is reached; 250 is a review point, not a significance claim. Missed/late sessions never count. |
| **Operational consequences** | A script computes the count; `holdout.json` records it at unblinding. |
| **Risks if wrong** | Counting sessions with unresolved headline outcomes would unblind early. |
| **Reversible after A1?** | **No** once pre-registered (changing it after seeing progress is a degree of freedom). |
| **Before first live prediction?** | **Yes.** |

### D12 — Operational live panel before unblinding

| | |
|---|---|
| **Document wording** | "Whether the Tracker shows the operational (completeness-only) live panel before unblinding". Recommendation: "Yes". |
| **Options** | (a) Show completeness-only panel (counts, latency, pending/complete/unavailable, hash status). (b) Show nothing live until unblinding. |
| **Recommended** | **(a).** |
| **Technical reason** | Monitoring is required (your requirement C/G). The panel exposes no returns, rates or class distributions. A test asserts every analysis function throws while sealed. |
| **Research consequences** | Even counts of "unavailable: discontinuity" are operational, not performance. |
| **Operational consequences** | Phase D work only. |
| **Risks if wrong** | Showing too much (e.g. class counts) would leak performance. |
| **Reversible after A1?** | **Yes.** |
| **Before first live prediction?** | **No.** |

### D13 — `filingsAfterCapture` on outcome lines

| | |
|---|---|
| **Document wording** | "Whether to also store `filingsAfterCapture` ids on outcome lines for context". Recommendation: "Yes, as ids/categories only". |
| **Options** | (a) Store compact ids/category/timestamps of filings published after capture. (b) Do not. |
| **Recommended** | **(a)**, neutral naming (`filingsInWindow`, never "catalyst"). |
| **Technical reason** | Filings published after the capture cannot be added to the immutable prediction, but they are context for interpreting an outcome. They live in the outcome file (also immutable once written), with `postCapture: true`. |
| **Research consequences** | Context only; never used in classification or scoring; no causal inference. |
| **Operational consequences** | Needs `announcements.json` still holding the filing (30-day retention) when the outcome matures (h=10 ≈ 14 calendar days, so fine). |
| **Risks if wrong** | Wording that implies causation. (The existing Daily Movers panel heading says "Exchange filings and catalysts" and "Why it can matter"; flag for Phase D, not changed now.) |
| **Reversible after A1?** | **Yes** before Phase B; afterwards via new outcome schema. |
| **Before first live prediction?** | **No.** |

### D14 — Acceptability of storage growth

| | |
|---|---|
| **Document wording** | "Confirm that growth of ~111 MB/year raw (~16 MB/year packed history) and a Pages site that reaches ≈160 MB after one year is acceptable, with parameterised ledger paths so a data-branch migration stays cheap". Recommendation: "Approve". |
| **Options** | (a) Accept on `main`. (b) Data branch now. (c) External store. |
| **Recommended** | **(a), live records on `main`, replay on an orphan branch (D8)**, paths parameterised (§4). |
| **Technical reason** | Measured: ≈ 68.5 MB/year predictions + ≈ 43 MB/year outcomes (estimate), ≈ 16 MB/year packed history. Three-year Pages site ≈ 380 MB (limit 1 GB). Deploy-time pruning of old shards is a cheaper first remedy than moving branches (the Pages artifact does not shrink by moving data to another branch). |
| **Research consequences** | None. |
| **Operational consequences** | Review triggers: Pages site > 600 MB, clone > 250 MB, or deploy > 10 min → prune artifact first. |
| **Risks if wrong** | History growth is irreversible without a rewrite; ~16 MB/year is small. |
| **Reversible after A1?** | **Via new version / migration** (cost in §4). |
| **Before first live prediction?** | **Yes** (path layout). |

---

## 2. Readiness thresholds: what "D9–D14" actually contains

| Item in D9–D14 | What it is | Where specified |
|---|---|---|
| **D9** | The only numeric readiness thresholds: R3 ≥ 99% volume coverage; R4 ≥ 90% of trailing-20-session median eligible count; R5 universe within ±5% of previous snapshot | Design §8.3 |
| R1, R2, R6, R7, R8 | Non-numeric gates (archives `ok`; all 20 index series present; no conflicting existing record; `latestMarketDate` ≥ t and refresh ≠ failed; code `ruleVersion` as expected) | Design §8.3 |
| **D5 (not D9–D14)** | The 09:15 IST cut-off for `live` | §8.2 |
| **D10** | Watchdog cadence and retry budget | §8.5 |
| **D11** | Completed-session definition | §12.1 |
| D12–D14 | UI visibility, filing ids, storage acceptance | — |

This review adds R9 and R10 (§6), which would extend D9.

---

## 3. OD1 deep review

### 3.1 The complete rules (exact)

For a prediction on date *t* and horizon *h* sessions (NIFTY 500 trading-calendar index):

- **σ** = *population* standard deviation of the stock's 20 daily simple percentage changes `(close_i/close_{i−1} − 1)·100` over the 20 sessions ending **t−1** (day *t* excluded), comparable bars only; needs ≥ 22 comparable bars. This is exactly `volatility20` (`features.ts`), frozen in the prediction record.
- **ε_h = max(0.5 · σ · √h , 0.20)** (percent).
- **R_h** = `(C(t+h)/C(t) − 1)·100`. **X_h** = `R_h − NIFTY500 return over the same window` (pp). **H\*, L\*** = highest high / lowest low over sessions *t+1 … t+h*. **H_t, L_t** = the prediction day's high and low.

**Gainers** (first match wins): Inconclusive → **Reversal** if D∧B → **Failed continuation** if D∧¬B → **Confirmed** if P∧E∧N → **Partial** if ¬D and (P∨E∨N) → **Sideways**.
P: `R_h ≥ +ε_h` · E: `X_h > 0` · N: `H* > H_t` · D: `R_h ≤ −ε_h` · B: `L* < L_t`.

**Losers** (mirror): Inconclusive → **Rebound / reversal** if D′∧B′ → **Failed downside continuation** if D′∧¬B′ → **Confirmed downside continuation** if P′∧E′∧N′ → **Partial downside continuation** if ¬D′ and (P′∨E′∨N′) → **Sideways**.
P′: `R_h ≤ −ε_h` · E′: `X_h < 0` · N′: `L* < L_t` · D′: `R_h ≥ +ε_h` · B′: `H* > H_t`.

**Inconclusive** when: σ unavailable; any bar missing in *t+1…t+h*; a price discontinuity in *t…t+h* (raw unadjusted return still stored); or the window not yet complete/archives not `ok` (then *pending*, no record).

### 3.2 The volatility calculation

Twenty daily changes (illustrative): `1.2, −0.8, 2.5, −1.9, 0.4, 3.1, −2.2, 1.0, −0.5, 2.0, −3.0, 1.6, 0.2, −1.1, 2.8, −2.6, 0.9, 1.4, −1.7, 1.5`.

- Mean = 0.240. Sum of squared deviations ÷ **20** → **population SD = 1.816%**. Dividing by 19 would give the sample SD 1.863%. The ratio is √(19/20) = **0.975**, i.e. population σ is 2.5% smaller; the project already uses the population form, and the difference is immaterial next to the other uncertainties.
- **Why 20 sessions.** It is the dashboard's own horizon for its 20-day average, its 20-session relative-volume baseline and the existing `volatility20` feature, roughly one trading month. It was not tuned on outcomes. Under normality the standard error of an SD from 20 observations is ≈ 1/√(2·19) ≈ **16%**, wider with fat tails — so ε itself is uncertain by ~16%, which is why k = 0.5 versus 0.575 is not a meaningful distinction and why I recommend not fine-tuning k.
- **Why `0.5 · σ · √h`.** Under an i.i.d. random walk the standard deviation of an *h*-day return is σ√h, so ε_h is "half a standard deviation of an *h*-day move": a move smaller than that is not distinguishable from ordinary noise. Independence is only approximate (autocorrelation, fat tails, and — measured here — volatility clustering after big moves, N10), so this is a scaling convention, not a model.
- **The 0.20% floor.** It equals the assumed round-trip cost (a move below the cost is not economically material). It **never binds** in the replay data (p10 of ε₁ is 0.69%), so results are identical with or without it; it is a guard against degenerate σ ≈ 0. It is a fixed constant of OD1 and does not move when the cost sensitivity (10/20/30/50 bps) is changed.

### 3.3 Worked examples (illustrative numbers, not market data)

Common setting: σ = **2.00%** ⇒ ε₁ = max(0.5·2·√1, 0.2) = **1.000%**, ε₅ = 0.5·2·√5 = **2.236%**. Prediction day (gainer): C(t)=100, H_t=103, L_t=96, O_t=98. NIFTY 500 at *t* = 20,000. Computed by script; classes shown are exactly what OD1 yields.

**1 — Moves strongly in the predicted direction.** t+1: C 103.0, H 103.8. t+5: C 107.0, H* 108. NIFTY +0.5% (h=1) and +1.5% (h=5).

| h | R_h | X_h | P | E | N | D | Class |
|---|---|---|---|---|---|---|---|
| 1 | +3.00 | +2.50 | ✓ | ✓ | ✓ (103.8>103) | – | **Confirmed** |
| 5 | +7.00 | +5.50 | ✓ | ✓ | ✓ | – | **Confirmed** |

**2 — Initially moves in the predicted direction, then reverses.** t+1: C 101.5, H 104.0, NIFTY +0.3%. By t+5: C 94.5, lowest low 93.8, NIFTY +1.5%.

| h | R_h | X_h | P | E | N | D | B | Class |
|---|---|---|---|---|---|---|---|---|
| 1 | +1.50 | +1.20 | ✓ | ✓ | ✓ | – | – | **Confirmed** |
| 5 | −5.50 | −7.00 | – | – | ✓ (104.0>103) | ✓ (≤ −2.236) | ✓ (93.8<96) | **Reversal** |

*Note:* the same stock is "Confirmed" at h=1 and "Reversal" at h=5, which is why horizons are reported separately.

**3 — Moves very little.** t+1: C 100.4, H 101.5, NIFTY +0.6%. t+5: C 100.9, H* 102.4, NIFTY +1.1%.

| h | R_h | X_h | P | E | N | D | Class |
|---|---|---|---|---|---|---|---|
| 1 | +0.40 | −0.20 | – | – | – (101.5<103) | – | **Sideways** |
| 5 | +0.90 | −0.20 | – | – | – (102.4<103) | – | **Sideways** |

**4 — Moves against the predicted direction.** t+1: C 97.5, L 96.8, NIFTY +0.2%. t+5: C 92.0, lowest low 91.2, NIFTY +0.5%.

| h | R_h | X_h | D | B | Class |
|---|---|---|---|---|---|
| 1 | −2.50 | −2.70 | ✓ (≤ −1.0) | – (96.8 > 96) | **Failed continuation** |
| 5 | −8.00 | −8.50 | ✓ (≤ −2.236) | ✓ (91.2 < 96) | **Reversal** |

**5 — Gaps in the predicted direction but closes weakly.** t+1: O 107 (gap **+7.0%**), H 108, L 99.8, C 100.6; NIFTY +0.2%. t+5: C 101.5, NIFTY +1.0%.

| h | R_h | X_h | P | E | N | Class | Note |
|---|---|---|---|---|---|---|---|
| 1 | +0.60 | +0.40 | – (<1.0) | ✓ | ✓ (108>103) | **Partial** | gap 7% ≥ 3σ = 6% ⇒ flagged `abnormalGap`; long open→close = **−5.98%** |
| 5 | +1.50 | +0.50 | – (<2.236) | ✓ | ✓ | **Partial** | |

*This example shows why classification and profitability are separate measures: the stock is "Partial" on the close-to-close reference (the overnight gap is included) while a buyer at the next open lost ~6%.*

**6 — Insufficient volatility history.** A stock with only 18 comparable bars (recent listing, or after a price break): σ unavailable ⇒ **Inconclusive (insufficient-history)** at **both** h=1 and h=5. The prediction itself is still recorded (its Evidence is "Insufficient evidence" because it has fewer than 50 bars).

**7 — Missing or abnormal price data** (three sub-cases).

| Case | h = 1 | h = 5 |
|---|---|---|
| **(a) Suspension**: no bar on t+3 | Bar t+1 exists ⇒ classified normally | **Inconclusive (no-bar)** |
| **(b) 1:1 bonus effective t+2**: close drops ≈ −50% | Window t+1 has no break ⇒ classified normally | **Inconclusive (discontinuity)**; raw unadjusted R₅ ≈ −49% is stored for bounds |
| **(c) Abnormal volatility**: the σ window holds nineteen ±1% days and one +18% day ⇒ σ = **4.05%** (the 18% day is 4.4σ) | ε₁ = 2.03%, ε₅ = 4.53%; flagged `volWindowOutlier` | A +1.5% next day (Confirmed for a clean σ = 1% stock, where ε₁ = 0.5%) lands inside ε ⇒ not Confirmed |

**Mirror example for losers.** Prediction day C=98, H_t=104, L_t=97; t+1: C 95.0 (R₁=−3.06), NIFTY −0.05% ⇒ P′ ✓ E′ ✓ N′ ✓ (L 94.5<97) ⇒ **Confirmed downside continuation**; t+5 C 91.5 (R₅=−6.63) ⇒ **Confirmed downside continuation**. A loser that rebounds to C 103.2 (R₁=+5.31) after trading to H 104.6 > 104 ⇒ D′ ✓ B′ ✓ ⇒ **Rebound / reversal** at both horizons.

### 3.4 Which conditions are redundant or weakly informative? (label-agnostic, replay window to 2026-10-29)

Population: top-50 gainers and top-50 losers by price change; ≈ 13,500 valid observations per cell.

**Marginal frequency among valid observations (k = 0.5):**

| Cell | P | E | N | P∧E | P∧N | **Confirmed (P∧E∧N)** | Confirmed ÷ P |
|---|---|---|---|---|---|---|---|
| h=1 gainers | 29.0% | 45.3% | 60.0% | 28.3% | 27.0% | 26.4% | **91%** |
| h=1 losers | 30.5% | 52.6% | 66.0% | 29.7% | 29.5% | 28.7% | **94%** |
| h=5 gainers | 29.1% | 46.1% | 77.2% | 28.5% | 28.9% | 28.3% | **97%** |
| h=5 losers | 30.6% | 52.7% | 84.1% | 29.6% | 30.4% | 29.5% | **96%** |

- **E (market-relative):** removing it changes Confirmed by only **0.6–1.0 pp** (about 2–3% of P cases). Nearly redundant for Confirmed.
- **N (new high/low):** satisfied **60–84%** of the time because the prediction day's own range is large; removing it changes Confirmed by **0.2–2.0 pp**. Weakly informative for Confirmed.
- **Consequence:** Confirmed ≈ P, i.e. "closed materially in the original direction (≥ 0.5σ√h) and beat the market and breached the prior extreme".

**What is inside "Partial" (share of Partial outcomes):**

| Cell | N only | E only | E+N | P-containing combos |
|---|---|---|---|---|
| h=1 gainers (n=4,142) | 38% | 15% | 38% | 8% |
| h=1 losers (n=4,816) | 32% | 16% | 47% | 5% |
| h=5 gainers (n=4,388) | 46% | 5% | 46% | 3% |
| h=5 losers (n=5,331) | 41% | 4% | 52% | 2% |

**N is present in 78–95% of Partial outcomes.** In plain terms, "Partial continuation" mostly means *"the stock traded beyond the prediction day's high/low but did not close materially higher/lower"* (including closes that were slightly negative but inside the noise band). That is a legitimate mixed state, but it is not a measure of "partial progress". Hence: headline = Confirmed and Adverse; consider renaming Partial (e.g. "Mixed / unconfirmed") — a naming choice that does not change any rule.

### 3.5 Sensitivity to the multiplier k (label-agnostic; shares of all observations incl. ≈7% Inconclusive)

| Cell | k | Confirmed | Partial | Failed | Reversal | Sideways |
|---|---|---|---|---|---|---|
| **h=1 gainers** | 0.25 | 29.5% | 18.7% | 30.6% | 10.1% | 4.0% |
| | **0.50** | **24.6%** | **28.2%** | **22.5%** | **9.4%** | **8.4%** |
| | 0.75 | 19.9% | 35.8% | 15.8% | 8.5% | 12.9% |
| | 1.00 | 15.9% | 42.2% | 10.4% | 7.2% | 17.2% |
| **h=1 losers** | 0.25 | 34.0% | 20.8% | 21.5% | 13.1% | 3.2% |
| | **0.50** | **26.6%** | **32.7%** | **14.4%** | **11.8%** | **7.1%** |
| | 0.75 | 19.9% | 42.2% | 9.1% | 10.5% | 10.9% |
| | 1.00 | 14.6% | 49.3% | 5.6% | 8.9% | 14.1% |
| **h=5 gainers** | 0.25 | 31.9% | 18.0% | 11.3% | 29.7% | 1.8% |
| | **0.50** | **26.2%** | **30.2%** | **6.6%** | **25.5%** | **4.1%** |
| | 1.00 | 15.5% | 50.3% | 2.0% | 14.8% | 10.1% |
| **h=5 losers** | 0.25 | 35.9% | 21.5% | 5.5% | 28.1% | 1.3% |
| | **0.50** | **27.2%** | **36.7%** | **2.5%** | **23.0%** | **2.9%** |
| | 1.00 | 14.1% | 57.4% | 0.5% | 13.7% | 6.6% |

(Full table including 0.75 and fixed 0.5/1/2% thresholds is in the design document §10.2. Because this is a mover-only, label-agnostic population, these rows are also the **base-rate distribution** against which any model label would be compared.)

**Practical impact.**
- **Raising k** moves mass smoothly from Confirmed / Failed / Reversal into Partial / Sideways: at h=1 gainers Confirmed falls from 29.5% to 15.9% and Sideways rises from 4.0% to 17.2% as k goes 0.25 → 1.0. No cliff, so the definition does not hinge on k.
- **Fixed thresholds** treat quiet and volatile stocks alike: at h=5 a fixed 0.5–1% leaves ≤ 1.3% Sideways and ~30% Reversal, because five-day noise exceeds 1% for most movers.
- **k = 0.5** gives a typical ε₁ of 1.15% (p10 0.69%, p90 1.91%) — comfortably above the 0.20% cost — and uses every class.

### 3.6 Symmetry of gainers and losers

**Formally symmetric** (same k, floor, horizon, σ; conditions are exact mirrors). **Not empirically symmetric**, and users should not expect equal shares:
- The replay window was bearish-to-sideways, which inflates downside "Confirmed" (26.6% vs 24.6% at h=1) — E′ corrects for the market but not for drift or skew.
- New lows are more common than new highs (N′ 66%/84% vs N 60%/77%).
- Price bands/circuit limits are asymmetric in effect and are not modelled.
- Rebound/reversal for losers includes bounce-from-oversold behaviour with no analogue in gainers.

### 3.7 Precise statement of what OD1 would mean

> **OD1 is a deterministic, versioned description of what a stock's price did over the 1 or 5 trading sessions after a classification date, measured against a volatility-scaled materiality band that was fixed using only information available at the classification date.**
> - **"Confirmed" means** that, relative to the prediction-day close, the stock closed at least `0.5·σ·√h` (never less than 0.20%) further in the original direction, outperformed NIFTY 500 over the same window, and traded beyond the prediction day's high (gainers) or low (losers). It describes what happened. It is **not a probability**, not an estimate of what will happen to other stocks, **not a profitable trading signal** and not an evaluation of profitability (which is a separate measure from the next open, after costs).
> - **"Adverse"** (Failed or Reversal) means a materially opposite close; **Partial** and **Sideways** are residual descriptive classes (Partial is dominated by intraday breaches without a material close).
> - OD1 says nothing about *why* a stock moved, and its shares are meaningful only **relative to the same-definition base rate** of all top movers (and, for the holdout, only after unblinding).

---

## 4. Storage architecture review

### 4.1 Reference numbers (from the design document, plus 3-year projections)

| Quantity | Value |
|---|---|
| Predictions | ≈ 68.5 MB/year raw (122 records/day × 2.2 KB), ≈ 9.5 MB gzip |
| Outcomes (estimate) | ≈ 43 MB/year raw, ≈ 6 MB gzip |
| Live total | ≈ 111 MB/year raw → **≈ 335 MB at 3 years** |
| Git history (packed) | ≈ 10 MB (predictions) + ≈ 6 MB (outcomes) ≈ 16 MB/year → ≈ 48 MB at 3 years |
| Replay (one-time) | ≈ 71 MB raw, ≈ 10 MB packed |
| Pages site today | 46 MB (`public/data`); GitHub Pages published-site limit **1 GB** |

### 4.2 Options compared

| | **A. Everything on `main`** | **B. Live on a separate data branch** | **C. Replay separate, live on `main`** | **D. External data store** |
|---|---|---|---|---|
| **Git history growth** | ~16 MB/yr live + ~10 MB one-time replay in `main` | `main` stays small; data branch grows ~16 MB/yr; the already-existing market-data growth stays on `main` | Live ~16 MB/yr on `main`; replay's ~10 MB isolated on an orphan branch | None in Git |
| **Pages deployment** | Whole ledger deployed (3 yr ≈ 380 MB with live only; ≈ 450 MB if replay also deployed) | **Same site size** if the site must serve it (the artifact still includes it), unless the UI reads `raw.githubusercontent.com` (CORS allowed, but caching/Content-Type/compression unverified) | Site includes live only (≈ 380 MB at 3 yr) plus a tiny replay summary | Site stays small; browser fetches externally |
| **Actions complexity** | Lowest: one workflow, one push loop, existing `git add public/data` | Highest: second checkout, separate push loop, deploy assembles two branches; **two-commit atomicity risk** (data-branch push may succeed while the `main` push fails, leaving a record derived from data not yet public) | Low; replay written once by a manual run | Highest: credentials/secrets (or OIDC), SDK, availability dependency |
| **Recovery / backup** | Git history is the backup; every clone is a full copy | Same, per branch | Same | Provider's durability; separate backup needed |
| **Immutability enforcement** | CI guard + branch protection; per-day create-only files make "only additions" trivially checkable | Same, with protection rules on the data branch | Replay frozen by branch protection; live as A | Strongest option exists (object-lock WORM) but needs an account, cost and secrets |
| **Browser access** | Same-origin, gzip proven for `.json` | Same-origin only if deploy copies it; otherwise cross-origin via raw | Same as A for live; replay via summary | Needs a public bucket + CORS |
| **Long-term maintenance** | One place; the pressure point is Pages artifact size/deploy time | Two places; the artifact still grows | Lowest overall | Account, billing, keys, vendor lock-in |
| **Fit with your constraints** | ✔ no new service | ✔ but more moving parts | ✔ | ✘ conflicts with "no external DB / paid service / secrets unless clearly needed" |

**Key insight:** moving data to another *branch* (B) does not shrink the Pages site, because the site must still serve it. What actually controls Pages growth is **what is copied into the artifact**. A cheap remedy exists: before building, delete shards older than N months from the CI workspace (they remain in Git) and fetch older months on demand from the repository only for analysis.

### 4.3 Recommendation (≥ 3 years, simplest)

**A for live records + C for replay:**
1. Live predictions/outcomes on `main` under `public/data/ledger/live/`, **one create-only JSON file per day** (D6).
2. Replay on an orphan branch `ledger-replay` with a deployed `replay-summary.json`.
3. All ledger paths and the base URL come from one config constant so a later move costs hours (not days).
4. Re-evaluate when any of these triggers fire: Pages site > 600 MB, `main` clone > 250 MB, deploy > 10 min. First remedy: prune old months from the artifact; second: move live data to a data branch.
5. Backup: keep a personal `git clone --mirror`; optionally a monthly annotated tag `ledger-YYYY-MM` recording the ledger-head hash (protectable with tag rulesets).

**Cost of a later migration to a data branch (B):** copy `ledger/` to the branch (small); `main` keeps the old blobs forever unless history is rewritten (~16 MB/year sunk); workflows need a second checkout and push loop (~1 day with tests); frontend change is a base-URL switch if parameterised; main risk is cross-branch atomicity (§ table).

### 4.4 Compression, `.jsonl`, and "JSONL vs line-delimited JSON"

- **They are the same format.** *JSON Lines* (`.jsonl`) = *NDJSON* = *line-delimited JSON*: one complete JSON object per line, separated by `\n`. D6 as written presents them as alternatives; the only genuine difference between its options is the **file extension** (`.jsonl` vs `.json`), which determines the `Content-Type` GitHub Pages sends and hence whether it compresses.
- **Verified:** `.json` is served `content-type: application/json; charset=utf-8` with `content-encoding: gzip` (`stocks.json` 16.5 MB → 3.4 MB on the wire).
- **Not verified:** `.jsonl`. I will not assume it. **How to verify without touching this site:** publish a throwaway repo with GitHub Pages containing ~1 MB probe files (`probe.jsonl`, `probe.ndjson`, `probe.json`), then run `curl -sI -H "Accept-Encoding: gzip" <url>` and check `content-type` and `content-encoding`; compare `content-length` with the raw size; confirm in browser DevTools → Network (Content-Encoding column). This needs no push to `Sector-Dashboard`.
- **Effect on browser access:** compression does not change access. `fetch()` decodes gzip transparently; the `Content-Type` does not matter for `response.text()`, and `response.json()` parses regardless of type (but a multi-object `.jsonl`/line-delimited body is *not* a single JSON document, so use `text().split("\n")`). The only effect of missing compression is download size (6.5 MB uncompressed monthly shard versus ≈0.9 MB gzip).
- **The per-day `.json` layout removes the question**: each file is valid JSON, uses the proven gzip path, and is small even if uncompressed (~270 KB).

---

## 5. Watchdog review

### 5.1 Purpose and design (recommended form)

An **alerts-only, stateless, read-only** workflow `ledger-watchdog.yml`. It never writes to the repository and never creates, edits or deletes ledger data.

| Aspect | Specification |
|---|---|
| **Triggers** | `schedule` at 03:15 UTC (08:45 IST, just before the open) and 19:30 UTC (01:00 IST); `workflow_dispatch` for manual checks. `concurrency: ledger-watchdog` so two runs cannot race on issues. |
| **Permissions (minimum)** | Workflow level `permissions: {}`; job level **`contents: read`** and **`issues: write`**. **No** `actions`, `pages`, `id-token`, `contents: write`. No secrets; only `GITHUB_TOKEN`. |
| **Can it write to `main` or a data branch?** | **No.** `contents: read` cannot push. Ledger writes happen only in the capture workflow (`update-data.yml`, which already has `contents: write`). |
| **Does it run repository code?** | Prefer **no checkout**: it reads three files through `gh api` (`public/data/ledger/ledger-state.json`, `public/data/refresh-state.json`, `public/data/manifest.json`) and runs a short inline script (reviewed as part of the workflow). That keeps repo scripts out of a privileged job; if a script is preferred it must be pinned and reviewed. Third-party actions, if any, pinned by commit SHA. Never `pull_request_target`; issue text built from dates only (no untrusted content). |
| **Detecting a missed session** | A trading date *d* is **captured** if `ledger-state` shows it `recorded` with `publishedClass = live`. It is **missed** when the next trading day's cut-off (09:15 IST) has passed (or the next session already appears in `refresh-state` as `ok`) and *d* is not captured. It is **at risk** from 08:45 IST on the next weekday if still not recorded. |
| **Holiday vs missed capture** | From `refresh-state.json`, which already records each weekday's archive outcome: both archives `ok` ⇒ trading day; index `missing` (HTTP 404) with the stock archive `earlier-session` ⇒ **non-trading day (holiday)**; `failed`/`invalid`/`incomplete`/absent ⇒ **unknown**, never assumed to be a holiday. Weekends are ignored. Unknown dates raise a different, lower-severity alert ("source data unresolved"), not a ledger alert. This reuses `build-manifest`'s existing `nonTradingDates` classification. |
| **Retries** | The watchdog itself performs **none**. Recovery is the idempotent catch-up inside the capture workflow, which runs on four scheduled slots before the open (14:30, 17:30, 21:00, 02:30 UTC) and can be run manually. |
| **Duplicate prevention** | It creates no records. Issues are deduplicated by deterministic title `Ledger snapshot missing: YYYY-MM-DD` (search `in:title` before creating; comment instead if it exists) and the concurrency group. The capture writer's own idempotency (create-only files, identical-hash skip) prevents duplicate records regardless of how many runs occur. |
| **Incomplete source data** | The watchdog does not judge source data; it reports the `blocked` reasons the capture wrote to `ledger-state` (e.g. "R3 volume coverage 62%") in the issue body, so a `blocked` day is explained rather than silently absent. |
| **Opening / closing issues** | Opens (label `ledger`) when a date is missed/blocked/anomalous; adds a dated comment each cycle; **closes** it automatically (with a comment) when the date becomes `recorded`, or when the date is permanently classified `missed` after the cut-off (the issue records the permanent loss, then closes with label `ledger-lost-session`). An `anomaly` (hash mismatch, drift) issue is never auto-closed; it requires a human. |
| **Avoiding modification of history** | Read-only token; no checkout of ledger paths for writing; no ability to push. |
| **If the watchdog itself fails** | The run turns red and GitHub notifies per notification settings (typically the person who last edited the schedule). Capture is unaffected. **Residual risk:** if capture and watchdog both stop, the dashboard's existing "Latest market data" and Status badge go stale — the existing mechanism for a dead pipeline. The Tracker's status strip shows `ledger-state.updatedAt`, which measures *capture* freshness, not watchdog health (corrects the earlier design text). |

### 5.2 Why alerts-only (versus the draft with `actions: write`)

`actions: write` permits dispatching or cancelling **any** workflow (including deployment and constituent updates); GitHub offers no per-workflow scope. The benefit of dispatch-based retries is small because extra scheduled capture runs achieve the same recovery with the existing, already-privileged capture job. If you nonetheless want dispatch retries, the budget (≤ 3 per date) can be tracked statelessly by counting "retry n" comments on the issue, and the permission added knowingly.

### 5.3 Other security hardening to include in A1

- Branch protection on `main`: **block force-pushes and deletions**. This is a repository setting (no code).
- A read-only **`ledger-guard`** workflow on every push that touches `public/data/ledger/**`, failing if any existing file is modified or deleted (`git diff --name-status` must show only `A`). It protects against manual edits and other workflows, which the in-pipeline check cannot.
- Pin third-party actions by SHA in new workflows; default `permissions: {}`.
- Keep ledger *governance* tests (golden hashes) out of `deploy.yml`/`update-data.yml` (N4).

---

## 6. Readiness and late-capture cases

Principle: a date is either **fully recorded** (one atomic, create-only file with header, readiness results and `predictionsHash`) or **absent with a visible reason**. There is no partial file, and `ledger-state` never marks a blocked or missed date as valid.

| Case | What happens | Result |
|---|---|---|
| **Missing stock prices — a few stocks** (e.g. a top gainer absent from the day's bhavcopy) | The stock is not ranked (as in the app). New **R9**: the snapshot header lists every stock that had a bar on *t−1* but none on *t* (`noBarToday[]`) and the check fails if the count exceeds the trailing median + a set margin | Recorded with the list visible, or `blocked` |
| **Missing stock prices — many** | **R1/R4** (eligible count < 90% of trailing-20 median ≈ 675) | `blocked`; nothing written; alert |
| **Missing volume — a few stocks** | R3 passes at ≥ 99% (≤ ~7 stocks). Those stocks have no relative volume ⇒ category *Insufficient evidence*, absent from the unusual-volume list; header records `volumeRowsMissing[]` | Recorded, transparently |
| **Missing volume — many** | R3 fails | `blocked`; unusual-volume list would be distorted, so no snapshot |
| **Incomplete index data** | R2: NIFTY 500 plus all 20 tracked series must have a bar for *t* (strict: context for sector/market components would otherwise silently change scores) | `waiting` until the cut-off, then `missed` (permanent loss, issue records it) |
| **Stale market data** | R7: `latestMarketDate` ≥ *t* and `refresh.outcome` ≠ `failed`; per-stock staleness (> 7 days) yields null metrics as in the app. Tolerate a `partial` refresh only if date *t* itself is `ok` and `tradingDaysBehind = 0`; the partial reasons are written to the header | `blocked` if *t* itself is unresolved |
| **A missed scheduled workflow** | Next scheduled capture catches up all pending dates (bounded to the last 10 sessions). The watchdog alerts if the date is still absent at 08:45 IST | Recorded `live` if before the cut-off; else `live-late` |
| **Delayed capture after the next session opens** | Features are computed on data truncated at *t* (a test asserts identical bytes whether or not later bars exist). Class = `live-late`; excluded from the holdout, kept for labelled sensitivity | Recorded, flagged, not counted |
| **Push retried so the record becomes public after the open though created before it** | Verification step reads the publishing commit's time; reclassifies to `live-late` in `ledger-state` history | Not counted |
| **Correction to source data after capture** | Original is never edited. New **R10 drift check**: each run recomputes the input hash for the last 10 captured sessions and compares; a mismatch writes an `anomaly(sourceRevision)` entry and, optionally, a separate create-only `corrections/` file with the recomputed record flagged `supersedes`. Default analysis uses the original (what was known); sensitivity uses the correction | Visible anomaly, issue opened, no overwrite |
| **Code or settings change mid-holdout** | `ruleVersion` differs ⇒ R8 blocks writing under the old version; a new version must be enabled deliberately and runs in shadow | No silent drift |

A failed capture can never become a valid prediction: validity requires (i) all readiness checks passed and recorded in the header, (ii) matching `predictionsHash`, (iii) an additive-only commit verified by the guard, and (iv) for the holdout, `publishedClass = live`.

---

## 7. Replay and filing metadata

### 7.1 Replay

| Question | Answer |
|---|---|
| **Where stored** | Orphan branch `ledger-replay` (never deployed, never checked out by default), plus a small deployed `replay-summary.json` (aggregates only) for the exploratory view (D8). |
| **Physical separation** | Different branch and directory root (`replay/…`); never under `ledger/live/`. |
| **Logical separation** | Every replay snapshot carries `provenance: "replay"`, `replayGeneratedAt`, `sourceCoverage` and `limitations[]`. In code, live and replay records are different types; the holdout analysis functions accept only the live type, assert `provenance === "live"` and a `live/` path, and throw while the holdout is sealed. |
| **Preventing entry into the holdout** | (1) Path/branch separation; (2) type separation; (3) `provenance` assertion; (4) **date fence** — the replay writer refuses any date on or after `holdout.startDate`; (5) tests for each. |
| **Historical universe membership** | Replay uses today's lists applied to the past. The header states `universeAsOf` (the constituent fetch time), list hashes and counts, and the limitations: delisted/removed stocks are absent (survivorship), industry and size segment are current not historical, and the real settings in force on past dates are unknown. Analyses must stratify by `sizeSegment` knowing it is a proxy. For **live** records the lists are also "as fetched", but each header records `constituentsFetchedAt` and the list hash, so a list change shows as a hash change and analyses can split before/after. The `constituent-changes.json` log (since 2026-10-28) can attach known additions/removals. |

### 7.2 Filing metadata

| Question | Answer |
|---|---|
| **Fields** | `id`, `symbol`, `category`, `publishedAt` (NSE time, IST), `retrievedAt` (the ledger's read of `announcements.json`), `source` (URL), `availableAtPrediction`. |
| **Filings available after prediction time** | Never inserted into the immutable prediction. They appear in the **outcome file** as `filingsInWindow[]` with `postCapture: true`, the window bounds and `retrievedAt` at outcome time. |
| **Timestamping** | Two clocks, both stored: NSE's `publishedAt` and our `retrievedAt`. `availableAtPrediction` means only "present in our copy at `createdAt` **and** published before it" — it does **not** prove that investors saw it then (the feed is read once or twice a day, the feed holds only the current IST day, and collection began ~27 Oct 2026). |
| **Coverage** | The header records the percentage of the window actually covered by successful feed reads, so "no filing recorded" is distinguishable from "not covered". |
| **No causal claims** | Neutral labels only ("filings published in the window"); no sentiment, no "catalyst/reason/driver". A filing near a move does not establish causation; an absent filing does not mean no news. The existing Daily Movers panel's heading "Exchange filings and catalysts" and "Why it can matter" wording should be reviewed in Phase D (flagged, not changed now). |
| **Scoring** | Filings are never used in scoring, setup, evidence or outcome classification. |

---

## 8. Final recommendation

### 8.1 Recommended answers (D1–D14)

| # | Recommended answer | Change from Revision 2? |
|---|---|---|
| **D1** | Approve OD1's rules; add: floor is a constant independent of cost; **headline = Confirmed share and Adverse (Failed ∪ Reversal) share plus mean R_h and X_h**; Partial/Sideways descriptive; k-grid always shown | **Changed** (headline restructure) |
| **D2** | Keep E and N (OD1 as drafted); consider renaming "Partial" | Unchanged rule; clarified |
| **D3** | Per-day header with actual values | Unchanged |
| **D4** | Token-stream hash of the **import-graph-derived** file list; remove `marketCapSegments.ts`; add `types/{config,metrics,dataset}.ts` | **Changed** |
| **D5** | Cut-off 09:15 IST judged on the **publishing commit**, verified after the fact; `live-late` excluded | **Changed** |
| **D6** | **One create-only valid-JSON file per trading day** (no `.jsonl`); verify `.jsonl` only in a scratch repo if ever needed | **Changed** |
| **D7** | Alerts-only watchdog (`contents: read`, `issues: write`); no `actions: write` | **Changed** |
| **D8** | Replay on orphan branch `ledger-replay` + deployed summary | **Changed** |
| **D9** | Approve R3/R4/R5 and add R9, R10 | **Extended** |
| **D10** | Watchdog 03:15/19:30 UTC; retries via extra capture cron slots (17:30, 21:00 UTC); no dispatch budget | **Changed** |
| **D11** | h=1 and h=5 resolved; you sign off; script-verified count | Unchanged |
| **D12** | Yes: operational panel only | Unchanged |
| **D13** | Yes: neutral naming | Unchanged |
| **D14** | Accept; live on `main`, replay off `main`; migration triggers defined | Refined |

### 8.2 Decisions I would change from the current design (summary)

1. Per-day create-only JSON files instead of monthly append shards (N3, D6).
2. Alerts-only, read-only watchdog; retries from extra scheduled capture runs (N6, D7, D10).
3. Replay on an orphan branch with a deployed summary (N1, D8).
4. Token-stream `ruleVersion` over the verified import graph (N5, D4).
5. `live` judged by the publishing commit (N7, D5).
6. Headline metrics restructured around Confirmed and Adverse (N9, D1).
7. Add R9/R10 and a `ledger-guard` workflow plus branch protection (N8, N11).
8. Keep governance tests out of the existing deploy/data jobs (N4).

### 8.3 Risks that remain unresolved

| Risk | Status |
|---|---|
| Pre-event σ understates next-day noise (mean |R₁|/σ = 0.94 vs 0.80) and 6.7% of σ windows contain a ≥3.5σ outlier | Disclosed; handled by flags and k-grid; cannot be removed without a new σ definition |
| Git-based immutability is conventional; public repo means the holdout seal is procedural | Mitigated by guard, branch protection, pre-registered hashes; cannot be cryptographic |
| Trust model for timestamps (runner clock, GitHub run times) | Adequate for self-audit, not adversarial |
| 250 completed sessions ≈ 12 months; ~1–1.5 years of live data before 5-point differences are detectable for the label | Intrinsic |
| Survivorship/membership: no point-in-time lists; size segment is a proxy | Intrinsic to data sources |
| Prices unadjusted; small bonuses/rights/dividends undetected; ≥15% gap-downs ambiguous | Disclosed; raw returns kept |
| Price bands/circuits not modelled | Disclosed |
| Pages artifact growth and deploy time | Triggers and remedy defined |
| `.jsonl` compression | Moot under per-day `.json` layout |
| Watchdog and capture could fail together | Residual; existing staleness indicators remain |

### 8.4 Exact design-document changes required before implementation

| Section | Change |
|---|---|
| Header / §1 | Mark Revision 3; record D1–D14 outcomes after you decide |
| §3.3 | Replace emitted-JS hashing with token-stream hashing; derive the file list from the import graph; drop `marketCapSegments.ts`; add `types/{config,metrics,dataset}.ts`; add the "import graph unchanged" test |
| §4 layout | Replace monthly `.jsonl` shards with per-day create-only `.json` files (`live/predictions/YYYY-MM-DD.json`, `live/outcomes/hN/YYYY-MM-DD.json`); baselines folded into the outcome day file; state/protocol files unchanged |
| §6, D8 | Replay on orphan branch `ledger-replay` + deployed `replay-summary.json`; fix the contradictory recommendation |
| §7 | Re-state storage tables for per-day files; add the Pages-artifact pruning remedy and migration triggers; correct "branch move shrinks the site" |
| §7.4 | Remove the `.jsonl` open item; add the scratch-repo verification procedure for reference |
| §8.1 | Add the `ledger-guard` workflow and branch protection; add two extra capture cron slots; move governance tests to a separate workflow (new D15) |
| §8.2 | Define `live` by the publishing commit; add `publishedClass` to `ledger-state` |
| §8.3 | Add R9 (`noBarToday[]`) and R10 (source-drift check); state R2 strictness trade-off |
| §8.4 | Replace shard rewrite with create-only atomic file writes; guard = additions only |
| §8.5 | Rewrite the watchdog row (permissions, holiday detection via `refresh-state`, stateless, alerts-only); correct the "silent watchdog" sentence |
| §9 | Add: floor independent of cost; headline metrics; Partial composition note |
| §10 | Add §3.4 composition table, outlier share, no-σ decomposition and the clustering finding |
| §12 | Align the "operational vs sealed" tables with `publishedClass`; add `ledger-guard` to enforcement |
| §13 | Add tests: import-graph drift, truncation invariance, additions-only guard, R9/R10, `publishedClass` reclassification, watchdog holiday logic, governance-test isolation |
| §14 | Replace with the final list below |

### 8.5 Final list of decisions requiring your explicit approval

**Must be decided before A1 ships (blocking):**

1. **D1** OD1 rules plus headline restructure (Confirmed share, Adverse share, mean R_h/X_h).
2. **D2** keep E and N; decide whether to rename "Partial".
3. **D3** per-day header with actual values.
4. **D4** token-stream `ruleVersion` over the import-graph file list.
5. **D5** `live` judged by the publishing commit.
6. **D6** per-day create-only `.json` files.
7. **D9** readiness thresholds incl. new R9/R10.
8. **D11** completed-session definition and sign-off.
9. **D14** storage acceptance, live on `main`, migration triggers.
10. **D15 (new)** run ledger governance tests in a separate workflow, not in `deploy.yml`/`update-data.yml`.
11. **D16 (new)** add `ledger-guard` workflow and enable branch protection (no force-push/deletion) on `main`.

**Decide now, may ship with A1 or shortly after:**

12. **D7** alerts-only watchdog permissions (`contents: read`, `issues: write`).
13. **D10** cadence and extra capture cron slots (17:30 and 21:00 UTC).

**Can wait (but D8 is time-sensitive):**

14. **D8** replay on an orphan branch (older raw prices are pruned a little each day).
15. **D12** operational panel (Phase D), **D13** filing ids (Phase B).

I have implemented none of this and I am stopping here pending your decisions.
