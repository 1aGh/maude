#!/bin/bash
# Dimensions/durations of the repo's own .design media (looking for wide footage).
WT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a85623f2dd1a018ec
for f in "$WT"/.design/assets/*.mp4 "$WT"/.design/assets/*.mov; do
  printf "%s " "$(basename "$f")"
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height:format=duration -of csv=p=0 "$f" | tr '\n' ' '
  echo
done
