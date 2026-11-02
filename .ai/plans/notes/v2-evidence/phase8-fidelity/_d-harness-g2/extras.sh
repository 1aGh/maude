#!/bin/bash
W=/Users/iagh/git/personal/maude/.claude/worktrees/agent-ace93bd2b562b89ad
E=$W/.ai/plans/notes/v2-evidence/phase8-fidelity
S=$W/.scr/impl-out
for t in dark light; do
  magick $S/03-ai-chat/ai-open-cmdslash-$t.jpg -resize 1100x -quality 55 $E/03-ai-chat/extra-impl-ai-open-cmdslash-$t.jpg
  magick $S/03-ai-chat/ai-not-ready-after-$t.jpg -resize 1100x -quality 55 $E/03-ai-chat/extra-impl-ai-not-ready-after-$t.jpg
  magick $S/04-modes/md-comment-thread-$t.jpg -resize 1100x -quality 55 $E/04-modes/extra-impl-md-comment-thread-$t.jpg
  magick $S/04-modes/md-edge-ai-after-$t.jpg -resize 1100x -quality 55 $E/04-modes/extra-impl-md-edge-ai-after-$t.jpg
  magick $S/06-advanced/ad-left-layers-$t.jpg -resize 1100x -quality 55 $E/06-advanced/extra-impl-ad-left-layers-$t.jpg
done
