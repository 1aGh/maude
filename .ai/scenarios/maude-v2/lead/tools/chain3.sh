#!/bin/bash
# 8.1 (no screen) → wait for the screen conditions → 8.3 → 8.2, at the merged head.
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad
L=$S/rec/chain3.log; cd /Users/iagh/git/personal/maude; H=$(git rev-parse HEAD)
echo "$(date +%T) chain3 head=${H:0:9}" >> $L
NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 node scripts/v2-gates.mjs --record V2-8.1 > $S/night/v2-8.1.log 2>&1
echo "$(date +%T) V2-8.1 rc=$? $(tail -1 $S/night/v2-8.1.log) dist=$(git status --short apps/studio/dist | wc -l)" >> $L
python3 -c "import json,sys;d=json.load(open('.ai/scenarios/maude-v2/gates/V2-8.1.json'));sys.exit(0 if d['pass'] and d['head']=='$H' else 1)" || { echo "$(date +%T) 8.1 not green, stop" >> $L; exit 5; }
ok=0; end=$(( $(date +%s) + 7200 ))
while [ $ok -lt 3 ]; do
  [ $(date +%s) -gt $end ] && { echo "$(date +%T) GIVE UP: screen conditions never held" >> $L; exit 3; }
  bl=$(pgrep -x Blender | wc -l | tr -d ' '); arc=$(pgrep -x Arc >/dev/null && echo yes || echo no)
  fo=$(ps -axo command | grep -E 'src-tauri/target/debug.*maude-server' | grep -v grep | wc -l | tr -d ' ')
  load=$(sysctl -n vm.loadavg | awk '{print $2}')
  if [ "$bl" = 0 ] && [ "$arc" = no ] && [ "$fo" = 0 ] && awk "BEGIN{exit !($load < 14)}"; then ok=$((ok+1)); else ok=0; fi
  echo "$(date +%T) blender=$bl arc=$arc foreign=$fo load=$load ok=$ok" >> $L
  [ $ok -lt 3 ] && sleep 60
done
echo "$(date +%T) START V2-8.3" >> $L
bash $S/rec/record.sh; rc=$?
echo "$(date +%T) V2-8.3 rc=$rc" >> $L; cat $S/rec/summary.txt >> $L
[ $rc = 0 ] || exit 1
NO_OPEN=1 node scripts/v2-gates.mjs --record V2-8.2 > $S/night/v2-8.2.log 2>&1
echo "$(date +%T) V2-8.2 rc=$? $(tail -1 $S/night/v2-8.2.log)" >> $L
