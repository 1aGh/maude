#!/bin/bash
# usage: up.sh <fix|empty> <port>
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
REPO=/Users/iagh/git/personal/maude/.claude/worktrees/a11y-run
cd "$REPO/apps/studio" || exit 1
env -i PATH="$W/home/bin:$PATH" HOME="$W/home" XDG_CONFIG_HOME="$W/home/xdg" \
  NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_CANVAS_ORIGIN_SPLIT=0 MAUDE_CLAUDE_BIN= \
  MAUDE_MACHINE_FILE="$W/home/machine.json" MAUDE_INDEX_DIR="$W/home/index" FARM_LOCAL=1 \
  CLAUDE_PROJECT_DIR="$W/$1" \
  nohup bun run server.ts --root "$W/$1" --port "$2" > "$W/$1.log" 2>&1 &
echo $! > "$W/$1.pid"
