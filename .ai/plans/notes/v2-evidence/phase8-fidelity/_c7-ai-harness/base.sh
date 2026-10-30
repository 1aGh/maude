#!/bin/bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-abc3d018bba1d4c49/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-abc3d018bba1d4c49/.scr/impl-out
THEMES=${THEMES:-dark}
for s in "$@"; do echo "=== $s"; node run.mjs $s.mjs $THEMES 2>&1 | grep -v "^ \|Call log" | cut -c1-400; done
echo CHAIN-DONE
