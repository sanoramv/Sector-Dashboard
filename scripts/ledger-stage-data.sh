#!/usr/bin/env bash
# Stages the data update for the commit, used by update-data.yml in place of a plain `git add public/data`.
# Ledger changes are only allowed into the commit when LEDGER_SAFE=true (validated, or already rolled back).
# Otherwise they are unstaged and set aside, so an unvalidated ledger file can never be committed or pushed while
# the market-data changes are still committed. If that cannot be done, this script fails and nothing is committed.
set -euo pipefail
LEDGER="public/data/ledger"

git add public/data

if [ "${LEDGER_SAFE:-false}" != "true" ]; then
  echo "::error::Ledger changes are not validated; keeping them out of this commit."
  git reset -q -- "$LEDGER"
  git stash push --include-untracked --quiet -- "$LEDGER"
  if [ -n "$(git status --porcelain --untracked-files=all -- "$LEDGER")" ]; then
    echo "::error::Could not set the unvalidated ledger changes aside; refusing to commit."
    exit 1
  fi
fi
