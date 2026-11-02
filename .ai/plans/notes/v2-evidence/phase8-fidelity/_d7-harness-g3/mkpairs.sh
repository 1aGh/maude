#!/bin/bash
# D7, local half: SPEC | IMPL pairs from the fetched frames in .scr/impl/<dir> + .scr/spec/<dir> (spec PNGs reused: the boards
# 10 / 12 / 13 under .design/ui/v2/ are unchanged since 2026-10-21). Needs ImageMagick (magick).
#   bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3/mkpairs.sh <10|12|13>
# 10 / 12: g4/mkpairs.mjs (crop table) writes the full-size pair to .scr/pairs/<dir>/ and the committed JPEG (q55, <=1100 px).
# 13: g5/scr/mkpairs.mjs (laid into .scr by setup.sh) - an id with no impl becomes the grey "not reachable" card.
cd "$(dirname "$0")/../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g3
case "$1" in
  10) node $H/g4/mkpairs.mjs 10-share-and-collaboration ;;
  12) node $H/g4/mkpairs.mjs 12-import-and-assets ;;
  13) bash $H/g5/setup.sh 13 && bun .scr/mkpairs.mjs 13-design-system ;;
  *) echo "bad canvas"; exit 2 ;;
esac
