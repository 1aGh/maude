#!/bin/bash
# Wide-source contact sheets (2 fps, 10x10 grid) for the wide→9:16 reframing case.
D="$(cd "$(dirname "$0")" && pwd)"
WT=/Users/iagh/git/personal/maude/.claude/worktrees/agent-a85623f2dd1a018ec
mkdir -p "$D/out/expD" "$D/media/wide"
for f in caaftv-local.mp4 66c0d998.mp4 reel-a.mp4; do
  cp "$WT/.design/assets/$f" "$D/media/wide/$f"
done
ffmpeg -v error -y -i "$D/media/wide/caaftv-local.mp4" -vf "fps=2,scale=320:180,drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.6,drawgrid=w=iw/2:h=ih/2:t=2:c=red@0.8,tile=4x4:padding=4:color=black" -frames:v 1 "$D/out/expD/caaftv-sheet.png"
ffmpeg -v error -y -i "$D/media/wide/66c0d998.mp4" -vf "fps=0.5,scale=320:180,tile=5x4:padding=4:color=black" -frames:v 1 "$D/out/expD/66c0d998-peek.png"
ffmpeg -v error -y -i "$D/media/wide/reel-a.mp4" -vf "fps=2,scale=320:180,drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.6,drawgrid=w=iw/2:h=ih/2:t=2:c=red@0.8,tile=4x3:padding=4:color=black" -frames:v 1 "$D/out/expD/reel-a-sheet.png"
ls -la "$D/out/expD"/*.png
