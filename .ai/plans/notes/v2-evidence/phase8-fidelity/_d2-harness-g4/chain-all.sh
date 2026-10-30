#!/bin/zsh
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a88fc0565d3f0bdf8
node .scr/run.mjs .scr/s10c.mjs dark,light > .scr/s10c.log 2>&1
node .scr/run.mjs .scr/s10d.mjs dark,light > .scr/s10d.log 2>&1
node .scr/run.mjs .scr/s11.mjs dark,light > .scr/s11.log 2>&1
node .scr/run.mjs .scr/s11e.mjs dark,light > .scr/s11e.log 2>&1
node .scr/run.mjs .scr/s11b.mjs dark,light > .scr/s11b.log 2>&1
node .scr/run.mjs .scr/s11d.mjs dark,light > .scr/s11d.log 2>&1
node .scr/run.mjs .scr/s11ds.mjs dark,light > .scr/s11ds.log 2>&1
node .scr/strip-shoot.mjs > .scr/strip.log 2>&1
node .scr/home11.mjs dark,light > .scr/home11.log 2>&1
node .scr/run.mjs .scr/s12.mjs dark,light > .scr/s12.log 2>&1
node .scr/run.mjs .scr/s12b.mjs dark,light > .scr/s12b.log 2>&1
node .scr/run.mjs .scr/s12e.mjs dark,light > .scr/s12e.log 2>&1
echo done > .scr/chain-all.done
