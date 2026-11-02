#!/bin/bash
# re-scan named native states at a head: run-one.sh <sha> <regex>
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
REPO=/Users/iagh/git/personal/maude/.claude/worktrees/a11y-run
cd "$REPO" || exit 1
git checkout -q -- apps/studio/dist 2>/dev/null
git checkout -q --detach "$1" || exit 1
echo "head $(git rev-parse --short HEAD)"
bash "$W/build.sh"
bash "$W/up.sh" fix 4431
for i in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:4431/_health" && break; sleep 1; done
AGENT_BROWSER_SOCKET_DIR=/private/tmp/mab-a11y agent-browser close --all >/dev/null 2>&1
for th in dark light; do
  AB_SESSION=native AB_INIT="$W/tauri-stub.js" node "$W/states.mjs" $th "$2" 4431 2>&1 | grep -E "^(ok|BLOCK|FAIL)"
done
bash "$W/down.sh" > /dev/null 2>&1
git checkout -q -- apps/studio/dist
echo "dist: $(git status --short apps/studio/dist | wc -l)"
