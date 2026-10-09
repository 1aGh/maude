#!/bin/bash
# Contact sheets at 2 fps with a 10x10 grid for hand-labelling the subject centre.
D="$(dirname "$0")"
mkdir -p "$D/out/expD"
FONT=/System/Library/Fonts/Supplemental/Arial.ttf
for id in 25c450fb 3f5fd5f3 c3619ca5 381b5d7c; do
  ffmpeg -v error -y -i "$D/media/clips/$id.mp4" -vf "fps=2,scale=216:384,drawgrid=w=iw/10:h=ih/10:t=1:c=yellow@0.6,drawgrid=w=iw/2:h=ih/2:t=2:c=red@0.8,tile=7x3:padding=4:color=black" -frames:v 1 "$D/out/expD/$id-sheet.png"
  echo "$id $(ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$D/media/clips/$id.mp4")"
done
ls -la "$D/out/expD"
