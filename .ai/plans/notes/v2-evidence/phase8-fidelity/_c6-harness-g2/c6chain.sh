#!/bin/bash
# round 6 chain: one chromium chain at a time
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-ad6307ded82bdaa41/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-ad6307ded82bdaa41/.scr/impl-out
run() { echo "=== $1 $2"; node run.mjs "$1.mjs" "$2" 2>&1 | grep -v "^ \|Call log" | cut -c1-1500; }
run s03a dark,light
run s03e dark,light
run s03d dark,light
run s03c dark,light
run s03n dark,light
run s01ai dark,light
echo CHAIN-DONE
