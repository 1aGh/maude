#!/bin/bash
# Interleaved desktop webview A/B (bench-app-webview-mem.mjs from the measuring worktree).
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
BENCH=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a6af8c42584d7e241/scripts/bench-app-webview-mem.mjs
RUNS=${RUNS:-3}; TAG=${TAG:-app}; ORDER=${ORDER:-"203 204"}; SW=${SW:-40}; IDLE=${IDLE:-300}; GAP=${GAP:-4000}
export PATH=/Users/iagh/.nvm/versions/node/v24.13.0/bin:$PATH
mkdir -p $S/appruns $S/fakehome/config
for r in $(seq 1 $RUNS); do
  for v in $ORDER; do
    echo "== $TAG v$v run $r $(date +%T)"
    env HOME=$S/fakehome XDG_CONFIG_HOME=$S/fakehome/config MAUDE_INDEX_DIR=$S/fakehome/index NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1 \
      node $BENCH --app $S/app-$v/Maude.app --project $S/appfixture/project --out $S/appruns/$TAG-v$v-r$r \
        --switches $SW --gap $GAP --idle $IDLE > $S/appruns/$TAG-v$v-r$r.stdout 2>&1
    echo "exit $? $(tr -d '\n ' < $S/appruns/$TAG-v$v-r$r.stdout | grep -oE '"openStatuses.*"webContentProcs":[0-9]*')"
    stat -f '%m %N' ~/.config/maude/prefs.json ~/.config/maude/hubs.json ~/.config/maude/cloud.json
    sleep 5
    pgrep -fl "scratchpad/ab/app-$v" | head -3
  done
done
echo ALLDONE
