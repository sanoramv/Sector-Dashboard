# OD1 private outcome pipeline: architecture and provisioning (Phase B2a)

**Status (2026-11-23):** Phase B2a is a local foundation only. Nothing described as "B2b" exists yet: no private repository, GitHub App, secret, workflow, activation record or live outcome. The code refuses real dates (`SYNTHETIC_ONLY`) and refuses to run outside a declared private context.

## 1. Trust boundaries

| Public repository `sanoramv/Sector-Dashboard` | Private repository (B2b, to be created by the owner) |
|---|---|
| Prediction capture, prediction records and prediction receipts | OD1 outcome calculation (`outcome-runner.mts`, shared engine `od1.mts`) |
| Market data (`public/data/*.json`) and `refresh-state.json` | Protected outcome records `od1/<rv>/<date>/h<h>.json` |
| Public outcome receipts `live/outcome-receipts/<rv>/<date>/h<h>[.c<n>].json` | Outcome validation (re-derivation) and reconciliation |
| Public guard: immutability, receipt whitelist, binding, eligibility, leak scan | Private correction records and replacements |
| Holdout eligibility (`computeLiveHoldout`), the sealed protocol and `holdout.json` | Sealed evaluation logic (only after the owner unblinds) |

What may cross the boundary:

- **Public → private:** public data only (prediction files, receipts, market data, the guard's eligibility). It is read anonymously, pinned to a commit SHA, and that SHA is recorded as `data.commit` in every record.
- **Private → public:** only receipts that have passed `validateOutcomeReceipt` and `receiptLeakProblems`. A receipt holds session date, horizon, end date, prediction count, the public prediction file identity (path and hashes), protocol and engine identifiers, the private storage key, a salted commitment and its time.
- **Never public:** classes, returns, flags, per-stock values, availability counts, salts, unsalted outcome hashes, private correction reasons, or any aggregate.

A public workflow can never receive protected values:

- No public workflow calls the pipeline (tested).
- The pipeline throws when `GITHUB_REPOSITORY` is the public repository or when `OD1_PROTECTED_CONTEXT` is not declared.
- The public repository holds no credential that can read the private one.

Confidentiality caveat: OD1 outcomes are deterministic functions of public market data, so anyone can compute them independently. The seal protects the **process**: nothing about outcomes is published, displayed or analysed by this project before unblinding. The salted commitment also means a receipt cannot be used to confirm a guess.

## 2. Cross-repository authentication

| Need | Mechanism | Secret needed? |
|---|---|---|
| Private workflow reads the public repository | Anonymous HTTPS clone or fetch of a pinned SHA | No |
| Private workflow writes its own records | Its own `GITHUB_TOKEN`, with `contents: write` on that job only | No |
| Private workflow opens operational alert issues | Its own `GITHUB_TOKEN` with `issues: write`, so alerts stay in the private repository | No |
| Private workflow publishes receipts to the public repository | **GitHub App "OD1 receipt publisher"**, installed ONLY on the public repository with `contents: write` and the mandatory `metadata: read` | App private key, as a secret of a private-repository Environment limited to `main` |

**Receipt publication** uses the Contents API: `PUT /repos/sanoramv/Sector-Dashboard/contents/public/data/ledger/live/outcome-receipts/...` without a `sha`.

- GitHub refuses the call if the file exists, which gives server-side create-only semantics.
- Each call is one commit on top of the current `main`, so there is no clone, merge or rebase, and no race with the data-update bot.
- Before writing, the step compares an existing file with the expected bytes: identical means `existing`, different means `conflict`.
- The installation token is minted per job by `actions/create-github-app-token` (pinned by commit SHA), scoped to `repositories: Sector-Dashboard`, and expires after one hour.

**Why not the other options:**

- A read credential stored in the public repository would expose every outcome if it leaked.
- A fine-grained PAT acts as the owner and is long-lived.
- A deploy key is permanent and SSH-only.
- `GITHUB_TOKEN` cannot cross repositories.

**Residual risk:** the App can write any path in the public repository. This is mitigated by:

- the public immutability guard, which runs on every push and only ever allows additions under `live/`;
- receipt validation;
- force-push and deletion protection on public `main`;
- the publisher step being a few lines of code that only target `live/outcome-receipts/`.

**Rotation:** generate a second key, update the secret, verify one run, then delete the old key. On suspicion of a leak, delete the key and suspend the installation. Rotate at least every 6 months.

## 3. Run order, failure handling and recovery

The run order is in `outcome-pipeline.mts`:

1. Check that private storage is reachable. If it isn't, alert `private-storage-unavailable` and stop; nothing is computed.
2. **Reconcile:**
   - Every public receipt must have its record and commit to it exactly. If not (`missing-private-evidence`, `receipt-mismatch`), alert and **stop**. It is never repaired.
   - A record without a receipt (an interrupted run) gets its receipt published from the **stored** record.
3. **Plan** each eligible live session from the activation date, at h = 1, 2, 5 and 10. A horizon is pending until mature on the NIFTY 500 calendar.
4. For each due horizon:
   1. Build the record (pure).
   2. Write it create-only to private storage, then push.
   3. Read it back and compare.
   4. Only then publish the receipt, built from the stored record and timed by its `generatedAt`. A retry is byte-identical, so it gets `existing`.
5. Report keys and fixed codes only. In B2b, alerts become private-repository issues.

| Situation | Result |
|---|---|
| Record stored, receipt pending | Next run publishes it (`recovered`) |
| Record and receipt present | Verified on every run |
| Receipt without record | `missing-private-evidence`; run stops; nothing changed |
| Different content for a stored key | `record-conflict`; nothing overwritten |
| Network failure before the private write | Nothing written anywhere; retry next run |
| Network failure after the private write | No receipt this run; next run recovers |
| Duplicate invocation | No change |
| Concurrent invocations | One record (one salt) and one receipt per key |
| Receipt publication failure | `receipt-publish-error`; record stays private; next run recovers |

In B2b, the private workflow uses one concurrency group, `od1-outcomes`, with `cancel-in-progress: false`. Store-level create-only semantics make concurrent runs safe regardless.

**Data-update workflows are unaffected:** the pipeline lives in another repository and shares no job, secret or gate with `update-data.yml`. If it fails, predictions, market data and Pages carry on.

## 4. Storage

- **Size:** about 1 MB raw per session across all four horizons, about 190 KB compressed. That is about 50 MB in Git for 250 sessions and about 200 MB for 1,000.
- **Retention:** kept forever (append-only).
- **Corrections:**
  - stored beside the original as `h<h>.replacement-<n>.json` and `h<h>.correction-<n>.json`;
  - published as `h<h>.c<n>.json`, which carries the chain and reason code only;
  - the original stays authoritative until the owner decides how corrections are treated in analysis.

## 5. Provisioning requirements (B2b; owner actions, NOT done)

1. **Private repository:**
   - Create it, for example `sanoramv/sector-dashboard-od1`. Visibility private, no collaborators, Issues on, Actions on.
   - Default workflow token: read-only.
   - Rulesets on `main`: block force pushes, restrict deletions, no bypass actors. On a personal account this needs **GitHub Pro**.
2. **GitHub App:**
   - Owner-created, no webhook.
   - Repository permissions: Contents read and write, Metadata read; nothing else.
   - Install it on **only** `sanoramv/Sector-Dashboard`.
3. **Environment and secrets in the private repository:**
   - Environment `receipt-publish`, with deployment branches limited to `main`.
   - Secret `OD1_PUBLISHER_PRIVATE_KEY`; variable `OD1_PUBLISHER_APP_ID`.
4. **Public `main`:** confirm that force-push and deletion protection are active.
5. **Code in the private repository:**
   - The engine files listed in `ENGINE_FILES`, copied from a pinned public commit.
   - Its engine version must equal the version recorded by the public tests.
6. **Activation, owner-approved and create-only:**
   - A public activation record with `outcomesFrom`.
   - A reviewed commit that sets `SYNTHETIC_ONLY = false`.
   - Any catch-up for sessions from 19 Nov is a separate, explicit approval.

## 6. Disabled example workflow (documentation only; NOT installed anywhere)

```yaml
# Example for the PRIVATE repository only. Never place this in the public repository.
name: OD1 outcomes (private)
on:
  schedule:
    - cron: "30 20 * * 1-5" # after the public evening data update
permissions: {}
concurrency: { group: od1-outcomes, cancel-in-progress: false }
jobs:
  outcomes:
    if: false # DISABLED: B2b activation requires explicit owner approval
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions: { contents: write, issues: write }
    environment: receipt-publish
    env: { OD1_PROTECTED_CONTEXT: private-outcome-repository }
    steps:
      - uses: actions/checkout@<pinned-sha> # the private repository (records + engine)
        with: { persist-credentials: true }
      - run: git clone --filter=blob:none https://github.com/sanoramv/Sector-Dashboard "$RUNNER_TEMP/public" && git -C "$RUNNER_TEMP/public" checkout "$PUBLIC_SHA"
      - run: npm ci --ignore-scripts
      - run: npx tsx scripts/od1-run.mts --public "$RUNNER_TEMP/public" --store "$GITHUB_WORKSPACE/records" # writes records only
      - run: git add records && git commit -m "od1 records" && git push # private push BEFORE any receipt
      - uses: actions/create-github-app-token@<pinned-sha>
        id: app
        with: { app-id: "${{ vars.OD1_PUBLISHER_APP_ID }}", private-key: "${{ secrets.OD1_PUBLISHER_PRIVATE_KEY }}", owner: sanoramv, repositories: Sector-Dashboard }
      - run: npx tsx scripts/od1-publish-receipts.mts # Contents API, create-only, validated receipts only
        env: { GH_TOKEN: "${{ steps.app.outputs.token }}" }
```
