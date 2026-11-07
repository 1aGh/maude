#!/bin/bash
# usage: tabs-ab.sh 203|204 [lane]  — lane: five (default, my A/B spec) | cap (the shipped 2.0.4 tabs-cap lane)
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
E=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w204/apps/desktop/e2e
cp $S/ab-five-tabs.e2e.ts $E/scenarios/ab-five-tabs.e2e.ts
cp $S/wdio.ab-five-tabs.conf.ts $E/wdio.ab-five-tabs.conf.ts
V=$1; LANE=${2:-five}
OUT=$S/tabs/$LANE-v$V
rm -rf $OUT; mkdir -p $OUT/home/config
CONF=wdio.ab-five-tabs.conf.ts; [ $LANE = cap ] && CONF=wdio.tabs-cap.conf.ts
export PATH=/Users/iagh/.nvm/versions/node/v24.13.0/bin:$PATH
cd $E
env HOME=$OUT/home XDG_CONFIG_HOME= MAUDE_INDEX_DIR=$OUT/home/index NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1 \
  MAUDE_E2E_APP=$S/app-$V/Maude.app/Contents/MacOS/maude-desktop MAUDE_AB_OUT=$OUT \
  MAUDE_E2E_RUN_DIR=$OUT/project-tabs-cap-run \
  ./node_modules/.bin/wdio run ./$CONF > $OUT/wdio.log 2>&1
echo "wdio rc=$?"
grep -E 'AB-FIVE-TABS|passing|failing|✓|✖' $OUT/wdio.log | head -20
stat -f '%m %N' ~/.config/maude/prefs.json ~/.config/maude/hubs.json ~/.config/maude/cloud.json
pgrep -fl "scratchpad/ab/app-$V" | head
