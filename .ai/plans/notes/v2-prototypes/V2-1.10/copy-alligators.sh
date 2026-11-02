#!/bin/bash
# Copy (never modify) a sample of Alligators footage + music into the scratch dir.
SRC="$HOME/Maude/alligators/.design/assets"
DST="$(dirname "$0")/media"
for id in 124847ce 2e3b6e7f 5b8ee6dc 7fad5cf2 b1061669 b2996668 c43b76df 25c450fb 3f5fd5f3 e43ac47e d4a5b800 c3619ca5 381b5d7c 98d1e5d0 c83c1744; do
  cp "$SRC/$id.mp4" "$DST/clips/$id.mp4"
  [ -f "$SRC/$id.footage.json" ] && cp "$SRC/$id.footage.json" "$DST/clips/$id.footage.json"
done
for id in 5c5d121f 83fc6673 fb3fcf9f 47d9b6d1 b4c3bb33 9bbdc119 9ec69178 2a886bcf 46a07c5e bdbd77bb 55986008; do
  cp "$SRC/$id.mp3" "$DST/music/all-$id.mp3"
  for ext in json meta.json gen.json; do [ -f "$SRC/$id.$ext" ] && cp "$SRC/$id.$ext" "$DST/music/all-$id.$ext"; done
done
ls "$SRC" | grep -E "^(5c5d121f|83fc6673|fb3fcf9f|47d9b6d1|b4c3bb33|9bbdc119|9ec69178|2a886bcf|46a07c5e|bdbd77bb|55986008)"
for f in "$DST"/music/all-*.mp3 "$DST"/clips/*.mp4; do
  printf "%s " "$(basename "$f")"
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | tr '\n' ' '
  ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate -of csv=p=0 "$f" 2>/dev/null | tr '\n' ' '
  echo
done
