#!/bin/bash
# V2-8.10 — the packaged .app at the freeze head, then its scripted checks. dist/ snapshotted by the lane.
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad
cd /Users/iagh/git/personal/maude/.claude/worktrees/freeze || exit 1
export FARM_LOCAL=1 NO_OPEN=1 MAUDE_NO_AUTOBUILD=1
H=$(git rev-parse --short HEAD); E=.ai/plans/notes/v2-evidence/V2-8.10-app-final
L=$S/app-build.log; : > $L
log(){ echo "$(date +%T) $*" | tee -a $L; }
log "head=$H"
bash scripts/v2-test-lane.sh --wait 3600 --max 7200 -- bash -c 'MAUDE_NO_AUTO_UPDATE=1 pnpm build:desktop' > $S/app-build-full.log 2>&1
log "build rc=$? (the updater signing step fails without a local key; the .app comes first)"
APP=apps/desktop/src-tauri/target/release/bundle/macos/Maude.app
[ -d "$APP" ] || { log "NO APP"; exit 1; }
log "app $(du -sh $APP | cut -f1) $(defaults read "$PWD/$APP/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null) built $(stat -f %Sm $APP)"
mkdir -p $E
node apps/desktop/scripts/check-bundle-completeness.mjs "$APP" --smoke > $E/bundle-completeness-smoke.tail.txt 2>&1; log "bundle-completeness --smoke rc=$?"; tail -2 $E/bundle-completeness-smoke.tail.txt >> $L
node apps/desktop/scripts/check-client-boots.mjs "$APP" > $E/client-boots.tail.txt 2>&1; log "client-boots rc=$?"; tail -2 $E/client-boots.tail.txt >> $L
log "wdio symbols in release binary: $(strings "$APP/Contents/MacOS/maude-desktop" 2>/dev/null | grep -ci wdio)"
OC=$(ls scripts/*opening-card-clears*.mjs apps/studio/bin/*opening-card*.mjs 2>/dev/null | head -1)
[ -n "$OC" ] && { node "$OC" > $E/opening-card.tail.txt 2>&1; log "opening-card ($OC) rc=$?"; tail -2 $E/opening-card.tail.txt >> $L; }
git status --short apps/studio/dist | head -3 >> $L
log APPDONE
