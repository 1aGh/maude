#!/bin/bash
# probe durations of the copied media
cd "$(dirname "$0")/media" || exit 1
md5 -q vo/vo-90.mp3 vo/vo-92.mp3
for f in vo/*.mp3 music/*.mp3 sfx/*.mp3; do
  printf "%s " "$f"
  ffprobe -v error -show_entries format=duration:stream=sample_rate,channels -of csv=p=0 "$f" | tr '\n' ' '
  echo
done
