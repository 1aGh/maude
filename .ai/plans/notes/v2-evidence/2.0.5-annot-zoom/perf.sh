#!/bin/bash
# usage: perf.sh <worktree> <outname> <perf.sh args...>
WT="$1"; OUT="$2"; shift 2
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
mkdir -p "$R/out"
export HOME="$R/home" XDG_CONFIG_HOME="$R/xdg" NO_OPEN=1 FARM_LOCAL=1 MAUDE_NO_AUTOBUILD=1
export PATH="$R/bin:/Users/iagh/.bun/bin:/Users/iagh/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
# Playwright browsers live in the real cache; point at it explicitly (HOME is fake).
export PLAYWRIGHT_BROWSERS_PATH=/Users/iagh/Library/Caches/ms-playwright
cd "$R"
# Lead: record swap + memory pressure next to every pass.
{ date '+%H:%M:%S'; sysctl vm.swapusage; memory_pressure | tail -1; } >"$R/out/$OUT.mem" 2>&1
bash "$WT/apps/studio/bin/perf.sh" --root "$R/${PROJ:-proj}" --canvas ui/AI-StudyMate/ux/retention-ladder.tsx "$@" --json >"$R/out/$OUT.json" 2>"$R/out/$OUT.err"
echo "exit=$?"
tail -5 "$R/out/$OUT.err"
