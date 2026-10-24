#!/bin/bash
cd "$(dirname "$0")" || exit 1
mkdir -p spec/08 spec/09 spec/10-share-and-collaboration spec/13-design-system
W=/Users/iagh/git/personal/maude/.claude/worktrees
for t in dark light; do
  cp $W/agent-ae9248c4b37445c3a/.scr/spec/08/ak-convert-after-$t.png spec/08/
  cp $W/agent-ae9248c4b37445c3a/.scr/spec/09/ex-social-$t.png spec/09/
  cp $W/agent-a88fc0565d3f0bdf8/.scr/spec/10-share-and-collaboration/co-sync-offline-$t.png spec/10-share-and-collaboration/
  cp $W/agent-a88fc0565d3f0bdf8/.scr/spec/10-share-and-collaboration/co-comment-thread-$t.png spec/10-share-and-collaboration/
  cp $W/agent-a6c55c2a9eae9f5e5/.scr/spec/13-design-system/ds-truth-outside-$t.png spec/13-design-system/
done
ls spec/*
