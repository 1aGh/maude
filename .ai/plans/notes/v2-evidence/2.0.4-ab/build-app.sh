#!/bin/bash
# Debug e2e build (bundle id com.maude.app.e2e, scheme maude-e2e) of one tree, into a private cargo target.
# usage: build-app.sh 203|204
set -o pipefail
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/ab
W=/Users/iagh/git/personal/maude/.claude/worktrees/ab-w$1
FREE=$(df -g / | awk 'NR==2{print $4}')
echo "free ${FREE} GB"
if [ "$FREE" -lt 25 ]; then echo "STOP: under 25 GB free"; exit 9; fi
export PATH="$HOME/.cargo/bin:/Users/iagh/.nvm/versions/node/v24.13.0/bin:$PATH"
export CARGO_TARGET_DIR=$S/target
export MAUDE_SKIP_KG_SYNC=1 MAUDE_SKIP_RUNTIME_BUILD=1 FARM_LOCAL=1 NO_OPEN=1
cd $W/apps/studio
bun run build.ts --release > $S/build-$1-studio.log 2>&1 || { echo "studio build failed"; exit 8; }
ls -la $W/apps/studio/dist/ | grep maude-
cd $W/apps/desktop
./node_modules/.bin/tauri build --debug --config src-tauri/tauri.e2e.conf.json > $S/build-$1.log 2>&1
rc=$?
echo "build rc=$rc"
if [ $rc = 0 ]; then
  rm -rf $S/app-$1 && mkdir -p $S/app-$1 && cp -cR $CARGO_TARGET_DIR/debug/bundle/macos/Maude.app $S/app-$1/ && echo "copied $S/app-$1/Maude.app"
fi
df -h / | tail -1
