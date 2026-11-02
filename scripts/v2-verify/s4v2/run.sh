#!/bin/bash
# run.sh <probe-name>  : runs /private/tmp/claude-501/sc/p/<name>.js with pre.js prepended; evidence -> sc/ev
SC=/private/tmp/claude-501/sc
cat $SC/pre.js $SC/p/$1.js > $SC/p/_run_$1.js
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-af2a233f610c7fca6
S34_PORT=4482 S34_CDP=9384 node scripts/v2-verify/s34-rig.mjs run $SC/p/_run_$1.js $SC/ev 2>&1 | tail -${2:-60}
