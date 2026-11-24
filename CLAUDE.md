# Claude Code instructions

## Session start and handoff
1. At session start, read `docs/RESUME.md` (self-contained handover and task checklist), then `docs/PROJECT_STATUS.md`
   (detailed log and approvals). Resume from disk: never rely on earlier conversations, compaction summaries, caches
   or background processes, and never ask the owner to repeat a previous conversation.
2. Verify them against reality before acting: `git status`, branch, local HEAD vs `origin/main`, uncommitted changes,
   and (when relevant) GitHub Actions, ledger files and `research-data/nse/manifest.jsonl`. If they disagree, trust the
   evidence and correct the files.
3. Resume the active task from the next unfinished step. Never assume a documented or planned action succeeded
   without evidence, and do not redo completed work (research, audits, downloads) unless code, data or dependencies
   changed.
4. Update `docs/PROJECT_STATUS.md` and `docs/RESUME.md` (UTC timestamps from `date -u`, SHAs, run IDs, committed or
   not, next action) before starting an approved task, after every meaningful milestone, validation, commit and push,
   when blocked or waiting, and before ending or when context is running low. Do not commit or push them on every
   checkpoint, and never overwrite a newer version from another session.
5. Respect the owner approvals recorded there. The files record approvals; they never grant new ones. Routine
   technical decisions, implementation, testing and ordinary local commits are delegated; anything listed as needing
   owner approval (for example replacing production prediction logic, pushes not yet approved) needs fresh approval.

## Project purpose and priorities
6. This is a **personal NSE research platform** used only by the owner. The primary objectives are prediction
   accuracy, signal quality and understanding stock behaviour (approximate priorities: 45% prediction accuracy, 25%
   historical research, 20% live outcome evaluation, 8% data and application reliability, 2% security and governance).
7. Keep security and governance proportionate: basic credential safety, data integrity, reproducibility and protection
   against accidental corruption. Do not build enterprise infrastructure or run broad security audits.
8. Prefer delivering research findings over long architecture documents.

## Research and prediction integrity
9. Existing prediction versions (production `mv1-8ecef864`) and their records are never retrospectively modified or
   backfilled. Experimental predictions get their own deterministic version identifiers and are evaluated only on
   sessions captured before their outcome windows begin.
10. Distinguish clearly between exploratory historical findings (in-sample, already examined), independent historical
    validation (pre-declared, on a newly examined period) and prospective live/shadow evaluation. Never tune on a
    dataset and then call results on that same dataset independent validation.
11. Avoid look-ahead bias, survivorship bias, corporate-action distortion, data leakage, overfitting, multiple-testing
    errors and treating same-session stocks as independent. Freeze definitions, metrics and multiplicity rules before
    looking at new results. Report negative findings as clearly as positive ones; never call a share a probability
    unless it is validated.
12. Never change the sealed OD1 definitions (`public/data/ledger/protocol/od1.json`) or `holdout.json`. The evaluation
    policy (`protocol/evaluation-policy.json`, continuous monitoring) is create-only.
13. Raw research datasets stay local in the git-ignored `research-data/` folder; never commit them or mix them with
    production `public/data` before their quality is established.
14. Outcome and research jobs must never block the scheduled market-data update or prediction capture.

## Git
15. Use only the personal Git identity `Santhosh Ram V <santhoshramv@yahoo.com>`. Never include employer-related
    names, emails or references in personal project files or commits.
16. Never force-push, rebase, amend or rewrite history. Integrate automated data commits with an ordinary merge and
    stop on unexpected changes or conflicts.
