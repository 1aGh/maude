#!/bin/bash
# usage: go.sh <scenario-stem> [themes]
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a45b4750975bd8337/.scr/impl || exit 1
export SHOTS_OUT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a45b4750975bd8337/.scr/impl-out
node run.mjs "$1.mjs" "${2:-dark,light}" 2>&1 | grep -v "^ \|Call log"
