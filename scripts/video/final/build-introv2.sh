#!/usr/bin/env bash
# IntroV2 audio: VO + a music bed cut from three generated sections (with the two hard stops)
# + frame-tight SFX, mixed onto the silent render; then the poster and word-accurate captions.
# Every cue below comes from CUE in src/scenes/introv2/motion.ts; see scripts/video/introv2-script.md.
#
#   bunx remotion render src/index.ts IntroV2 out/introv2/IntroV2.mp4   # 1. the silent cut
#   bash build-introv2.sh                                                # 2. mix, poster, captions
set -euo pipefail
cd "$(dirname "$0")"

A=public/introv2/audio
OUT=out/introv2/IntroV2-audio.mp4
VO_LIST="vo-1:300 vo-2:6700 vo-3:18500 vo-4:27700 vo-5:38800 vo-6:46900 vo-7:53700 vo-8:63500"

# Music: section A until the hard stop before wow 3 (27.5 s); silence on the sketch; section B
# lands its first beat on the snap (31.8 s, its onset is 0.59 s in) and stops dead before the
# Flip (53.5 s); section C's resolved chord lands with the card (59.4 s) and rings out.
BED_SEGMENTS="$A/music/bed-a.mp3:0:0:27.5:0.6:0.03:1 \
$A/music/bed-b2.mp3:31210:0:22.29:0.02:0.03:1 \
$A/music/bed-c.mp3:59400:0:11.1:0.02:1.2:1"

# SFX, name:frame:volume (30 fps), tight to the picture.
SFX_LIST="sub-pulse:69f:0.7 spark:90f:0.35 spark:149f:0.3 \
whoosh:182f:0.45 clip-drop:198f:0.7 clip-drop:209f:0.45 pop:246f:0.4 spark:347f:0.4 whoosh:396f:0.3 \
whoosh:530f:0.45 clip-drop:546f:0.5 shutter:628f:0.5 shutter:637f:0.5 shutter:647f:0.5 shutter:656f:0.5 shutter:666f:0.5 shutter:676f:0.5 spark:708f:0.35 \
whoosh:815f:0.45 scribble:834f:0.6 spark:927f:0.45 snap-hit:954f:0.8 click:1026f:0.6 whoosh:1035f:0.3 whoosh:1068f:0.3 \
whoosh:1149f:0.5 strike:1194f:0.8 strike:1212f:0.8 strike:1332f:0.8 \
whoosh:1395f:0.45 pop:1443f:0.35 pop:1452f:0.35 pop:1461f:0.35 pop:1470f:0.35 pop:1473f:0.4 pop:1479f:0.35 pop:1490f:0.4 \
whoosh:1599f:0.45 flip:1655f:0.7 flip:1773f:0.7 click:1841f:0.6 \
whoosh:1889f:0.45 riser:1908f:0.5 spark:1989f:0.55"

V=out/introv2/IntroV2.mp4 OUT="$OUT" FPS=30 \
VO_DIR=$A/vo/_trim VO_LIST="$VO_LIST" \
SFX_DIR=$A/sfx SFX_LIST="$SFX_LIST" \
BED_SEGMENTS="$BED_SEGMENTS" BEDVOL="${BEDVOL:-0.38}" DUCK=1 \
LOUDNORM_I=-16 LOUDNORM_TP=-1.5 TP_LIMIT=0.85 \
VCODEC=x264 CRF="${CRF:-27}" PRESET=slow ABITRATE=160k \
  bash build-audio.sh

# Second loudness pass (linear): the one-pass loudnorm in build-audio lands about 1 LU low on
# this mix. Measure, then apply the exact gain with a true-peak ceiling; the video is copied.
M=$(ffmpeg -hide_banner -i "$OUT" -af loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
mi=$(echo "$M" | sed -n 's/.*"input_i" : "\(.*\)".*/\1/p'); mtp=$(echo "$M" | sed -n 's/.*"input_tp" : "\(.*\)".*/\1/p')
mlra=$(echo "$M" | sed -n 's/.*"input_lra" : "\(.*\)".*/\1/p'); mth=$(echo "$M" | sed -n 's/.*"input_thresh" : "\(.*\)".*/\1/p')
moff=$(echo "$M" | sed -n 's/.*"target_offset" : "\(.*\)".*/\1/p')
ffmpeg -y -loglevel error -i "$OUT" -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${mi}:measured_TP=${mtp}:measured_LRA=${mlra}:measured_thresh=${mth}:offset=${moff}:linear=true,aresample=48000" -c:a aac -b:a 160k -movflags +faststart "${OUT%.mp4}.tmp.mp4"
mv "${OUT%.mp4}.tmp.mp4" "$OUT"
echo "✓ loudness: second pass from ${mi} LUFS"

ffmpeg -y -loglevel error -sseof -0.4 -i "$OUT" -frames:v 1 -q:v 3 out/introv2/intro-poster.jpg
echo "✓ out/introv2/intro-poster.jpg"

node scripts/intro2-captions.mjs $A/vo/_trim "$VO_LIST" out/introv2/IntroV2-captions.json
node scripts/captions-to-vtt.mjs out/introv2/IntroV2-captions.json public/introv2/captions.vtt
