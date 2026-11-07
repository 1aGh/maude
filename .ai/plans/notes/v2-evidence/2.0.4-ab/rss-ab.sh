#!/bin/bash
# Interleaved server idle-RSS A/B (bench-server-idle-rss.mjs from the measuring worktree).
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
W3=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w203
W4=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w204
BENCH=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a6af8c42584d7e241/scripts/bench-server-idle-rss.mjs
CANV=${CANV:-120}; IDLE=${IDLE:-300}; RUNS=${RUNS:-3}; TAG=${TAG:-rss}; ORDER=${ORDER:-"203 204"}
export PATH=/Users/iagh/.nvm/versions/node/v24.13.0/bin:$PATH
mkdir -p $S/rss $S/fakehome/config
for r in $(seq 1 $RUNS); do
  for v in $ORDER; do
    W=$W4; [ $v = 203 ] && W=$W3
    echo "== $TAG v$v run $r $(date +%T)"
    env HOME=$S/fakehome XDG_CONFIG_HOME=$S/fakehome/config MAUDE_INDEX_DIR=$S/fakehome/index NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1 \
      PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright \
      node $BENCH --tree $W ${BIN:+--bin $W/apps/studio/dist/maude-darwin-arm64} --out $S/rss/$TAG-v$v-r$r --canvases $CANV --idle $IDLE --chromium /Users/iagh/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell --json > $S/rss/$TAG-v$v-r$r.stdout 2>&1
    echo "exit $? $(tr -d '\n ' < $S/rss/$TAG-v$v-r$r.stdout | grep -o '"opened.*idleTreeCpuMean":[0-9.]*')"
    stat -f '%m %N' ~/.config/maude/prefs.json ~/.config/maude/hubs.json ~/.config/maude/cloud.json
  done
done
echo ALLDONE
