#!/bin/bash
# Interleaved first-sync A/B: both clients against the 2.0.4 hub (bench-first-sync-pull.mjs from 2.0.4).
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
W3=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w203
W4=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w204
FILES=${FILES:-800}; LAT=${LAT:-250}; RUNS=${RUNS:-3}; TAG=${TAG:-cold}
export PATH=/Users/iagh/.nvm/versions/node/v24.13.0/bin:$PATH
mkdir -p $S/sync $S/fakehome/config
for r in $(seq 1 $RUNS); do
  for v in 203 204; do
    W=$W4; [ $v = 203 ] && W=$W3
    OUT=$S/sync/$TAG-v$v-r$r
    echo "== $TAG v$v run $r $(date +%T)"
    env HOME=$S/fakehome XDG_CONFIG_HOME=$S/fakehome/config MAUDE_INDEX_DIR=$S/fakehome/index NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1 \
      node $W4/scripts/bench-first-sync-pull.mjs --out $OUT --files $FILES --latency-ms $LAT --studio $W/apps/studio/server.ts --timeout 2400 --json > $S/sync/$TAG-v$v-r$r.stdout 2>&1
    echo "exit $? $(grep -o '"wallS": [0-9.null]*' $S/sync/$TAG-v$v-r$r.stdout) $(grep -o '"peakRssMB": [0-9]*' $S/sync/$TAG-v$v-r$r.stdout)"
    stat -f '%m %N' ~/.config/maude/prefs.json ~/.config/maude/hubs.json ~/.config/maude/cloud.json
  done
done
echo ALLDONE
