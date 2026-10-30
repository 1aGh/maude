#!/bin/bash
# One-off: inspect whisper.cpp JSON shapes on one VO.
D="$(dirname "$0")"
mkdir -p "$D/out/wtest"
ffmpeg -v error -y -i "$D/media/vo/vo-65.mp3" -ar 16000 -ac 1 -c:a pcm_s16le "$D/out/wtest/vo-65.wav"
M="$HOME/.cache/whisper-models/ggml-base.en.bin"
/usr/bin/time -p whisper-cli -m "$M" -f "$D/out/wtest/vo-65.wav" -oj -of "$D/out/wtest/a" -ml 1 2>&1 | tail -3
/usr/bin/time -p whisper-cli -m "$M" -f "$D/out/wtest/vo-65.wav" -ojf -of "$D/out/wtest/c" -ml 1 -sow -dtw base.en 2>&1 | tail -3
jq -c '.transcription[] | [.offsets.from, .offsets.to, .text]' "$D/out/wtest/a.json" | head -40
echo ----
jq -c '.transcription[0]' "$D/out/wtest/c.json" | head -c 1500
echo
jq -c '.transcription[] | [.offsets.from, .offsets.to, .text, [.tokens[] | [.text, .t_dtw, .p]]]' "$D/out/wtest/c.json" | head -30
