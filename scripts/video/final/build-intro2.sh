#!/usr/bin/env bash
# Intro2 audio: mix the seven VO lines and the music bed onto the silent render, then make the
# poster and the captions. Everything here is documented in scripts/video/intro2-script.md.
#
#   bunx remotion render src/index.ts Intro2 out/intro2/Intro2.mp4   # 1. the silent cut
#   bash build-intro2.sh                                              # 2. mix + poster + captions
#
# VO offsets = each beat's start in Intro2.tsx (INTRO2_BEAT_STARTS: 0, 150, 390, 555, 1005,
# 1305, 1515 frames) + 0.4 s. Keep the two in step when a beat changes length.
set -euo pipefail
cd "$(dirname "$0")"

OUT=out/intro2/Intro2-audio.mp4
VO_LIST="vo-1:400 vo-2:5400 vo-3:13400 vo-4:18900 vo-5:33900 vo-6:43900 vo-7:50900"
V=out/intro2/Intro2.mp4 OUT="$OUT" \
VO_DIR=public/intro2/audio/vo/_trim \
VO_LIST="$VO_LIST" \
SFX_LIST="" \
BED=public/intro2/audio/music/bed.mp3 BEDVOL="${BEDVOL:-0.3}" DUCK=1 \
BED_FADE_IN=1.5 BED_FADE_OUT_AT=55.5 BED_FADE_OUT=4.5 \
VCODEC=x264 CRF="${CRF:-23}" PRESET=slow ABITRATE=192k \
  bash build-audio.sh

# Poster: the settled end card (last second).
ffmpeg -y -loglevel error -sseof -0.5 -i "$OUT" -frames:v 1 -q:v 3 out/intro2/intro-poster.jpg
echo "✓ out/intro2/intro-poster.jpg"

# Captions: whisper (the sub.mjs whisper.cpp setup) on each clean VO take, shifted to its
# place in the mix → Caption[] JSON → WebVTT. Whisper on the mixed film (`node sub.mjs "$OUT"`)
# was tried first: the music bed smeared its word times by up to 1.5 s.
node scripts/intro2-captions.mjs public/intro2/audio/vo/_trim "$VO_LIST" out/intro2/Intro2-captions.json
node scripts/captions-to-vtt.mjs out/intro2/Intro2-captions.json public/intro2/captions.vtt
