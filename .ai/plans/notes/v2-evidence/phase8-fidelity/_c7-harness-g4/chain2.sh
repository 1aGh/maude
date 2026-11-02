#!/bin/bash
# round 7 chain for canvas 10: impl frames land in .scr/impl10/10-share-and-collaboration
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a77a266636203291c
cd $R/.scr/g4 || exit 1
mkdir -p $R/.scr/impl10/10-share-and-collaboration
export SHOTS_OUT=$R/.scr/impl10/10-share-and-collaboration
unset SHOT_CHANNEL
rm -f chain.done
for s in s10 s10cm s10c s10d s10e s10m; do
  node run.mjs $s.mjs ${THEMES:-dark,light} > $s.log 2>&1
done
echo done > chain.done
