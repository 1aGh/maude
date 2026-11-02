#!/bin/zsh
# round 7 chain for canvases 11 + 12 (g1112b). Later scripts overwrite earlier frames of the same id.
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a8e7c0c42105bd43c
cd $R
unset SHOT_CHANNEL
rm -f .scr/chain7.done
T=${THEMES:-dark,light}
for s in s11 s11e s11b s11d s11r2 s11k s11c7; do
  node .scr/run.mjs .scr/$s.mjs $T > .scr/$s.log 2>&1
done
node .scr/run.mjs .scr/s11ds7.mjs $T > .scr/s11ds7.log 2>&1
node .scr/strip-shoot.mjs > .scr/strip.log 2>&1
node .scr/home11.mjs $T > .scr/home11.log 2>&1
for s in s12 s12b s12e s12f s12g s12h s12c7; do
  node .scr/run.mjs .scr/$s.mjs $T > .scr/$s.log 2>&1
done
echo done > .scr/chain7.done
