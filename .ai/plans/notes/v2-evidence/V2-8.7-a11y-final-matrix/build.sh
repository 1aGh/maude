#!/bin/bash
# release-build the studio client in the worktree (dist/ is reverted at the end, never committed)
cd /Users/iagh/git/personal/maude/.claude/worktrees/a11y-run/apps/studio || exit 1
FARM_LOCAL=1 MAUDE_SKIP_RUNTIME_BUILD=1 MAUDE_NO_AUTOBUILD=1 bun run build.ts --release 2>&1 | tail -1
