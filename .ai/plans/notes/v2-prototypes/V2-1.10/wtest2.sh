#!/bin/bash
# One-off: DTW token timestamps need flash-attention off?
D="$(dirname "$0")"
M="$HOME/.cache/whisper-models/ggml-base.en.bin"
whisper-cli --help 2>&1 | grep -E "nfa|flash"
/usr/bin/time -p whisper-cli -m "$M" -f "$D/out/wtest/vo-65.wav" -ojf -of "$D/out/wtest/d" -ml 1 -sow -dtw base.en -nfa 2>&1 | grep -i -E "dtw|real|warn|error" | head
jq -c '.transcription[] | [.offsets.from, .offsets.to, .text, [.tokens[] | [.text, .t_dtw]]]' "$D/out/wtest/d.json" | head -30
