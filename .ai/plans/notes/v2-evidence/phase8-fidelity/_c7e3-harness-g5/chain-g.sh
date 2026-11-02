#!/bin/bash
# ed-inspector (s14g) light + dark, then the ed-obj-order light retry (s14f retries the right-click until the menu is up)
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a7739a4d783013e2d
export SHOTS_OUT=.scr/impl
node .scr/run.mjs .scr/s14g.mjs light
node .scr/run.mjs .scr/s14g.mjs dark
node .scr/run.mjs .scr/s14f.mjs light
echo ALL-DONE
