#!/bin/bash
# usage: one.sh <scenario> — one 10 scenario, both themes, into .scr/impl10 (then flattened)
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a77a266636203291c
cd $R/.scr/g4 || exit 1
export SHOTS_OUT=$R/.scr/impl10/10-share-and-collaboration
unset SHOT_CHANNEL
node run.mjs $1.mjs ${THEMES:-dark,light} 2>&1 | grep -v "^skip" | tail -8
if [ -d $SHOTS_OUT/10-share-and-collaboration ]; then
  cp $SHOTS_OUT/10-share-and-collaboration/* $SHOTS_OUT/
  rm -rf $SHOTS_OUT/10-share-and-collaboration
fi
cp $SHOTS_OUT/* $R/.scr/impl/10-share-and-collaboration/
