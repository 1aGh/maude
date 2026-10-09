#!/bin/bash
# Run the real smart-frames verb (ffmpeg tier) on the copied clips inside a scratch project root.
D="$(cd "$(dirname "$0")" && pwd)"
WT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a85623f2dd1a018ec
P="$D/out/expD/proj"
mkdir -p "$P/.design/assets"
for id in 25c450fb 3f5fd5f3 c3619ca5 381b5d7c; do
  cp "$D/media/clips/$id.mp4" "$P/.design/assets/$id.mp4"
  start=$(python3 -c 'import time;print(time.time())')
  node "$WT/apps/studio/bin/_smart-frames.mjs" "assets/$id.mp4" --root "$P" --engine ffmpeg --out-dir "$D/out/expD/sf-$id" > "$D/out/expD/sf-$id.json" 2> "$D/out/expD/sf-$id.err"
  rc=$?
  end=$(python3 -c 'import time;print(time.time())')
  echo "$id rc=$rc wall=$(python3 -c "print(round($end-$start,2))") frames=$(jq -c '[.frames[].t]' "$D/out/expD/sf-$id.json" 2>/dev/null) cuts=$(jq -c '.sceneCuts' "$D/out/expD/sf-$id.json" 2>/dev/null)"
done
