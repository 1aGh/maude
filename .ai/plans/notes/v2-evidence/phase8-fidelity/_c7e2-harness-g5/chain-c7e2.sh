#!/bin/bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a0ce546028d99790d
export SHOTS_OUT=.scr/impl
for t in light dark; do
  for s in s14a s14b s14c; do
    bun .scr/run.mjs .scr/$s.mjs $t
    FX=gators bun .scr/run.mjs .scr/$s.mjs $t
  done
done
echo CHAIN-C7E2-DONE
