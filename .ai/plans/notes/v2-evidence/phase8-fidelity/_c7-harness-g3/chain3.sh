#!/bin/bash
# round 7 chain for canvas 09: t09 (all), then the three round-7 scenarios overwrite their ids
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a77a266636203291c
cd $R/.scr/g3 || exit 1
rm -f chain3.done
for th in dark light; do
  ./go.sh t09 $th > t09-$th.log 2>&1
  for s in ho vid adv; do ./go.sh $s $th > $s-$th.log 2>&1; done
done
echo done > chain3.done
