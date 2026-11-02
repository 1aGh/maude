#!/bin/bash
# D6b, local half: contact sheet for md-edge-mixed (04), then SPEC | IMPL pairs from the fetched frames in .scr/d6b.
#   bash .ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/g2/mkpairs.sh <03-ai-chat|04-modes|06-advanced>
# Needs .scr/spec/<NN>/ (spec PNGs + meta.json, reused: the boards 03/04/06 are unchanged since 2026-10-19).
cd "$(dirname "$0")/../../../../../../.." || exit 1
H=.ai/plans/notes/v2-evidence/phase8-fidelity/_d7-harness-g2/g2
DIR="${1:?canvas dir}"
export D5_REPO="$PWD"
cp "$H"/impl/pairs-map*.json .scr/
cp "$H/impl/pairs.mjs" .scr/pairs.mjs
if [ "$DIR" = 04-modes ]; then
  for t in dark light; do
    d=.scr/d6b/04-modes
    # web, post, story / teaser, poster (s04d order, round 8: + banner as the sixth part)
    magick montage -font /System/Library/Fonts/Helvetica.ttc "$d/md-edge-mixed-web-$t.jpg" "$d/md-edge-mixed-post-$t.jpg" "$d/md-edge-mixed-story-$t.jpg" "$d/md-edge-mixed-poster-$t.jpg" "$d/md-edge-mixed-teaser-$t.jpg" "$d/md-edge-mixed-banner-$t.jpg" -tile 3x2 -geometry 720x450+6+6 -background "$([ $t = dark ] && echo '#0e1013' || echo '#d8dbe0')" "$d/md-edge-mixed-$t.jpg"
  done
fi
case "$DIR" in
  03-ai-chat) MAPF=pairs-map-c7b.json ;;
  04-modes) MAPF=pairs-map-d3.json ;;
  06-advanced) MAPF=pairs-map.json ;;
esac
# the maps hold 03+04(+06): restrict to the one canvas
node -e "
const fs=require('fs');const m=JSON.parse(fs.readFileSync('.scr/$MAPF','utf8'));
fs.writeFileSync('.scr/pairs-map-only.json',JSON.stringify({['$DIR']:m['$DIR']}));"
MAP=pairs-map-only.json node .scr/pairs.mjs | tail -3
