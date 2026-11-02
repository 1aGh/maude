#!/bin/bash
W=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/a11y
REPO=/Users/iagh/git/personal/maude/.claude/worktrees/a11y-run
mkdir -p "$W/home/homestate" "$W/home/homeprojects"
cd "$REPO/apps/studio" || exit 1
TOK=$(openssl rand -hex 32)
SEC=$(openssl rand -hex 32)
echo "$SEC" > "$W/home-secret.txt"
env -i PATH="$W/home/bin:$PATH" HOME="$W/home" XDG_CONFIG_HOME="$W/home/xdg" \
  NO_OPEN=1 MAUDE_NO_AUTOBUILD=1 MAUDE_CLAUDE_BIN= FARM_LOCAL=1 MAUDE_EXIT_WITH_PARENT=0 \
  MAUDE_MACHINE_FILE="$W/home/machine.json" MAUDE_INDEX_DIR="$W/home/index" \
  MAUDE_HOME_STATE_DIR="$W/home/homestate" MAUDE_HOME_PROJECTS_DIR="$W/home/homeprojects" \
  MAUDE_HOME_TOKEN="$TOK" MAUDE_HOME_PAGE_SECRET="$SEC" \
  nohup bun run server.ts --home --port 4440 > "$W/home.log" 2>&1 &
echo $! > "$W/home.pid"
