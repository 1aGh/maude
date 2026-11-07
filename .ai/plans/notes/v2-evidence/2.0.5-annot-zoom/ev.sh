#!/bin/bash
# usage: ev.sh <query.js> [port]
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
WT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a2735bcc7ca654c2b
export HOME="$R/home" XDG_CONFIG_HOME="$R/xdg" NO_OPEN=1 FARM_LOCAL=1
export PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
cd "$R"
node "$R/evalframe.mjs" "$WT" "${2:-4517}" "$R/$1"
