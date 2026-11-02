#!/bin/bash
# usage: go.sh <scenario> <theme> — one shoot into .scr/impl (NN dirs come from the scenario step names)
cd "$(dirname "$0")" || exit 1
SCN="$1"; TH="$2"; shift 2
env "$@" SHOT_CHANNEL=chrome SHOTS_OUT="$PWD/impl" ROWS="rows-$SCN-$TH.jsonl" node run.mjs "$SCN.mjs" "$TH" 2>&1 | grep -v "^skip\|^pageerrors" | tail -40
