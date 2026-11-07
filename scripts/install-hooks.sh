#!/usr/bin/env bash
# Points this checkout's git at scripts/hooks, so the pre-push hook's quick
# checks run before every push. Run once per clone; worktrees share the
# clone's settings, and each runs the hook from its own scripts/hooks.
#
#   scripts/install-hooks.sh            install
#   scripts/install-hooks.sh --remove   back to git's own .git/hooks
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--remove" ]; then
  git config --unset core.hooksPath || true
  echo "git hooks: back to .git/hooks"
else
  chmod +x scripts/hooks/*
  git config core.hooksPath scripts/hooks
  echo "git hooks: scripts/hooks (pre-push runs the quick checks; skip with --no-verify or SKIP_HOOKS=1)"
fi
