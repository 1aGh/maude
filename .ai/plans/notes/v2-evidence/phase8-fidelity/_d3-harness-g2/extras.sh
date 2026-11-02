#!/bin/bash
W=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a1d011f1a56ad7ee9
E=$W/.ai/plans/notes/v2-evidence/phase8-fidelity
S=$W/.scr/impl-out
for t in dark light; do
  magick $S/03-ai-chat/ai-open-cmdslash-$t.jpg -resize 1100x -quality 55 $E/03-ai-chat/extra-impl-ai-open-cmdslash-$t.jpg
  magick $S/03-ai-chat/ai-not-ready-after-$t.jpg -resize 1100x -quality 55 $E/03-ai-chat/extra-impl-ai-not-ready-after-$t.jpg
  magick $S/03-ai-chat/ai-choice-q-$t.jpg -resize 1100x -quality 55 $E/03-ai-chat/extra-impl-ai-choice-q-$t.jpg
  magick $S/04-modes/md-comment-thread-$t.jpg -resize 1100x -quality 55 $E/04-modes/extra-impl-md-comment-thread-$t.jpg
  magick $S/04-modes/md-edge-ai-after-$t.jpg -resize 1100x -quality 55 $E/04-modes/extra-impl-md-edge-ai-after-$t.jpg
  magick $S/04-modes/md-present-video-play-$t.jpg -resize 1100x -quality 55 $E/04-modes/extra-impl-md-present-video-play-$t.jpg
done
