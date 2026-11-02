#!/bin/bash
# usage: rx.sh <scenario-name-without-ext> [themes]  — exploratory: frames to out/, rows to rows-x.jsonl
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a595be579d5cc0243/.scr || exit 1
SHOTS_OUT=$PWD/out ROWS=rows-x.jsonl node run.mjs $1.mjs ${2:-light} 2>&1 | tail -30
