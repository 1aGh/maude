#!/bin/bash
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad
R=62146d9d4
cd /Users/iagh/git/personal/maude/.claude/worktrees/lead-merge-2 || exit 1
ssh hub 'ls ~/Library/Caches/ms-playwright | grep -q chromium_headless_shell-1228' || { echo "NO PLAYWRIGHT CACHE"; exit 9; }
FARM_LOCAL=1 scripts/remote-lane.sh --rev $R --slot 2 --max 3600 --fetch .ai/scenarios/maude-v2/V2-8.4-freeze -- bash -c "$(cat $S/remote/p84-remote.sh)" _ fz .ai/scenarios/maude-v2/V2-8.4-freeze 4787 4386 > $S/remote/r6-p84-fz.log 2>&1
echo "p84 fz rc=$? $(tail -1 $S/remote/r6-p84-fz.log)"
FARM_LOCAL=1 scripts/remote-lane.sh --rev $R --slot 2 --max 3600 --fetch .ai/scenarios/maude-v2/V2-8.4-freeze-v1fmt -- bash -c "$(cat $S/remote/p84-remote.sh)" _ leg .ai/scenarios/maude-v2/V2-8.4-freeze-v1fmt 4788 4387 1 > $S/remote/r6-p84-leg.log 2>&1
echo "p84 legacy rc=$? $(tail -1 $S/remote/r6-p84-leg.log)"
FARM_LOCAL=1 scripts/remote-lane.sh --rev $R --slot 2 --max 7200 --fetch .ai/plans/notes/v2-evidence/V2-8.5-browser-runs/all-$R -- bash -c "$(cat $S/remote/allbrowser.sh)" _ all-$R > $S/remote/r6-allbrowser.log 2>&1
echo "allbrowser rc=$? fails=$(grep -c 'rc=[1-9]' $S/remote/r6-allbrowser.log) runs=$(grep -c ' rc=' $S/remote/r6-allbrowser.log)"
