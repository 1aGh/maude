#!/bin/bash
# the final matrix at the final head: every state, both themes, then the other ports and the native / strip / home pages
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
cd /Users/iagh/git/personal/maude/.claude/worktrees/a11y-run || exit 1
rm -rf "$W/out"; mkdir -p "$W/out"
AGENT_BROWSER_SOCKET_DIR=/private/tmp/mab-a11y agent-browser close --all >/dev/null 2>&1
for th in dark light; do
  echo "=== $th main (4431)"
  node "$W/states.mjs" $th '^(?!fmt3-|ds-|empty-|native-|present-options-off|whatsnew-toast|canvas-smoke-minimap|diag-recheck)' 4431 2>&1
  echo "=== $th fmt3 (4434)"
  node "$W/states.mjs" $th '^fmt3-(?!update)' 4434 2>&1
  echo "=== $th ds (4433)"
  node "$W/states.mjs" $th '^ds-' 4433 2>&1
  echo "=== $th empty (4432)"
  node "$W/states.mjs" $th '^empty-' 4432 2>&1
  echo "=== $th native"
  AB_SESSION=native AB_INIT="$W/tauri-stub.js" node "$W/states.mjs" $th '^native-' 4431 2>&1
  echo "=== $th strip"
  AB_SESSION=strip AB_INIT="$W/strip-stub.js" node "$W/pages.mjs" $th strip 2>&1
  echo "=== $th home"
  AB_SESSION=home node "$W/pages.mjs" $th home 2>&1 | head -4
done
echo ALLDONE
