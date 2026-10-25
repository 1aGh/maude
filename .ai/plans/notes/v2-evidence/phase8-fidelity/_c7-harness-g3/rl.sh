#!/bin/bash
# usage: rl.sh <NN> <theme>  — like ri.sh but does NOT wipe impl/NN (re-shoot one theme only)
NN="$1"; TH="$2"
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a77a266636203291c/.scr || exit 1
SHOT_CHANNEL=chrome SHOTS_OUT=$PWD/impl ROWS=rows-$NN-$TH.jsonl node run.mjs t$NN.mjs $TH 2>&1 | grep -v '^skip\|^shot\|^pageerrors' | tail -20
