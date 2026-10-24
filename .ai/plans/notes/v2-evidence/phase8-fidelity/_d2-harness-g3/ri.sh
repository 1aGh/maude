#!/bin/bash
# usage: ri.sh <NN> [themes]   — runs tNN.mjs, rows to rows-NN.jsonl, frames to impl/NN
NN="$1"; TH="${2:-light,dark}"
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a595be579d5cc0243/.scr || exit 1
rm -f rows-$NN.jsonl
rm -rf impl/$NN
SHOTS_OUT=$PWD/impl ROWS=rows-$NN.jsonl node run.mjs t$NN.mjs $TH 2>&1 | grep -v '^skip' | tail -40
