#!/bin/zsh
R=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a8e7c0c42105bd43c
cd $R
rm -f .scr/chain7b.done
for s in s11 s11b s11dl s11r2 s11k s11c7; do
  node .scr/run.mjs .scr/$s.mjs dark,light > .scr/$s.log 2>&1
done
node .scr/home11.mjs dark,light > .scr/home11.log 2>&1
echo done > .scr/chain7b.done
