#!/bin/bash
# D3 chain: one chromium chain at a time
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a1d011f1a56ad7ee9/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1d011f1a56ad7ee9/.scr/impl-out
run() { echo "=== $1 $2"; node run.mjs "$1.mjs" "$2" 2>&1 | grep -v "^ \|Call log" | cut -c1-1500; }
run s03a light
run s03b dark,light
run s03d dark,light
run s03c dark,light
run s03n dark,light
run s04a dark,light
run s04c dark,light
SHOT_CHANNEL=chrome run s04v dark,light
echo CHAIN-DONE
