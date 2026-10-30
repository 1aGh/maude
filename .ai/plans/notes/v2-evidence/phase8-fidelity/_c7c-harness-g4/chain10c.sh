#!/bin/bash
# round 7c chain for canvas 10: every scenario, both themes, into .scr/impl10 then flattened into .scr/impl/10-share-and-collaboration
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a304382bb7d0b37dc
cd $R/.scr/g4 || exit 1
mkdir -p $R/.scr/impl10/10-share-and-collaboration $R/.scr/impl/10-share-and-collaboration
export SHOTS_OUT=$R/.scr/impl10/10-share-and-collaboration
unset SHOT_CHANNEL
rm -f chain10c.done
for s in ${SCNS:-s10 s10cm s10c s10d s10e s10m}; do
  node run.mjs $s.mjs ${THEMES:-dark,light} > $s.log 2>&1
  if [ -d $SHOTS_OUT/10-share-and-collaboration ]; then
    cp $SHOTS_OUT/10-share-and-collaboration/* $SHOTS_OUT/
    rm -rf $SHOTS_OUT/10-share-and-collaboration
  fi
  cp $SHOTS_OUT/*.png $R/.scr/impl/10-share-and-collaboration/ 2>/dev/null
done
echo done > chain10c.done
