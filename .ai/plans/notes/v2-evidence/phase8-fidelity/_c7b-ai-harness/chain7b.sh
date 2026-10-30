#!/bin/bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a90250e5bf24e5b43/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a90250e5bf24e5b43/.scr/impl-out
for s in s03a s03e s03d s03c s03n s03g s03h s03i; do echo "=== $s"; node run.mjs $s.mjs dark,light 2>&1 | grep -v "^ \|Call log" | cut -c1-300; done
echo CHAIN-DONE
