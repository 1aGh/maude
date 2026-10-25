#!/bin/bash
# D6: the extra-impl frames (states the board has no frame for), refreshed from the fetched impl frames.
cd "$(dirname "$0")/../../../../../../.." || exit 1
E=.ai/plans/notes/v2-evidence/phase8-fidelity
S=.scr/d7
x() { # <dir> <frame>
  for t in dark light; do
    [ -f "$S/$1/$2-$t.jpg" ] && magick "$S/$1/$2-$t.jpg" -resize 1100x -quality 55 "$E/$1/extra-impl-$2-$t.jpg" && echo "extra $1/$2-$t"
  done
}
x 03-ai-chat ai-open-cmdslash
x 03-ai-chat ai-not-ready-after
x 03-ai-chat ai-choice-q
x 04-modes md-comment-thread
x 04-modes md-edge-ai-after
x 04-modes md-present-video-play
x 06-advanced ad-left-layers
