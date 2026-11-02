#!/bin/bash
# usage: chain.sh "s03a light" "s03b dark,light" ...
cd /Users/iagh/git/personal/maude/.claude/worktrees/agent-a948527cf7721a4d9/.scr/impl || exit 1
for s in "$@"; do
  set -- $s
  echo "=== $1 $2"
  bash go.sh $1 ${2:-dark,light}
done
echo CHAIN-DONE
