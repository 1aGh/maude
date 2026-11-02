#!/bin/bash
# usage: go7.sh <script-stem> <theme>  (07 harness, run from .scr/g3; frames land in .scr/g3/impl/07)
TH="${2:-light}"
cd "$(dirname "$0")" || exit 1
SHOT_CHANNEL=chrome SHOTS_OUT="$PWD/impl" ROWS="rows-$1-$TH.jsonl" node run.mjs "$1.mjs" "$TH" 2>&1 | grep -v '^skip\|^pageerrors' | tail -${TAIL:-30}
