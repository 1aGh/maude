#!/usr/bin/env bash
# video-proxy.sh — thin shim over _video-proxy.mjs; reached via
# `maude design video-proxy` (DDR-062), never a raw bin path. Makes an H.264 /
# constant-frame-rate / single-AAC copy of one video asset next to the original,
# for a clip that is HEVC, variable frame rate or has a second audio track
# (#128 §1). See _video-proxy.mjs for the rationale.
#
# Usage:
#   video-proxy.sh assets/<clip> --root <repo> [--design-root .design]
#
# stdout on success = a JSON manifest { source, proxy, reused, found, width, height, fps }.
# Exit: 0 ok · 2 usage · 3 no ffmpeg · 4 not a readable video · 6 outside assets/ · 1 other.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$1" in
  --help|-h) sed -n '2,12p' "$0" | sed 's/^# \?//'; exit 0 ;;
esac

# Pure Node ESM (no .ts); prefer node, fall back to bun in a dev tree.
if command -v node >/dev/null 2>&1; then
  exec node "$SCRIPT_DIR/_video-proxy.mjs" "$@"
elif command -v bun >/dev/null 2>&1; then
  exec bun run "$SCRIPT_DIR/_video-proxy.mjs" "$@"
else
  echo "video-proxy.sh: node or bun is required." >&2
  exit 1
fi
