#!/bin/bash
# usage: go.sh <scenario> <theme> [ENV=val ...]  — one stage-D shoot into .scr/impl
cd "$(dirname "$0")" || exit 1
SCN="$1"; TH="$2"; shift 2
env "$@" SHOT_CHANNEL=chrome SHOTS_OUT="$PWD/impl" ROWS="rows-$SCN-$TH.jsonl" node run.mjs "$SCN.mjs" "$TH" 2>&1 | grep -v "^skip\|^shot\|^pageerrors" | tail -25
