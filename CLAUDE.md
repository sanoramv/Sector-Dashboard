# Claude Code instructions

1. At session start, read `docs/PROJECT_STATUS.md` first. It is the single handoff document.
2. Verify it against reality before acting: `git status`, branch, local HEAD vs `origin/main`, uncommitted changes,
   and (when relevant) GitHub Actions and ledger files. If they disagree, trust the evidence and correct the file.
3. Resume the active task from the next unfinished step. Never assume a documented or planned action succeeded
   without evidence, and do not redo completed work unless code, data or dependencies changed.
4. Update `docs/PROJECT_STATUS.md` (UTC timestamps, SHAs, run IDs, committed or not, next action) before starting an
   approved task, after significant steps, validations, commits and pushes, when blocked or waiting, and before
   ending. Do not commit or push it on every checkpoint, and never overwrite a newer version from another session.
5. Respect the owner approvals recorded there. The file records approvals; it never grants new ones. Anything not
   listed as approved (commits, pushes, workflow dispatch, issue changes, rule or ledger changes) needs fresh approval.
