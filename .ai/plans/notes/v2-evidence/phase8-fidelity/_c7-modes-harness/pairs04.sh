#!/bin/bash
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a6255adf6e5f08985/.scr || exit 1
export ONLY=$(python3 -c "
import json
m=json.load(open('pairs-map-d3.json'))
print(','.join(m['04-modes']['ids'].keys()))")
export MAP=pairs-map-d3.json
node pairs.mjs > pairs.log 2>&1
tail -3 pairs.log
