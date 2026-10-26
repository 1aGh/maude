#!/bin/bash
# Round 11, local half: SPEC | IMPL pairs for 03 AI Chat from the fetched frames in .scr/d7/03-ai-chat.
#   ONLY=ai-done,ai-question bash .ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1/mkpairs.sh
# Needs .scr/spec/03/ (spec PNGs + meta.json, reused: the board is unchanged since 2026-10-19). Writes the full-size PNG
# pairs to .scr/pairs/03-ai-chat/ and overwrites the committed <id>-<theme>.jpg (<= 1100 wide, q55) of the ids in ONLY.
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_r11-harness-g1
export D5_REPO="$PWD"
cp "$H/impl/pairs-map-c7b.json" .scr/pairs-map.json
cp "$H/impl/pairs.mjs" .scr/pairs.mjs
MAP=pairs-map.json node .scr/pairs.mjs | tail -12
