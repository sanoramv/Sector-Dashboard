#!/usr/bin/env bash
# Fail-safe restore, run by update-data.yml when the ledger pre-commit validation did not finish.
# Puts public/data/ledger back exactly as it is in the last commit (HEAD). It touches nothing else, so market-data
# files outside the ledger directory are never reset or deleted.
set -euo pipefail
LEDGER="public/data/ledger"

# Restore tracked ledger files (skip if HEAD has none yet), then remove everything else under the ledger directory.
# (Command substitution reads the whole listing. `git ls-tree | grep -q .` is NOT safe here: with a large ledger grep
# exits early, git is cut off, and `pipefail` turns the test into "false" so the restore would be silently skipped.)
if [ -n "$(git ls-tree -r --name-only HEAD -- "$LEDGER")" ]; then
  git restore --source=HEAD --staged --worktree -- "$LEDGER"
fi
git clean -fdx -- "$LEDGER"

# Prove it: nothing may be left pending under the ledger directory.
if [ -n "$(git status --porcelain --ignored --untracked-files=all -- "$LEDGER")" ]; then
  echo "::error::The ledger directory is not clean after the fail-safe restore."
  exit 1
fi
echo "Ledger directory restored to HEAD."
