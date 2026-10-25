#!/bin/bash
# D7, local half: SPEC | IMPL pairs from the fetched frames in .scr/d7/<NN> -> .scr/pairs/<NN>/ + the committed <id>-<theme>.jpg.
#   bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/mkpairs.sh <06|07|08>
# Needs .scr/spec/<NN>/ (spec PNGs, reused unchanged from the D6/D6b worktrees; 06 also its meta.json).
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2
case "$1" in
  06) rm -rf .scr/d6b/06-advanced; mkdir -p .scr/d6b/06-advanced; cp .scr/d7/06/*.jpg .scr/d6b/06-advanced/
      bash $H/g2/mkpairs.sh 06-advanced ;;
  07|08) node $H/g3/pairs.mjs "$1" ;;
  *) echo "bad canvas"; exit 2 ;;
esac
