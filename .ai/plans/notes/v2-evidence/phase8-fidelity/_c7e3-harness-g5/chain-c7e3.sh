#!/bin/bash
# c7-edit3 re-shoot: ed-inspector (Advanced open), ed-edge-keys, ed-edge-paste, ed-obj-order (+ the two side shots)
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a7739a4d783013e2d
export SHOTS_OUT=.scr/impl
for t in "$@"; do
  node .scr/run.mjs .scr/s14b.mjs $t
  node .scr/run.mjs .scr/s14e.mjs $t
  node .scr/run.mjs .scr/s14f.mjs $t
done
echo CHAIN-C7E3-DONE
