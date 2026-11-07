#!/bin/bash
# Boot an isolated studio server on the throwaway project.
# usage: boot.sh <worktree> <port> <logfile>
WT="$1"; PORT="$2"; LOG="$3"
R=/private/tmp/claude-501/-Users-iagh-git-personal-maude/87d978ed-80c9-4461-b6c8-391c975c5c9a/scratchpad/perf-rl
export HOME="$R/home"
export XDG_CONFIG_HOME="$R/xdg"
export NO_OPEN=1
export MAUDE_NO_AUTOBUILD=1
export FARM_LOCAL=1
export PATH="$R/bin:/Users/iagh/.bun/bin:/Users/iagh/.nvm/versions/node/v24.13.0/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin"
unset CLAUDE_PROJECT_DIR MAUDE_CLOUD_CONFIG HUBS_CONFIG_PATH MAUDE_PROFILE_ID
cd "$WT/apps/studio" || exit 1
exec bun run server.ts --root "$R/${4:-proj}" --port "$PORT" >"$LOG" 2>&1
