#!/usr/bin/env bash
# Boot the worktree's studio server on the throwaway project copy. Throwaway HOME/XDG, stub claude, no browser.
S=/private/tmp/claude-501/-Users-iagh-git-personal-maude/89def169-71dd-4194-a764-50214fe791d9/scratchpad/t81
W=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a3c499e7d4fcdef80
export HOME=$S/home XDG_CONFIG_HOME=$S/xdg NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 FARM_LOCAL=1
export MAUDE_INDEX_DIR=$S/index MAUDE_UI_PREFS_PATH=$S/xdg/prefs.json MAUDE_CLOUD_CONFIG=$S/xdg/cloud.json HUBS_CONFIG_PATH=$S/xdg/hubs.json
export PATH=$S/bin:$PATH
cd "$W/apps/studio" && exec bun run server.ts --root "$S/proj" --port "${1:-4791}"
