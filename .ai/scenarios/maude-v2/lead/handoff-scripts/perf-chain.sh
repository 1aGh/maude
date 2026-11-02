#!/bin/bash
# V2-8.14 index bench + V2-8.8/8.14 Chromium + WebKit perf, sequential, at the freeze head. Nothing else may run.
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad
cd /Users/iagh/git/personal/maude/.claude/worktrees/freeze || exit 1
export FARM_LOCAL=1 NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
H=$(git rev-parse --short HEAD); P=.ai/plans/notes/v2-evidence/p8-perf
BASE=fcc24f4dd2fb18808640eada339f623dee28ae50
A=$S/allig/a
L=$S/perf-chain.log; : > $L
log(){ echo "$(date +%T) $*" | tee -a $L; }
log "head=$H"
mkdir -p $P/freeze-$H-index
for n in 1 2; do
  rm -rf "$A/.design/_state"
  f=$P/freeze-$H-index/bench$([ $n = 2 ] && echo 2).txt
  bun scripts/v2-index-bench.ts --root "$A" > "$f" 2>&1; log "index run $n rc=$?"
done
rm -rf "$A/.design/_state"
bash scripts/v2-test-lane.sh -- scripts/v2-perf-bench.sh --base $BASE --order "v2 base" --lanes "studio bare panel peers lod" --repeat 7 --out $P/freeze-$H > $S/perf-chromium.log 2>&1
log "chromium v2-base rc=$?"; tail -12 $P/freeze-$H/summary.txt 2>/dev/null >> $L
bash scripts/v2-test-lane.sh -- scripts/v2-perf-bench.sh --base $BASE --order "base v2" --lanes "lod" --repeat 7 --out $P/freeze-$H-lod-ba > $S/perf-lod-ba.log 2>&1
log "chromium lod base-v2 rc=$?"; tail -6 $P/freeze-$H-lod-ba/summary.txt 2>/dev/null >> $L
for o in "base v2:ab" "v2 base:ba"; do
  ord=${o%:*}; tag=${o#*:}
  bash scripts/v2-test-lane.sh -- scripts/v2-perf-bench.sh --base $BASE --order "$ord" --lanes webkit --repeat 7 --out $P/webkit-$H-$tag > $S/perf-webkit-$tag.log 2>&1
  log "webkit $tag rc=$?"; tail -6 $P/webkit-$H-$tag/summary.txt 2>/dev/null >> $L
done
git status --short apps/studio/dist | head -3 >> $L
log PERFDONE
