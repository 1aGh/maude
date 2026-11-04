#!/usr/bin/env bash
# Mix a cut's audio (VO + SFX + music bed) and mux it onto the rendered video.
#
# With no arguments it builds V5 exactly as before (its VO/SFX lists and paths below).
# Every part can be overridden by env, so other cuts (Intro2: build-intro2.sh) reuse it:
#
#   V=out/x/X.mp4            input video (silent render)
#   OUT=out/x/X-audio.mp4    output
#   VO_DIR=dir               folder holding <name>.mp3 for each VO entry
#   VO_LIST="vo-1:400 vo-2:5400"      name:delay_ms pairs (space-separated)
#   SFX_DIR=dir  SFX_LIST="name:delay_ms:volume …"   (SFX_LIST="" for none)
#   BED=file.mp3  BEDVOL=0.16          music bed and its level
#   BED_FADE_IN=3  BED_FADE_OUT_AT=100  BED_FADE_OUT=5   bed fades (s)
#   DUCK=1                   duck the bed under the VO (sidechain compressor) instead of a flat level
#   LOUDNORM_I=-16  LOUDNORM_TP=-1.5    loudness target (LUFS) and true peak
#   VCODEC=copy | x264       copy the video stream (default) or re-encode it
#   CRF=23  PRESET=slow      used when VCODEC=x264
#   ABITRATE=256k
#
# VO start times are frame-aligned to each beat (see the cut's script / _audio-prompts.md).
set -euo pipefail
cd "$(dirname "$0")"

V="${V:-out/v5/V5.mp4}"
A=public/v5/audio
VO_DIR="${VO_DIR:-$A/vo/_trim}"       # trimmed VO
SFX_DIR="${SFX_DIR:-$A/sfx}"
BED="${BED:-$A/music/bed.mp3}"        # override: BED=path/to/track.mp3 ./build-audio.sh
OUT="${OUT:-out/v5/V5-audio.mp4}"
BEDVOL="${BEDVOL:-0.16}"
BED_FADE_IN="${BED_FADE_IN:-3}"
BED_FADE_OUT_AT="${BED_FADE_OUT_AT:-100}"
BED_FADE_OUT="${BED_FADE_OUT:-5}"
DUCK="${DUCK:-0}"
LOUDNORM_I="${LOUDNORM_I:--16}"
LOUDNORM_TP="${LOUDNORM_TP:--1.5}"
VCODEC="${VCODEC:-copy}"
CRF="${CRF:-23}"
PRESET="${PRESET:-slow}"
ABITRATE="${ABITRATE:-256k}"

# VO: name:delay_ms (V5 defaults)
# shellcheck disable=SC2206
vo_list=(${VO_LIST:-vo-00:400 vo-10:5700 vo-20:14070 vo-40:23070 vo-50:30000 vo-60:36970 vo-65:47570 vo-70:55070 vo-80:63030 vo-90:68930 vo-92:76330 vo-94:84600 vo-96:88800 vo-99:98530})
# SFX: name:delay_ms:volume (V5 defaults; SFX_LIST="" turns them off)
# shellcheck disable=SC2206
sfx_list=(${SFX_LIST-power-on:300:0.30 scan-sweep:6000:0.28 vortex:20300:0.30 success:34500:0.30 connect:48000:0.28 draw-stroke:56500:0.30 boot-playful:63100:0.32 type-clicks:70500:0.28 success:94200:0.30})

# inputs: 0=video, 1=bed, 2..=vo, then sfx
args=(-i "$V" -i "$BED")
fc="[1:a]afade=t=in:st=0:d=${BED_FADE_IN},afade=t=out:st=${BED_FADE_OUT_AT}:d=${BED_FADE_OUT},volume=${BEDVOL}[b];"

i=2
volabels=""
for entry in "${vo_list[@]}"; do
  f="${entry%%:*}"; d="${entry##*:}"
  [ -f "$VO_DIR/$f.mp3" ] || { echo "skip missing $f"; continue; }
  args+=(-i "$VO_DIR/$f.mp3")
  fc+="[${i}:a]adelay=${d}:all=1,volume=1.0[v${i}];"
  volabels+="[v${i}]"
  i=$((i+1))
done
nvo=$((i-2))
sfxlabels=""
for entry in "${sfx_list[@]+"${sfx_list[@]}"}"; do
  f="$(echo "$entry" | cut -d: -f1)"; d="$(echo "$entry" | cut -d: -f2)"; vol="$(echo "$entry" | cut -d: -f3)"
  [ -f "$SFX_DIR/$f.mp3" ] || { echo "skip missing sfx $f"; continue; }
  args+=(-i "$SFX_DIR/$f.mp3")
  fc+="[${i}:a]adelay=${d}:all=1,volume=${vol}[v${i}];"
  sfxlabels+="[v${i}]"
  i=$((i+1))
done

if [ "$DUCK" = "1" ] && [ "$nvo" -gt 0 ]; then
  # The VO bus keys a compressor on the bed: the bed dips while someone speaks.
  # apad: the key must outlast the VO, or the compressor (and so the cut) stops at the last word.
  fc+="${volabels}amix=inputs=${nvo}:normalize=0:dropout_transition=0,asplit=2[vo][key0];[key0]apad[key];"
  fc+="[b][key]sidechaincompress=threshold=0.03:ratio=8:attack=60:release=450:makeup=1[bd];"
  mixlabels="[bd][vo]${sfxlabels}"
  n=$((2 + i - 2 - nvo))
else
  mixlabels="[b]${volabels}${sfxlabels}"
  n=$((i-1))   # number of audio streams mixed
fi
fc+="${mixlabels}amix=inputs=${n}:normalize=0:dropout_transition=0[mx];"
fc+="[mx]alimiter=limit=0.95,loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=11[outa]"

if [ "$VCODEC" = "x264" ]; then
  vargs=(-c:v libx264 -crf "$CRF" -preset "$PRESET" -pix_fmt yuv420p -movflags +faststart)
else
  vargs=(-c:v copy)
fi

mkdir -p "$(dirname "$OUT")"
echo "→ mixing ${n} audio streams onto ${V} → ${OUT}"
ffmpeg -y "${args[@]}" -filter_complex "$fc" \
  -map 0:v -map "[outa]" "${vargs[@]}" -c:a aac -b:a "$ABITRATE" -shortest "$OUT" -loglevel error
echo "✓ $OUT"
ls -la "$OUT"
