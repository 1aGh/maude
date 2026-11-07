#!/bin/bash
# usage: prof.sh <worktree> <port> <outname> [--fit-all] [--zoom-only|--pan-only]
WT="$1"; PORT="$2"; OUT="$3"; shift 3
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
mkdir -p "$R/out"
export HOME="$R/home" XDG_CONFIG_HOME="$R/xdg" NO_OPEN=1 FARM_LOCAL=1
export PATH="$R/bin:/Users/iagh/.bun/bin:/Users/iagh/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
export PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
cd "$R"
node "$R/profile.mjs" "$WT" "$PORT" ui-ai-studymate-ux-retention-ladder "$R/out/$OUT" "$@"
