#!/bin/bash
# round 7 chain for 04 Modes: one chromium chain at a time
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a6255adf6e5f08985/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a6255adf6e5f08985/.scr/impl-out
run() { echo "=== $1 $2"; node run.mjs "$1.mjs" "$2" 2>&1 | grep -v "^ \|Call log\|WARNING\|^$" | cut -c1-600; }
run s04a dark,light
run s04c dark,light
SHOT_CHANNEL=chrome run s04v dark,light
run s04d dark,light
run s04k dark,light
echo CHAIN-DONE
